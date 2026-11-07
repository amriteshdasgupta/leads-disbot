import { composeModal, leadCard as cardData, updateOriginal, verifyDiscordRequest } from "./discord";
import { sendEmail } from "./email";
import { getLead, saveLead, sha256Hex } from "./store";
import { emailDrafts } from "./discord-templates";
import type { Config } from "./config";
import type { Email, Lead } from "./types";

// https://discord.com/developers/docs/interactions/receiving-and-responding
const PING = 1;
const COMPONENT = 3;
const MODAL_SUBMIT = 5;
const PONG = 1;
const REPLY = 4;
const DEFERRED_UPDATE = 6;
const UPDATE = 7;
const MODAL = 9;

interface Interaction {
  type: number;
  token: string;
  application_id: string;
  member?: { user: DiscordUser };
  user?: DiscordUser;
  data?: {
    custom_id: string;
    components?: { components: { custom_id: string; value: string }[] }[];
  };
}

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

const ephemeral = (content: string) => Response.json({ type: REPLY, data: { content, flags: 64 } });

/** How long a Send blocks other Sends on the same lead. Gmail has no idempotency key. */
const SEND_LOCK_MS = 2 * 60_000;

/** Marks the lead as sending. Returns false if a Send is already in flight. */
async function claimSend(config: Config, lead: Lead): Promise<boolean> {
  const now = Date.now();
  if (lead.sendingAt && now - lead.sendingAt < SEND_LOCK_MS) return false;
  lead.sendingAt = now;
  await saveLead(config, lead);
  return true;
}

/** POST /discord: the Interactions Endpoint URL set in the Discord Developer Portal. */
export async function handleInteraction(request: Request, config: Config, ctx: ExecutionContext): Promise<Response> {
  const body = await verifyDiscordRequest(request, config.DISCORD_PUBLIC_KEY);
  if (body === null) return new Response("Bad signature", { status: 401 });
  const interaction = JSON.parse(body) as Interaction;
  if (interaction.type === PING) return Response.json({ type: PONG });

  const user = interaction.member?.user ?? interaction.user;
  const allowed = config.ALLOWED_USER_IDS;
  if (allowed.length && (!user || !allowed.includes(user.id))) {
    return ephemeral("Only allowed team members can reply to leads.");
  }
  const who = user?.global_name || user?.username || "someone";

  const [action, id] = (interaction.data?.custom_id ?? "").split(":");
  const lead = id ? await getLead(config, id) : null;
  if (!lead) return ephemeral("This lead has expired, so it can't be emailed from here any more.");

  const open = lead.status === "review" || lead.status === "failed" || lead.status === "pending";
  const canWrite = open || lead.status === "auto_sent";

  if (interaction.type === COMPONENT) {
    switch (action) {
      case "edit":
        if (!canWrite) return Response.json({ type: UPDATE, data: cardData(config, lead) });
        if (!lead.draft) {
          lead.draft = (await emailDrafts(config, lead)).personal;
          await saveLead(config, lead);
        }
        return Response.json({ type: MODAL, data: composeModal(lead, lead.draft) });
      case "send":
        if (!open || !lead.draft) return Response.json({ type: UPDATE, data: cardData(config, lead) });
        if (!(await claimSend(config, lead))) return ephemeral("That email is already on its way.");
        ctx.waitUntil(sendAndUpdate(config, interaction, lead, lead.draft, who));
        return Response.json({ type: DEFERRED_UPDATE });
      case "skip":
        if (!open) return Response.json({ type: UPDATE, data: cardData(config, lead) });
        lead.status = "skipped";
        lead.handledBy = who;
        lead.handledAt = Date.now();
        await saveLead(config, lead);
        return Response.json({ type: UPDATE, data: cardData(config, lead) });
    }
  }

  if (interaction.type === MODAL_SUBMIT && action === "compose") {
    if (!canWrite) return ephemeral("This lead has already been handled.");
    const values = Object.fromEntries(
      (interaction.data?.components ?? []).flatMap((row) => row.components.map((c) => [c.custom_id, c.value])),
    );
    const email: Email = {
      subject: values.subject?.trim() ?? "", body: values.body?.trim() ?? "",
      senderName: lead.draft?.senderName,
    };
    if (!email.subject || !email.body) return ephemeral("The subject and message can't be empty.");
    if (!(await claimSend(config, lead))) return ephemeral("That email is already on its way.");
    ctx.waitUntil(sendAndUpdate(config, interaction, lead, email, who));
    return Response.json({ type: DEFERRED_UPDATE });
  }

  return ephemeral("That button isn't recognised.");
}

async function sendAndUpdate(config: Config, interaction: Interaction, lead: Lead, email: Email, who: string): Promise<void> {
  try {
    // Same email = same key, so a double click sends once; an edited email sends fresh.
    const key = `${lead.id}-${(await sha256Hex(`${email.subject}\n${email.body}`)).slice(0, 16)}`;
    await sendEmail(config, lead.email, email, key);
    lead.status = "sent";
    lead.sentEmail = email;
    lead.handledBy = who;
    lead.handledAt = Date.now();
    lead.note = undefined;
  } catch (err) {
    lead.status = "failed";
    lead.draft = email;
    lead.note = (err instanceof Error ? err.message : String(err)).slice(0, 300);
  }
  lead.sendingAt = undefined;
  await saveLead(config, lead);
  try {
    await updateOriginal(config, interaction.application_id, interaction.token, lead);
  } catch (err) {
    console.error(`[lead ${lead.id}] card update failed:`, err);
  }
}
