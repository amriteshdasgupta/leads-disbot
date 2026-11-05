import { firstName } from "./lead";
import { autoReply, personalDraft } from "./templates";
import type { Email, Env, Lead } from "./types";

const TOKENS = new Set([
  "first_name", "name", "email", "institution", "sender_name", "greeting",
  "on_behalf_of", "paper_owner", "institution_suffix", "note_acknowledgement",
]);

export function parseEmailTemplate(content: string, label: string): Email {
  const lines = content.replace(/\r\n/g, "\n").trim().split("\n");
  if (!new RegExp(`^${label}\\s+<@!?\\d+>$`).test(lines.shift() ?? "")) {
    throw new Error("Keep the heading and bot mention on the first line");
  }
  const subjectLine = lines.shift() ?? "";
  if (!subjectLine.startsWith("Subject: ")) throw new Error("The second line must start with Subject: ");
  const subject = subjectLine.slice(9).trim();
  const body = lines.join("\n").trim();
  if (!subject || subject.length > 200 || !body || body.length > 4000) {
    throw new Error("Use a subject of 1–200 characters and a message of 1–4000 characters");
  }
  const text = `${subject}\n${body}`;
  for (const match of text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    if (!TOKENS.has(match[1].trim())) throw new Error("The template contains an unknown placeholder");
  }
  if (/[{}]{2}/.test(text.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, ""))) {
    throw new Error("A placeholder is missing its opening or closing braces");
  }
  return { subject, body };
}

export function parseSenderName(content: string): string {
  const [heading, ...lines] = content.replace(/\r\n/g, "\n").trim().split("\n");
  const sender = lines.join("\n").trim();
  if (!/^SENDER_NAME\s+<@!?\d+>$/.test(heading) || !sender || sender.length > 80 || /[\r\n<>\x00-\x1f]/.test(sender)) {
    throw new Error("Keep the heading and use one line of 1–80 characters for the sender name");
  }
  return sender;
}

export function renderEmailTemplate(template: Email, lead: Lead, senderName: string): Email {
  const first = firstName(lead);
  const institution = lead.institution || "";
  const values: Record<string, string> = {
    first_name: first || "there",
    name: lead.name || "there",
    email: lead.email,
    institution,
    sender_name: senderName,
    greeting: first ? `Hi ${first},` : "Hi there,",
    on_behalf_of: institution ? ` on behalf of ${institution}` : "",
    paper_owner: institution ? `${institution}'s` : "your",
    institution_suffix: institution ? ` for ${institution}` : "",
    note_acknowledgement: lead.message ? "\n\nThanks for the note as well. I'll make sure the demo covers it." : "",
  };
  const fill = (text: string) => text.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_, key: string) => values[key.trim()]);
  return {
    subject: fill(template.subject).replace(/[\r\n]+/g, " ").slice(0, 200),
    body: fill(template.body).slice(0, 4000),
    senderName,
  };
}

interface TemplateMessage { channel_id: string; content: string }

async function readSetting<T>(env: Env, messages: TemplateMessage[], failure: string | undefined, label: string, parse: (content: string) => T, warnings: string[]): Promise<T | undefined> {
  const key = `template:${env.DISCORD_TEMPLATES_CHANNEL_ID}:${label}`;
  const cached = await env.LEADS.get(key);
  try {
    if (failure) throw new Error(failure);
    const matches = messages.filter(message => message.content.startsWith(`${label} `));
    if (matches.length !== 1) throw new Error(`Expected exactly one pinned ${label} message`);
    const content = matches[0].content;
    const parsed = parse(content);
    if (cached !== content) {
      try { await env.LEADS.put(key, content); }
      catch { console.warn(`[templates] Could not save the ${label} fallback`); }
    }
    return parsed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Could not read the message";
    console.warn(`[templates] ${label}: ${reason}`);
    warnings.push(`${label}: ${reason}. Using the last saved version or the original default.`);
    if (cached) {
      try { return parse(cached); } catch { /* Use the original default if the cache is invalid too. */ }
    }
    return undefined;
  }
}

export async function emailDrafts(env: Env, lead: Lead) {
  const warnings: string[] = [];
  let automatic: Email | undefined;
  let personal: Email | undefined;
  let sender: string | undefined;
  if (env.DISCORD_TEMPLATES_CHANNEL_ID) {
    let messages: TemplateMessage[] = [];
    let failure: string | undefined;
    try {
      const response = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_TEMPLATES_CHANNEL_ID}/messages/pins?limit=50`, {
        headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) throw new Error(`Discord returned ${response.status}`);
      const data = await response.json() as { items: { message: TemplateMessage }[]; has_more: boolean };
      if (!Array.isArray(data.items) || data.has_more) throw new Error("Keep the three template messages among at most 50 pins");
      messages = data.items.map(item => item.message).filter(message => message?.channel_id === env.DISCORD_TEMPLATES_CHANNEL_ID && typeof message.content === "string");
    } catch (error) {
      failure = error instanceof Error ? error.message : "Could not read the pinned messages";
    }
    [automatic, personal, sender] = await Promise.all([
      readSetting(env, messages, failure, "AUTO_REPLY", (text) => parseEmailTemplate(text, "AUTO_REPLY"), warnings),
      readSetting(env, messages, failure, "PERSONAL_DRAFT", (text) => parseEmailTemplate(text, "PERSONAL_DRAFT"), warnings),
      readSetting(env, messages, failure, "SENDER_NAME", parseSenderName, warnings),
    ]);
  }
  const senderName = sender ?? env.SENDER_NAME;
  return {
    automatic: automatic ? renderEmailTemplate(automatic, lead, senderName) : { ...autoReply(lead, senderName), senderName },
    personal: personal ? renderEmailTemplate(personal, lead, senderName) : { ...personalDraft(lead, senderName), senderName },
    warnings,
  };
}
