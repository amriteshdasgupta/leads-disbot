import { z } from "zod";
import type { Env } from "./types";

/** Thrown when wrangler.toml or the secrets hold a value the worker can't use. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

// Wrangler passes vars as strings (or numbers, if written unquoted), and an
// empty string means "not set", so blanks fall through to the default.
const blank = (value: unknown) => (value === "" ? undefined : value);
const text = z.preprocess(blank, z.string().trim().optional());
const required = (hint: string) => z.preprocess(blank, z.string({ error: `is missing: ${hint}` }).trim().min(1, `is missing: ${hint}`));
const list = z.preprocess(blank, z.string().default("")).transform((value) =>
  value.split(",").map((item) => item.trim()).filter(Boolean),
);
const count = (fallback: number) =>
  z.preprocess(blank, z.coerce.number({ error: "must be a whole number" }).int("must be a whole number").min(0, "can't be negative").default(fallback));

const origins = list.pipe(
  z
    .array(
      z.string().refine((origin) => URL.canParse(origin) && new URL(origin).origin === origin, {
        error: (issue) => `"${issue.input}" isn't an origin. Use scheme://host[:port], with no path or trailing slash`,
      }),
    )
    .min(1, "is empty: list the website origins allowed to send leads, like https://example.com"),
);

const labels = z
  .preprocess(blank, z.string().default("{}"))
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "isn't valid JSON" });
      return z.NEVER;
    }
  })
  .pipe(
    z.record(z.string(), z.string({ error: "must be a string" }), {
      error: 'must be a JSON object of labels, like {"Agency": "Marketing agency"}',
    }),
  );

const schema = z.object({
  LEADS: z.custom<KVNamespace>((value) => typeof value === "object" && value !== null, {
    error: "is missing: bind a KV namespace as LEADS in wrangler.toml (npm run setup does this)",
  }),

  // Vars
  PRODUCT_NAME: required("set it in [vars] to your product or company name"),
  SENDER_NAME: required("set it in [vars] to the name emails are signed with"),
  EMAIL_PROVIDER: z.preprocess(blank, z.enum(["gmail", "resend"]).default("gmail")),
  FROM_EMAIL: text,
  ALLOWED_ORIGINS: origins,
  AUTO_SEND_DAILY_LIMIT: count(40),
  REVIEW_SCORE: count(4),
  REVIEW_ORGANIZATION_TYPES: list,
  ORGANIZATION_TYPE_LABELS: labels,
  DISCORD_TEMPLATES_CHANNEL_ID: z.preprocess(blank, z.string().regex(/^\d+$/, "must be a Discord channel ID (digits only) or empty").optional()),

  // Secrets: checked where they're used, so a missing one shows up on the lead card or in the logs.
  DISCORD_BOT_TOKEN: text,
  DISCORD_PUBLIC_KEY: text,
  DISCORD_CHANNEL_ID: text,
  GMAIL_USER: text,
  GMAIL_APP_PASSWORD: text,
  RESEND_API_KEY: text,
  REPLY_TO: text,
  ALLOWED_USER_IDS: list,
});

export type Config = z.output<typeof schema>;

/** Validates the worker's bindings, vars and secrets, and fills in defaults. */
export function loadConfig(env: Env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `- ${issue.path.join(".")} ${issue.message}`);
    throw new ConfigError(`lead-responder isn't configured correctly:\n${problems.join("\n")}`);
  }
  return result.data;
}
