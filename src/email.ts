import type { Config } from "./config";
import type { Email } from "./types";

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
export function fromAddress(config: Config): string {
  return config.EMAIL_PROVIDER === "resend" ? config.FROM_EMAIL ?? "" : `${config.SENDER_NAME} <${config.GMAIL_USER}>`;
}

/**
 * Sends one email with the provider set in EMAIL_PROVIDER: "gmail" (default)
 * or "resend". The idempotency key only applies to Resend; Gmail double sends
 * are stopped before this is called (see claimSend in interactions.ts).
 */
export async function sendEmail(config: Config, to: string, email: Email, idempotencyKey: string): Promise<void> {
  if (config.EMAIL_PROVIDER === "resend") return sendWithResend(config, to, email, idempotencyKey);
  return sendWithGmail(config, to, email);
}

async function sendWithGmail(config: Config, to: string, email: Email): Promise<void> {
  if (!config.GMAIL_USER || !config.GMAIL_APP_PASSWORD) {
    throw new Error("Gmail isn't set up: GMAIL_USER and GMAIL_APP_PASSWORD are missing");
  }
  // Loaded here because it needs Cloudflare's TCP sockets, which only exist in a deployed worker.
  const { WorkerMailer } = await import("worker-mailer");
  await WorkerMailer.send(
    {
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      credentials: { username: config.GMAIL_USER, password: config.GMAIL_APP_PASSWORD.replace(/\s/g, "") },
      authType: "plain",
    },
    {
      from: { name: email.senderName ?? config.SENDER_NAME, email: config.GMAIL_USER },
      to: { email: to },
      ...(config.REPLY_TO ? { reply: config.REPLY_TO } : {}),
      subject: email.subject,
      text: email.body,
      html: toHtml(email.body),
    },
  );
}

async function sendWithResend(config: Config, to: string, email: Email, idempotencyKey: string): Promise<void> {
  if (!config.RESEND_API_KEY || !config.FROM_EMAIL) {
    throw new Error("Resend isn't set up: RESEND_API_KEY and FROM_EMAIL are missing");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: config.FROM_EMAIL,
      to: [to],
      subject: email.subject,
      text: email.body,
      html: toHtml(email.body),
      ...(config.REPLY_TO ? { reply_to: config.REPLY_TO } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
}
