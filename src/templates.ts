import { firstName } from "./lead";
import type { Email, Lead } from "./types";

/**
 * Placeholders a template can use. `paper_owner` is the old name for
 * `org_possessive`, still accepted so existing pinned templates keep working.
 */
export const TOKENS = new Set([
  "first_name", "name", "email", "institution", "sender_name", "product_name", "greeting",
  "on_behalf_of", "org_possessive", "paper_owner", "institution_suffix", "note_acknowledgement",
]);

export const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/**
 * The built-in emails, used until someone pins their own in the templates
 * channel (see discord-templates.ts). Written with the same placeholders.
 */
export const DEFAULT_TEMPLATES: Record<"AUTO_REPLY" | "PERSONAL_DRAFT", Email> = {
  // Sent straight away to leads that don't need a personal reply.
  AUTO_REPLY: {
    subject: "Thanks for your interest in {{product_name}}",
    body: [
      "{{greeting}}",
      "",
      "Thanks for getting in touch about {{product_name}}. We've got your details and would love to help.",
      "",
      "To set up a quick call, just reply to this email with:",
      "- a couple of days and times that suit you, and your time zone",
      "- anything in particular you'd like us to cover",
      "",
      "Thanks,",
      "{{sender_name}}",
      "{{product_name}}",
    ].join("\n"),
  },
  // The personal draft that waits in Discord for a Send click.
  PERSONAL_DRAFT: {
    subject: "Getting started with {{product_name}}{{institution_suffix}}",
    body: [
      "{{greeting}}",
      "",
      "Thanks for reaching out{{on_behalf_of}}. I'd love to hear more about what you need and show you how {{product_name}} could work for {{org_possessive}} team.{{note_acknowledgement}}",
      "",
      "Could you reply with a couple of times that work for a 30-minute call this week or next, and your time zone?",
      "",
      "Best,",
      "{{sender_name}}",
      "{{product_name}}",
    ].join("\n"),
  },
};

/** Fills a template's placeholders from the lead. Lead data is never read as placeholders itself. */
export function renderEmailTemplate(template: Email, lead: Lead, senderName: string, productName: string): Email {
  const first = firstName(lead);
  const org = lead.institution || "";
  const values: Record<string, string> = {
    first_name: first || "there",
    name: lead.name || "there",
    email: lead.email,
    institution: org,
    sender_name: senderName,
    product_name: productName,
    greeting: first ? `Hi ${first},` : "Hi there,",
    on_behalf_of: org ? ` on behalf of ${org}` : "",
    org_possessive: org ? `${org}'s` : "your",
    paper_owner: org ? `${org}'s` : "your",
    institution_suffix: org ? ` for ${org}` : "",
    note_acknowledgement: lead.message ? "\n\nThanks for the note as well. I'll make sure we cover it." : "",
  };
  const fill = (text: string) => text.replace(PLACEHOLDER, (_, key: string) => values[key.trim()] ?? "");
  return {
    subject: fill(template.subject).replace(/[\r\n]+/g, " ").slice(0, 200),
    body: fill(template.body).slice(0, 4000),
    senderName,
  };
}
