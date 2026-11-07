import type { Config } from "./config";
import { DEFAULT_TEMPLATES, PLACEHOLDER, renderEmailTemplate, TOKENS } from "./templates";
import type { Email, Lead } from "./types";

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
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (!TOKENS.has(match[1].trim())) throw new Error("The template contains an unknown placeholder");
  }
  if (/[{}]{2}/.test(text.replace(PLACEHOLDER, ""))) {
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

interface TemplateMessage { channel_id: string; content: string }

async function readSetting<T>(config: Config, messages: TemplateMessage[], failure: string | undefined, label: string, parse: (content: string) => T, warnings: string[]): Promise<T | undefined> {
  const key = `template:${config.DISCORD_TEMPLATES_CHANNEL_ID}:${label}`;
  const cached = await config.LEADS.get(key);
  try {
    if (failure) throw new Error(failure);
    const matches = messages.filter(message => message.content.startsWith(`${label} `));
    if (matches.length !== 1) throw new Error(`Expected exactly one pinned ${label} message`);
    const content = matches[0].content;
    const parsed = parse(content);
    if (cached !== content) {
      try { await config.LEADS.put(key, content); }
      catch { console.warn(`[templates] Could not save the ${label} fallback`); }
    }
    return parsed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Could not read the message";
    console.warn(`[templates] ${label}: ${reason}`);
    warnings.push(`${label}: ${reason}. Using the last saved version or the built-in default.`);
    if (cached) {
      try { return parse(cached); } catch { /* Use the built-in default if the cache is invalid too. */ }
    }
    return undefined;
  }
}

/**
 * The automatic reply and personal draft for a lead, from the templates pinned
 * in DISCORD_TEMPLATES_CHANNEL_ID, or the built-in defaults when there's no
 * such channel. Warnings say which pins couldn't be used.
 */
export async function emailDrafts(config: Config, lead: Lead) {
  const warnings: string[] = [];
  let automatic: Email | undefined;
  let personal: Email | undefined;
  let sender: string | undefined;
  const channel = config.DISCORD_TEMPLATES_CHANNEL_ID;
  if (channel) {
    let messages: TemplateMessage[] = [];
    let failure: string | undefined;
    try {
      const response = await fetch(`https://discord.com/api/v10/channels/${channel}/messages/pins?limit=50`, {
        headers: { Authorization: `Bot ${config.DISCORD_BOT_TOKEN}` },
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) throw new Error(`Discord returned ${response.status}`);
      const data = await response.json() as { items: { message: TemplateMessage }[]; has_more: boolean };
      if (!Array.isArray(data.items) || data.has_more) throw new Error("Keep the three template messages among at most 50 pins");
      messages = data.items.map(item => item.message).filter(message => message?.channel_id === channel && typeof message.content === "string");
    } catch (error) {
      failure = error instanceof Error ? error.message : "Could not read the pinned messages";
    }
    [automatic, personal, sender] = await Promise.all([
      readSetting(config, messages, failure, "AUTO_REPLY", (text) => parseEmailTemplate(text, "AUTO_REPLY"), warnings),
      readSetting(config, messages, failure, "PERSONAL_DRAFT", (text) => parseEmailTemplate(text, "PERSONAL_DRAFT"), warnings),
      readSetting(config, messages, failure, "SENDER_NAME", parseSenderName, warnings),
    ]);
  }
  const senderName = sender ?? config.SENDER_NAME;
  const render = (template: Email) => renderEmailTemplate(template, lead, senderName, config.PRODUCT_NAME);
  return {
    automatic: render(automatic ?? DEFAULT_TEMPLATES.AUTO_REPLY),
    personal: render(personal ?? DEFAULT_TEMPLATES.PERSONAL_DRAFT),
    warnings,
  };
}
