import { z } from "zod";
import type { Lead, Submission } from "./types";

/** Finished form: process right away (the delay is only a retry fallback). */
export const COMPLETE_RETRY_MS = 5 * 60_000;
/** Email-only or half-filled: wait in case the person finishes the form. */
export const INCOMPLETE_WAIT_MS = 15 * 60_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FIELDS = ["name", "institution", "organizationType", "phone", "message"] as const;

// Lenient on purpose: a field that's missing or the wrong type becomes "",
// so one odd field never loses the whole lead.
const text = (max: number) => z.string().catch("").transform((value) => value.trim().slice(0, max));
const flag = z.boolean().catch(false);

const Payload = z.object({
  _gotcha: text(200),
  email: text(254).transform((value) => value.toLowerCase()),
  capturedEmail: text(254).transform((value) => value.toLowerCase()),
  name: text(200),
  institution: text(200),
  organizationType: text(200),
  phone: text(200),
  message: text(2000),
  sourceForm: text(100),
  sourceUrl: text(200),
  partial: flag,
  emailCapture: flag,
});

/**
 * Turns a website form payload into a Submission. Returns null for anything
 * that isn't a usable lead, including honeypot hits.
 */
export function parseSubmission(body: unknown): Submission | null {
  const parsed = Payload.safeParse(body);
  if (!parsed.success) return null;
  const b = parsed.data;
  if (b._gotcha || !EMAIL_RE.test(b.email)) return null;

  const sub: Submission = {
    email: b.email,
    sourceForm: b.sourceForm || undefined,
    sourceUrl: b.sourceUrl || undefined,
    complete: !b.partial && !b.emailCapture && b.name.length >= 2,
  };
  for (const field of FIELDS) {
    if (b[field]) sub[field] = b[field];
  }
  if (EMAIL_RE.test(b.capturedEmail) && b.capturedEmail !== b.email) sub.capturedEmail = b.capturedEmail;
  return sub;
}

export function mergeLead(existing: Lead | null, sub: Submission, id: string, now: number): Lead {
  const lead: Lead = existing
    ? { ...existing }
    : { id, email: sub.email, complete: false, firstSeen: now, updatedAt: now, dueAt: now, status: "pending" };
  for (const field of FIELDS) {
    if (sub[field]) lead[field] = sub[field];
  }
  lead.sourceForm = sub.sourceForm ?? lead.sourceForm;
  lead.sourceUrl = sub.sourceUrl ?? lead.sourceUrl;
  lead.complete = lead.complete || sub.complete;
  lead.updatedAt = now;
  lead.dueAt = now + (lead.complete ? COMPLETE_RETRY_MS : INCOMPLETE_WAIT_MS);
  return lead;
}

export function firstName(lead: Lead): string | undefined {
  const first = lead.name?.split(/\s+/)[0];
  return first && first.length >= 2 ? first : undefined;
}
