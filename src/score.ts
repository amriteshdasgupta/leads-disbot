import type { Lead } from "./types";

/** Organisation types that always come to Discord for a personal reply. */
const ORGANISATIONS = new Set(["School", "College", "Tutoring Center"]);

/** Anything at or above this also comes to Discord, whatever the type. */
export const REVIEW_SCORE = 4;

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

export function scoreLead(lead: Lead): Score {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(points ? `${reason} (+${points})` : reason);
  };

  const type = lead.organizationType;
  if (type && ORGANISATIONS.has(type)) add(3, typeLabel(type));
  else if (type === "Other") add(1, "Other organisation");
  else if (type === "Individual") add(0, "Individual tutor");
  else add(0, "No details given");

  if (lead.institution && lead.institution.length >= 2) add(1, "Named institution");

  const domain = lead.email.split("@")[1] ?? "";
  if (FREE_EMAIL.has(domain)) add(0, `Personal email (${domain})`);
  else add(2, `Work email (${domain})`);

  if (lead.phone) add(1, "Phone number");
  if (lead.message && lead.message.length >= 20) add(1, "Wrote a message");

  return { score, reasons, review: (!!type && ORGANISATIONS.has(type)) || score >= REVIEW_SCORE };
}

export function typeLabel(type: string | undefined): string {
  switch (type) {
    case "Tutoring Center":
      return "Tutoring / coaching centre";
    case "College":
      return "College / university";
    case "Individual":
      return "Individual tutor";
    default:
      return type ?? "Not given";
  }
}
