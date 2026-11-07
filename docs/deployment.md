# Deploying leads-disbot

A step-by-step guide to running your own copy, with what to expect after each step. It takes about 30 minutes. Do the steps in order: some need values from earlier ones.

The [README](../README.md) has the same steps in short, plus the full configuration reference.

## Before you start

- **Never commit a secret.** Tokens and passwords go only into `secrets.json`, which git ignores, and you delete it after step 6.
- **Never paste a secret into Discord, GitHub issues or chat.**
- Write these values down as you go:

| Value | From step | Secret? |
| --- | --- | --- |
| Worker URL (`https://leads-disbot.<your-subdomain>.workers.dev`) | 2 | No |
| Gmail address, or Resend API key | 4 | The API key is |
| Gmail app password (16 letters) | 4 | **Yes** |
| Discord Application ID | 5 | No |
| Discord Public Key (64 hex characters) | 5 | No, but keep it with the others |
| Discord bot token | 5 | **Yes** |
| Discord channel ID for lead cards | 5 | No |

## 1. Get the code

You need Node.js 22 or newer.

```sh
git clone https://github.com/amriteshdasgupta/leads-disbot.git
cd leads-disbot
npm ci
npm test
```

✅ Expected: every test passes.

## 2. Cloudflare: create the worker

1. Sign in to Cloudflare, or create a free account at <https://dash.cloudflare.com/sign-up>.
2. In the terminal:

   ```sh
   npx wrangler login   # opens the browser: press Allow
   npm run setup        # creates wrangler.toml and the KV namespace
   ```

   `npm run setup` copies `wrangler.example.toml` to `wrangler.toml` (which git ignores) and writes the new KV namespace's id into it.

