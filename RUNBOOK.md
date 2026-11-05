# Setup runbook

Step-by-step setup for whoever deploys this (written for Astra). It takes about 30 minutes. Do the steps in order: some depend on values from earlier ones.

Alex doesn't want to be involved, so only ask them when a step says **Ask Alex**.

## Rules

- **Never commit a secret.** Tokens and keys go only into `secrets.json`, which git ignores, and are deleted after step 5.
- **Never paste a secret into Discord, GitHub issues or chat.**
- Write down these values as you go. You'll need them later:

| Value | From step | Secret? |
| --- | --- | --- |
| Worker URL (`https://lead-responder.<something>.workers.dev`) | 2 | No |
| Gmail address | 3 | No |
| Gmail app password (16 letters) | 3 | **Yes** |
| Discord Public Key (64 hex characters) | 4 | No, but keep it with the others |
| Discord Bot Token | 4 | **Yes** |
| Discord channel ID | 4 | No |
| Alex's Discord user ID | 4 | No |

---

## 1. Get the code

Needs Node.js 20 or newer and access to the GitHub repository.

```sh
git clone git@github.com:your-org/lead-responder.git
cd lead-responder
npm ci
npm test
```

✅ Expected: `Tests  22 passed`.

## 2. Cloudflare: create the worker

1. Sign in to Cloudflare. If Acme already has a Cloudflare account, use it. Otherwise **Ask Alex** which email to sign up with, and create a free account at <https://dash.cloudflare.com/sign-up>.
2. In the terminal:

   ```sh
   npx wrangler login        # opens the browser: press Allow
   npm run setup             # creates the KV store and writes its id into wrangler.toml
   git add wrangler.toml
   git commit -m "Set the KV namespace id"
   git push
   npm run deploy
   ```

   If `npm run deploy` asks you to register a `workers.dev` subdomain, pick something like `acme`.
3. The deploy output ends with a URL like `https://lead-responder.your-subdomain.workers.dev`. That's the **Worker URL**.
4. Open the Worker URL in a browser.

✅ Expected: the page says `lead-responder is running`.

## 3. Gmail: let the worker send from Alex's Gmail

Emails go out from Alex's personal Gmail and show up in its **Sent** folder. Leads' replies land in the same inbox.

1. **Ask Alex** which Gmail address to send from, and to sign in to it in the browser (or do this step themselves; it takes 2 minutes).
2. Open <https://myaccount.google.com/signinoptions/twosv> and check **2-Step Verification** is **On**. If it's off, turn it on and follow Google's prompts. App passwords don't exist without it.
3. Open <https://myaccount.google.com/apppasswords>. Name it `lead-responder` and press **Create**.
4. Google shows a 16-letter password in four groups (like `abcd efgh ijkl mnop`). Copy it. That's the **Gmail app password**, and it's only shown once.

If the app passwords page says the setting isn't available, 2-Step Verification is off (step 2), or it's a work/school account whose admin blocks app passwords. Use a personal @gmail.com account.

## 4. Discord: create the bot

1. Go to <https://discord.com/developers/applications> while signed in to the Discord account that's an admin of the server where the Formspree lead messages appear. Press **New Application**, name it `Acme Leads`, and accept the terms.
2. On **General Information**, copy **Public Key**. That's the **Discord Public Key**. Leave this tab open; you'll come back in step 6.
3. On **Bot**:
   - Press **Reset Token**, confirm, and copy the token. That's the **Discord Bot Token**, and it's only shown once.
   - Leave all three "Privileged Gateway Intents" **off**. The bot doesn't need them.
4. Add the bot to the server. Open this URL, replacing `APP_ID` with the **Application ID** from General Information:

   ```
   https://discord.com/oauth2/authorize?client_id=APP_ID&scope=bot&permissions=84992
   ```

   Pick the server and press **Authorize**. (84992 = View Channels, Send Messages, Embed Links, Read Message History.)
5. In the Discord app, turn on **User Settings → Advanced → Developer Mode**.
6. Find the channel where Formspree lead messages already appear. Right-click it → **Copy Channel ID**. That's the **Discord channel ID**.
   - If the channel is private, open **Edit Channel → Permissions** and add `Acme Leads` with View Channel, Send Messages, Embed Links and Read Message History.
7. Right-click Alex's name in the member list → **Copy User ID**. That's **Alex's Discord user ID**. If other teammates should be able to press Send, copy theirs too.
8. Optional: on **Installation**, set Install Link to **None**, then on **Bot**, turn **Public Bot** off. That stops anyone else adding the bot to their server.

## 5. Give the worker its settings

```sh
cp secrets.example.json secrets.json
```

Fill in `secrets.json`:

| Key | Value |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Discord Bot Token |
| `DISCORD_PUBLIC_KEY` | Discord Public Key |
| `DISCORD_CHANNEL_ID` | Discord channel ID |
| `GMAIL_USER` | Gmail address from step 3 |
| `GMAIL_APP_PASSWORD` | Gmail app password from step 3 (spaces are fine) |
| `ALLOWED_USER_IDS` | Alex's Discord user ID. Separate several with commas, no spaces. |

