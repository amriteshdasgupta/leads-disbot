import type { Config } from "./config";
import type { Lead } from "./types";

type ScoreConfig = Pick<Config, "REVIEW_ORGANIZATION_TYPES" | "REVIEW_SCORE" | "ORGANIZATION_TYPE_LABELS">;

/** Personal email providers: a lead writing from one of these gets no work-email points. */
const FREE_EMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "yahoo.com.au",
  "hotmail.com", "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "aol.com",
  "proton.me", "protonmail.com", "rediffmail.com", "gmx.com", "mail.com", "yandex.com",
  "zoho.com", "bigpond.com", "qq.com", "163.com",
]);

export interface Score {
  score: number;
  reasons: string[];
  review: boolean;
}

/**
 * Points for how much a lead looks worth a personal reply:
 *
 * - organizationType in REVIEW_ORGANIZATION_TYPES: +3, and always reviewed
 * - any other organizationType except "Individual": +1
 * - an organization name (the `institution` field): +1
 * - an email address that isn't from a free provider: +2
 * - a phone number: +1
 * - a message of 20 characters or more: +1
 *
 * Leads at REVIEW_SCORE or above also go to Discord for review; the rest are auto-replied.
 */
export function scoreLead(lead: Lead, config: ScoreConfig): Score {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(points ? `${reason} (+${points})` : reason);
  };

  const type = lead.organizationType;
  const reviewType = !!type && config.REVIEW_ORGANIZATION_TYPES.includes(type);
  if (reviewType) add(3, typeLabel(type, config));
  else if (type === "Individual") add(0, typeLabel(type, config));
  else if (type) add(1, typeLabel(type, config));
  else add(0, "No details given");

  if (lead.institution && lead.institution.length >= 2) add(1, "Named organization");

  const domain = lead.email.split("@")[1] ?? "";
  if (FREE_EMAIL.has(domain)) add(0, `Personal email (${domain})`);
  else add(2, `Work email (${domain})`);

  if (lead.phone) add(1, "Phone number");
  if (lead.message && lead.message.length >= 20) add(1, "Wrote a message");

  return { score, reasons, review: reviewType || score >= config.REVIEW_SCORE };
}

/** How an organizationType value is shown on cards, from ORGANIZATION_TYPE_LABELS. */
export function typeLabel(type: string | undefined, config: Pick<Config, "ORGANIZATION_TYPE_LABELS">): string {
  if (!type) return "Not given";
  return config.ORGANIZATION_TYPE_LABELS[type] ?? type;
}
