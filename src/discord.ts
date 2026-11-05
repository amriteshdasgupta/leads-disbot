import { typeLabel } from "./score";
import type { Email, Env, Lead } from "./types";

const API = "https://discord.com/api/v10";

const COLOURS = {
  review: 0xf5a524,
  pending: 0xf5a524,
  auto_sent: 0x5865f2,
  sent: 0x2ecc71,
  skipped: 0x95a5a6,
  failed: 0xe74c3c,
} as const;

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const when = (ms: number | undefined) => (ms ? `<t:${Math.floor(ms / 1000)}:R>` : "");

function quote(email: Email): string {
  const body = truncate(email.body, 3000)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `**Subject:** ${email.subject}\n${body}`;
}

function statusLine(lead: Lead): string {
  switch (lead.status) {
    case "auto_sent":
      return `📨 **Auto-replied** ${when(lead.handledAt)}. Press **Write follow-up** to send a personal email too.`;
    case "sent":
      return `✅ **Sent by ${lead.handledBy ?? "someone"}** ${when(lead.handledAt)}`;
    case "skipped":
      return `⏭️ **Skipped by ${lead.handledBy ?? "someone"}** ${when(lead.handledAt)}`;
    case "failed":
      return "⚠️ **The email didn't send.** Press **Retry**, or **Edit** to change it first.";
    default:
      return "🟡 **Needs a reply.** Press **Send** to email the draft below, or **Edit** to change it first.";
  }
}

function shownEmail(lead: Lead): { label: string; email?: Email } {
  if (lead.status === "sent") return { label: "Email sent", email: lead.sentEmail };
  if (lead.status === "auto_sent") return { label: "Auto-reply sent", email: lead.autoEmail };
  if (lead.status === "skipped") return { label: "Draft (not sent)", email: lead.draft };
  return { label: "Draft", email: lead.draft };
}

function buttons(lead: Lead) {
  const button = (label: string, style: number, action: string, emoji: string) => ({
    type: 2,
    style,
    label,
    emoji: { name: emoji },
    custom_id: `${action}:${lead.id}`,
  });
  switch (lead.status) {
    case "review":
    case "pending":
      return [button("Send", 3, "send", "✉️"), button("Edit", 1, "edit", "✏️"), button("Skip", 2, "skip", "⏭️")];
    case "failed":
      return [button("Retry", 3, "send", "🔁"), button("Edit", 1, "edit", "✏️"), button("Skip", 2, "skip", "⏭️")];
    case "auto_sent":
      return [button("Write follow-up", 2, "edit", "✏️")];
    default:
      return [];
  }
}

export function leadCard(lead: Lead) {
  const { label, email } = shownEmail(lead);
  const description = [
    statusLine(lead),
    lead.note ? `*${lead.note}*` : "",
    email ? `\n**${label}**\n${quote(email)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const fields = [
    { name: "Type", value: typeLabel(lead.organizationType), inline: true },
    { name: "Email", value: lead.email, inline: true },
    { name: "Phone", value: lead.phone || "–", inline: true },
  ];
  if (lead.message) fields.push({ name: "Their message", value: truncate(lead.message, 1024), inline: false });
  if (lead.score !== undefined) {
    fields.push({ name: `Score ${lead.score}`, value: truncate((lead.reasons ?? []).join(" · "), 1024), inline: false });
  }

  const title = [lead.name || lead.email, lead.institution].filter(Boolean).join(" · ");
  const row = buttons(lead);
  return {
    embeds: [
      {
        title: truncate(title, 256),
        description: truncate(description, 4096),
        color: COLOURS[lead.status],
        fields,
        footer: { text: [lead.sourceForm, lead.complete ? "" : "didn't finish the form"].filter(Boolean).join(" · ") || "website" },
        timestamp: new Date(lead.firstSeen).toISOString(),
      },
    ],
    components: row.length ? [{ type: 1, components: row }] : [],
    allowed_mentions: { parse: [] },
  };
}

/** Posts the lead's card, or updates it if it's already in the channel. Returns the message id. */
export async function postCard(env: Env, lead: Lead): Promise<string> {
  const existing = lead.discordMessageId;
  const response = await fetch(
    `${API}/channels/${env.DISCORD_CHANNEL_ID}/messages${existing ? `/${existing}` : ""}`,
    {
      method: existing ? "PATCH" : "POST",
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(leadCard(lead)),
    },
  );
  if (!response.ok) throw new Error(`Discord ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return ((await response.json()) as { id: string }).id;
}

/** Replaces the card the button was pressed on, after a deferred response. */
export async function updateOriginal(applicationId: string, token: string, lead: Lead): Promise<void> {
  const response = await fetch(`${API}/webhooks/${applicationId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(leadCard(lead)),
  });
  if (!response.ok) throw new Error(`Discord ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

export function composeModal(lead: Lead, email: Email) {
  const input = (id: string, label: string, style: number, value: string, max: number) => ({
    type: 1,
    components: [{ type: 4, custom_id: id, label, style, value: value.slice(0, max), max_length: max, required: true }],
  });
  return {
    custom_id: `compose:${lead.id}`,
    title: truncate(`Email ${lead.name || lead.email}`, 45),
    components: [input("subject", "Subject", 1, email.subject, 200), input("body", "Message", 2, email.body, 4000)],
  };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Checks Discord's Ed25519 signature. Returns the raw body if it's genuine, otherwise null. */
export async function verifyDiscordRequest(request: Request, publicKey: string): Promise<string | null> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  const body = await request.text();
  if (!signature || !timestamp || !/^[0-9a-f]{128}$/i.test(signature) || !/^[0-9a-f]{64}$/i.test(publicKey)) {
    return null;
  }
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body),
    );
    return valid ? body : null;
  } catch {
    return null;
  }
}
