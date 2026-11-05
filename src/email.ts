import type { Email, Env } from "./types";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function toHtml(body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">${paragraphs}</div>`;
}

/**
 * Sends through Resend. The idempotency key makes a double click (or a retried
 * job) send the same email once.
 */
export async function sendEmail(env: Env, to: string, email: Email, idempotencyKey: string): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [to],
      subject: email.subject,
      text: email.body,
      html: toHtml(email.body),
      ...(env.REPLY_TO ? { reply_to: env.REPLY_TO } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
}
