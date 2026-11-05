export interface Env {
  LEADS: KVNamespace;

  // Secrets (wrangler secret bulk secrets.json)
  DISCORD_BOT_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_CHANNEL_ID: string;
  RESEND_API_KEY: string;
  REPLY_TO?: string;
  ALLOWED_USER_IDS?: string;

  // Vars (wrangler.toml)
  FROM_EMAIL: string;
  SENDER_NAME: string;
  ALLOWED_ORIGINS: string;
  AUTO_SEND_DAILY_LIMIT: string;
}

export interface Email {
  subject: string;
  body: string;
}

export type LeadStatus = "pending" | "review" | "auto_sent" | "sent" | "skipped" | "failed";

/** One submission from the website, cleaned up. */
export interface Submission {
  email: string;
  capturedEmail?: string;
  name?: string;
  institution?: string;
  organizationType?: string;
  phone?: string;
  message?: string;
  sourceForm?: string;
  sourceUrl?: string;
  /** The four-step details dialog was finished (not the hero email box, not a half-filled close). */
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
  note?: string;
  discordMessageId?: string;
}