3. Open `wrangler.toml` and set the `[vars]`:
   - `PRODUCT_NAME`: your product or company name.
   - `SENDER_NAME`: the name emails are signed with.
   - `ALLOWED_ORIGINS`: every origin your form is on, comma-separated, like `https://example.com,https://www.example.com`.
   - Optionally `REVIEW_ORGANIZATION_TYPES`, `ORGANIZATION_TYPE_LABELS` and `REVIEW_SCORE` to match your form. See [Scoring](../README.md#scoring).
4. Deploy:

   ```sh
   npm run deploy
   ```

   If wrangler asks you to register a `workers.dev` subdomain, pick one.
5. The output ends with a URL like `https://leads-disbot.<your-subdomain>.workers.dev`. That's the **Worker URL**. Open it in a browser.

✅ Expected: the page says `leads-disbot is running`. If it says the worker is misconfigured, run `npx wrangler tail`, reload the page, and the log lists what to fix in `wrangler.toml`.

## 3. Decide who can press the buttons

By default, anyone who can see the leads channel can send emails from it. That's usually what you want for a private team channel. To limit it to certain people, collect their Discord user IDs (with Developer Mode on, right-click a person → **Copy User ID**) for `ALLOWED_USER_IDS` in step 6.

## 4. Email: Gmail or Resend

### Gmail (default)

Emails go out from a Gmail account and show up in its **Sent** folder. Replies land in its inbox.

1. Sign in to the Gmail account in your browser.
2. Open <https://myaccount.google.com/signinoptions/twosv> and check **2-Step Verification** is **On**. App passwords don't exist without it.
3. Open <https://myaccount.google.com/apppasswords>, name it `leads-disbot`, and press **Create**.
4. Copy the 16-letter password (like `abcd efgh ijkl mnop`). It's only shown once.

If the app passwords page says the setting isn't available, 2-Step Verification is off, or it's a Google Workspace account whose admin blocks app passwords.

### Resend

To send from your own domain instead:

1. Sign up at [Resend](https://resend.com), add your domain, and add the DNS records it shows at your DNS provider. Leave your existing SPF and MX records alone; Resend's records sit alongside them.
2. Once the domain shows **Verified**, create an API key.
3. In `wrangler.toml`, set `EMAIL_PROVIDER = "resend"` and `FROM_EMAIL`, like `Jordan from Example Co <hello@example.com>`.

## 5. Discord: create the bot

1. Go to <https://discord.com/developers/applications>, signed in to an account that can manage your Discord server. Press **New Application** and name it, for example `Leads`.
2. On **General Information**, copy the **Application ID** and the **Public Key**. Leave this tab open for step 7.
3. On **Bot**:
   - Press **Reset Token**, confirm, and copy the **bot token**. It's only shown once.
   - Leave all three Privileged Gateway Intents **off**.
4. Add the bot to your server. Open this URL with your Application ID in place of `<APPLICATION_ID>`, pick the server and press **Authorize**:

   ```
   https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot%20applications.commands&permissions=84992
   ```

   `84992` is View Channel (1024) + Send Messages (2048) + Embed Links (16384) + Read Message History (65536).
5. In the Discord app, turn on **User Settings → Advanced → Developer Mode**.
6. Right-click the channel where lead cards should appear → **Copy Channel ID**.
   - If the channel is private, open **Edit Channel → Permissions** and give the bot View Channel, Send Messages, Embed Links and Read Message History.
7. Optional: on **Installation**, set Install Link to **None**, then on **Bot**, turn **Public Bot** off, so nobody else can add your bot to their server.

## 6. Give the worker its secrets

```sh
cp secrets.example.json secrets.json
```

Fill in `secrets.json`:

| Key | Value |
| --- | --- |
| `DISCORD_BOT_TOKEN` | The bot token |
| `DISCORD_PUBLIC_KEY` | The Public Key |
| `DISCORD_CHANNEL_ID` | The channel ID for lead cards |
| `GMAIL_USER` | The Gmail address (Gmail only) |
| `GMAIL_APP_PASSWORD` | The app password; spaces are fine (Gmail only) |
| `RESEND_API_KEY` | The Resend API key (Resend only) |
| `REPLY_TO` | Optional: where replies should go, if not the sending address |
| `ALLOWED_USER_IDS` | Optional: comma-separated Discord user IDs from step 3. Empty lets anyone in the channel press the buttons. |

Leave unused keys as `""`. Then:

```sh
npx wrangler secret bulk secrets.json
rm secrets.json
```

✅ Expected: wrangler says the secrets were uploaded, and `git status` doesn't list `secrets.json`.

## 7. Discord: connect the buttons to the worker

1. Back on the Discord application's **General Information** page, set **Interactions Endpoint URL** to the Worker URL followed by `/discord`, like `https://leads-disbot.<your-subdomain>.workers.dev/discord`.
2. Press **Save Changes**.

✅ Expected: Discord saves without an error. It tests the URL before saving. If it says the URL couldn't be verified:

- `DISCORD_PUBLIC_KEY` is wrong or missing. Redo step 6 with the exact Public Key from this page.
- Or the URL is wrong. It must end in `/discord`, and the Worker URL must open in a browser (step 2).

## 8. Website: send leads to the worker

Have your form post each submission to the Worker URL followed by `/lead`, from a page on one of your `ALLOWED_ORIGINS`. The [README](../README.md#6-send-leads-from-your-website) has an example `fetch` call and the payload fields.

Keep sending submissions wherever they go today (a form service, your CRM) as well, at least until you've tested this. Each lead then also has a copy outside Workers KV.

## 9. Test it end to end

Use email addresses you can read, and a different one for each test: each address is only handled once. Gmail plus-addresses work well, like `you+lead1@gmail.com`, `you+lead2@gmail.com`.

**Test A, automatic reply:** submit your form with a personal email address, no organization name, and a type that isn't in `REVIEW_ORGANIZATION_TYPES` (or `Individual`).

✅ Expected within a minute:
- The test inbox gets "Thanks for your interest in …" from your sending address. Check spam the first time.
- Discord shows a blue card "📨 Auto-replied" with a **Write follow-up** button.

**Test B, review and send:** submit again with a new address, an organization name, a phone number and a message (or a type in `REVIEW_ORGANIZATION_TYPES`).

✅ Expected:
- No email yet.
- Discord shows an amber card "🟡 Needs a reply" with a draft and **Send / Edit / Skip**.
- Press **Edit**, change a word, and press **Submit**. The card turns green ("✅ Sent by …"), and the test inbox gets the edited email.

**Test C, reply:** reply to either test email. ✅ The reply arrives in the sending inbox (or `REPLY_TO`).

## 10. Optional: edit emails from Discord

To change the email wording without deploying, set up a templates channel as described in [Editing emails from Discord](../README.md#editing-emails-from-discord).

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| The Worker URL says "misconfigured" | Run `npx wrangler tail` and reload. The log lists each setting to fix in `wrangler.toml`. |
| No card in Discord after a test | Run `npx wrangler tail` while submitting. `Discord 403` means the bot can't see or post in the channel (step 5.6). `Discord 401` means the bot token is wrong (step 6). |
| A card appears, but no email arrives | The card says "didn't send" with the reason. `535 Username and Password not accepted` means a wrong `GMAIL_USER` or app password: make a new app password and run `npx wrangler secret put GMAIL_APP_PASSWORD`. Also check spam. |
| Nothing reaches the worker at all | In your browser's DevTools Network tab on your site, look for the request to `…/lead`. Status 403 means the page's origin isn't in `ALLOWED_ORIGINS` (check `www.` and `https://`). |
| A button says "Only allowed team members can reply to leads." | `ALLOWED_USER_IDS` doesn't include that person. Add them, or run `npx wrangler secret delete ALLOWED_USER_IDS` to let everyone in the channel. |
| "This interaction failed" in Discord | The Interactions Endpoint URL is wrong, or the worker is down. Open the Worker URL in a browser. |
| A card says "Check the email templates in #…" | A pinned template is missing, duplicated or invalid. The card says which, and the bot uses the last valid version meanwhile. |

## Updating

```sh
git pull
npm ci
npm test
npm run deploy
```

Your `wrangler.toml` is gitignored, so pulling never overwrites it. When a release adds new vars, compare it with `wrangler.example.toml`; new vars have defaults unless the release notes say otherwise.
