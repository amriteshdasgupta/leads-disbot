import type { Config } from "./config";

/**
 * The worker's bindings as Cloudflare passes them: vars from wrangler.toml and
 * secrets from `wrangler secret`. Read them through loadConfig() (config.ts),
 * which validates them and fills in defaults.
 */
export interface Env {
  LEADS: KVNamespace;

  // Vars (wrangler.toml)
  PRODUCT_NAME?: string;
  SENDER_NAME?: string;
  EMAIL_PROVIDER?: string;
  FROM_EMAIL?: string;
  ALLOWED_ORIGINS?: string;
  AUTO_SEND_DAILY_LIMIT?: string | number;
  REVIEW_SCORE?: string | number;
  REVIEW_ORGANIZATION_TYPES?: string;
  ORGANIZATION_TYPE_LABELS?: string;
  DISCORD_TEMPLATES_CHANNEL_ID?: string;

  // Secrets (wrangler secret bulk secrets.json)
  DISCORD_BOT_TOKEN?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_CHANNEL_ID?: string;
  GMAIL_USER?: string;
  GMAIL_APP_PASSWORD?: string;
  RESEND_API_KEY?: string;
  REPLY_TO?: string;
  ALLOWED_USER_IDS?: string;
}

/** Hono's view of the worker: the raw bindings, plus the config loaded for each request. */
export interface AppEnv {
  Bindings: Env;
  Variables: { config: Config };
}

export interface Email {
  subject: string;
  body: string;
  senderName?: string;
}

export type LeadStatus = "pending" | "review" | "auto_sent" | "sent" | "skipped" | "failed";

/** One submission from the website, cleaned up. */
export interface Submission {
  email: string;
  capturedEmail?: string;
  name?: string;
  /** The organization or company name. Called "institution" on the wire for older forms. */
  institution?: string;
  organizationType?: string;
  phone?: string;
  message?: string;
  sourceForm?: string;
  sourceUrl?: string;
  /** The full form was sent (not just an email-capture box or a half-filled form). */
  complete: boolean;
}

/** One person, merged across all their submissions. Keyed by email. */
export interface Lead {
  id: string;
  email: string;
  name?: string;
  institution?: string;
  organizationType?: string;
  phone?: string;
  message?: string;
  sourceForm?: string;
  sourceUrl?: string;
  complete: boolean;
  firstSeen: number;
  updatedAt: number;
  /** When the lead is processed if it isn't finished first (cron picks it up). */
  dueAt: number;
  status: LeadStatus;
  attempts?: number;
  score?: number;
  reasons?: string[];
  /** The personal email waiting for a Send click. */
  draft?: Email;
  autoEmail?: Email;
  sentEmail?: Email;
  handledBy?: string;
  handledAt?: number;
  /** Set while a Send is in flight, so a second click doesn't send twice. */
  sendingAt?: number;
  note?: string;
  discordMessageId?: string;
}
