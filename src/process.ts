import { postCard } from "./discord";
import { sendEmail } from "./email";
import { scoreLead } from "./score";
import { getLead, listDueLeadIds, saveLead, takeAutoSendSlot } from "./store";
import { emailDrafts } from "./discord-templates";
import type { Config } from "./config";
import type { Lead } from "./types";

const MAX_ATTEMPTS = 5;
const RETRY_MS = 5 * 60_000;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * Scores a lead, auto-replies or drafts a personal email, and puts its card in
 * Discord. Saves before posting, so a Discord failure never resends an email.
 */
export async function processLead(config: Config, lead: Lead, now = Date.now()): Promise<void> {
  lead.attempts = (lead.attempts ?? 0) + 1;
  const { score, reasons, review } = scoreLead(lead, config);
  lead.score = score;
  lead.reasons = reasons;
  const drafts = await emailDrafts(config, lead);
  lead.draft ??= drafts.personal;
  if (drafts.warnings.length) {
    lead.note = `Check the email templates in <#${config.DISCORD_TEMPLATES_CHANNEL_ID}>. ${drafts.warnings.join(" ")}`;
  }

  if (lead.status === "pending") {
    if (!review && (await takeAutoSendSlot(config, now))) {
      const email = drafts.automatic;
      try {
        await sendEmail(config, lead.email, email, `${lead.id}-auto`);
        lead.status = "auto_sent";
        lead.autoEmail = email;
        lead.handledAt = now;
      } catch (err) {
        console.error(`[lead ${lead.id}] auto-reply failed:`, errorText(err));
        lead.status = "review";
        lead.note = `The auto-reply didn't send (${errorText(err)}), so this one is waiting for you.`;
      }
    } else {
      lead.status = "review";
      if (!review) {
        lead.note = config.AUTO_SEND_DAILY_LIMIT
          ? "Today's auto-reply limit was reached, so this one is waiting for you."
          : "Auto-replies are off (AUTO_SEND_DAILY_LIMIT is 0), so this one is waiting for you.";
      }
    }
  }
  await saveLead(config, lead);

  try {
    lead.discordMessageId = await postCard(config, lead);
    await saveLead(config, lead);
  } catch (err) {
    console.error(`[lead ${lead.id}] Discord card failed:`, errorText(err));
    // A lead waiting for review must reach Discord, so try again on a later run.
    if (lead.status === "review" && !lead.discordMessageId && lead.attempts < MAX_ATTEMPTS) {
      lead.status = "pending";
      lead.dueAt = now + RETRY_MS;
      await saveLead(config, lead);
    }
  }
}

/** Cron: handles leads whose wait is over (unfinished forms) and retries. */
export async function processDueLeads(config: Config, now = Date.now()): Promise<void> {
  for (const id of await listDueLeadIds(config, now)) {
    const lead = await getLead(config, id);
    if (!lead || lead.status !== "pending") continue;
    try {
      await processLead(config, lead, now);
    } catch (err) {
      console.error(`[lead ${id}] processing failed:`, errorText(err));
    }
  }
}