Then:

```sh
npx wrangler secret bulk secrets.json
rm secrets.json
```

✅ Expected: wrangler reports that 6 secrets were uploaded, and `git status` shows no `secrets.json`.

## 6. Discord: connect the buttons to the worker

1. Back on the Discord app's **General Information** page, set **Interactions Endpoint URL** to the Worker URL followed by `/discord`, for example `https://lead-responder.your-subdomain.workers.dev/discord`.
2. Press **Save Changes**.

✅ Expected: Discord saves without an error. Discord tests the URL before saving. If it says the URL couldn't be verified:
- `DISCORD_PUBLIC_KEY` is wrong or missing. Redo step 5 with the exact Public Key from this page.
- Or the URL is wrong. It must end in `/discord`, and the Worker URL must open in a browser (step 2.4).

## 7. Website: send leads to the worker

The website already sends a copy of every lead to whatever URL is in `NEXT_PUBLIC_LEADS_ENDPOINT`. Right now that's an old, unused service.

1. In GitHub, open **your-org/your-website → Settings → Secrets and variables → Actions → Variables** tab → **New repository variable**:
   - Name: `NEXT_PUBLIC_LEADS_ENDPOINT`
   - Value: the Worker URL followed by `/lead`, for example `https://lead-responder.your-subdomain.workers.dev/lead`
2. Open the pull request in your-website titled **"Send website leads to lead-responder"**. Check that it only changes `.github/workflows/deploy.yml`, then merge it. Merging deploys the website, which takes a few minutes. Watch **Actions → Deploy to CPANEL** until it's green.

## 8. Test it end to end

Use email addresses you can read, and a different address for each test: each address is only handled once. Gmail plus-addresses work well, e.g. `name+lead1@gmail.com`, `name+lead2@gmail.com`.

**Test A, auto-reply:** on <https://example.com>, enter the test email in the hero email box, then finish the details dialog choosing **Individual tutor**, with no institution.

✅ Expected within a minute:
- The test inbox gets "Thanks for your interest in Acme" from Alex's Gmail. Check spam the first time. The same email appears in that Gmail's **Sent** folder.
- Discord shows a blue card "📨 Auto-replied" with a **Write follow-up** button.

**Test B, review and send:** submit again with a new test email, choosing **School** and an institution name.

✅ Expected:
- No email yet.
- Discord shows an amber card "🟡 Needs a reply" with a draft and **Send / Edit / Skip**.
- Press **Edit**, change a word, and press Submit. The card turns green ("✅ Sent by ..."), and the test inbox gets the edited email.

**Test C, reply:** reply to either test email. ✅ The reply lands in Alex's Gmail inbox.

## 9. Tidy up

1. Once tests A–C pass, turn off Formspree's own Discord messages, so each lead shows up once: in Formspree, open the form `xdaynvvg` → **Workflow** (or **Plugins**) → Discord → disable. Formspree still keeps every submission in its dashboard as a backup.
2. Delete your test cards from Discord if you like.
3. Tell Alex it's live, in one line: "Leads now show up in Discord with Send / Edit / Skip buttons; small ones get an automatic reply."

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No card in Discord after a test | `npx wrangler tail` while submitting the form shows the worker's logs. `Discord 403` = the bot can't see or post in the channel (step 4.6). `Discord 401` = wrong bot token (step 5). |
| Card appears, but no email arrives | The card says "didn't send" with the reason. `535 Username and Password not accepted` = wrong `GMAIL_USER` or app password: make a new app password (step 3) and run `npx wrangler secret put GMAIL_APP_PASSWORD`. Also check spam. |
| Nothing reaches the worker at all | In the browser's DevTools Network tab on example.com, look for a request to `.../lead`. Missing = the website deploy didn't pick up the variable (step 7). Status 403 = the page's address isn't in `ALLOWED_ORIGINS` in `wrangler.toml`. |
| Pressing a button says "Only the Acme team can reply" | Add that person's Discord user ID to `ALLOWED_USER_IDS` and redo step 5 for that key (`npx wrangler secret put ALLOWED_USER_IDS`). |
| "This interaction failed" in Discord | The Interactions Endpoint URL is wrong, or the worker is down. Open the Worker URL in a browser. |

## Later: sending from hello@example.com instead

Not needed now. If Alex later wants emails from a example.com address:

1. Sign up at Resend, add the domain `example.com`, and add the DNS records it shows in **cPanel → Zone Editor → example.com**. Don't touch the existing `v=spf1` TXT or MX records.
2. Once the domain is **Verified**, create an API key and run `npx wrangler secret put RESEND_API_KEY`.
3. Optional: `npx wrangler secret put REPLY_TO` with the inbox that should get replies.
4. In `wrangler.toml`, set `EMAIL_PROVIDER = "resend"` and check `FROM_EMAIL`. Then `npm run deploy`.
