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

/** The address emails come from, as people will see it. */
export function fromAddress(env: Env): string {
  return env.EMAIL_PROVIDER === "resend" ? env.FROM_EMAIL : `${env.SENDER_NAME} <${env.GMAIL_USER}>`;
}

/**
 * Sends one email with the provider set in EMAIL_PROVIDER: "gmail" (default)
 * or "resend". The idempotency key only applies to Resend; Gmail double sends
 * are stopped before this is called (see claimSend in interactions.ts).
 */
export async function sendEmail(env: Env, to: string, email: Email, idempotencyKey: string): Promise<void> {
  if (env.EMAIL_PROVIDER === "resend") return sendWithResend(env, to, email, idempotencyKey);
  return sendWithGmail(env, to, email);
}

async function sendWithGmail(env: Env, to: string, email: Email): Promise<void> {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
    throw new Error("Gmail isn't set up: GMAIL_USER and GMAIL_APP_PASSWORD are missing");
  }
  // Loaded here because it needs Cloudflare's TCP sockets, which only exist in a deployed worker.
  const { WorkerMailer } = await import("worker-mailer");
  await WorkerMailer.send(
    {
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      credentials: { username: env.GMAIL_USER, password: env.GMAIL_APP_PASSWORD.replace(/\s/g, "") },
      authType: "plain",
    },
    {
      from: { name: email.senderName ?? env.SENDER_NAME, email: env.GMAIL_USER },
      to: { email: to },
      ...(env.REPLY_TO ? { reply: env.REPLY_TO } : {}),
      subject: email.subject,
      text: email.body,
      html: toHtml(email.body),
    },
  );
}

async function sendWithResend(env: Env, to: string, email: Email, idempotencyKey: string): Promise<void> {
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
