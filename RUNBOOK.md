# Setup runbook

Step-by-step setup for whoever deploys this (written for Astra). It takes about 45 minutes. Do the steps in order: some depend on values from earlier ones.

Alex doesn't want to be involved, so only ask them when a step says **Ask Alex**.

## Rules

- **Never commit a secret.** Tokens and keys go only into `secrets.json`, which git ignores, and are deleted after step 5.
- **Never paste a secret into Discord, GitHub issues or chat.**
- Write down these values as you go. You'll need them later:

| Value | From step | Secret? |
| --- | --- | --- |
| Worker URL (`https://lead-responder.<something>.workers.dev`) | 2 | No |
| Resend API key (`re_...`) | 3 | **Yes** |
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

✅ Expected: `Tests  19 passed`.

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

## 3. Resend: let the worker send email from example.com

1. Sign up at <https://resend.com/signup> (free plan, 3,000 emails a month).
2. Go to **Domains → Add Domain**, enter `example.com`, and press Add.
3. Resend shows 3 or 4 DNS records (types `MX` and `TXT`, on names like `send` and `resend._domainkey`). Add each one in the DNS for example.com:
   - The DNS is managed in **cPanel** for example.com (nameservers `ns1–ns4.example-dns.com`). Sign in to cPanel (**Ask Alex** for the login if you don't have it), open **Zone Editor**, and press **Manage** next to `example.com`.
   - Add each record exactly as Resend shows it. Copy the name, type, value and priority; don't retype them.
   - **Don't change or delete the existing records**, especially the existing `TXT` record that starts with `v=spf1` and the existing `MX` record. Resend's records go on the `send` subdomain and don't touch them.
4. Back in Resend, press **Verify DNS Records**. It can take a few minutes up to an hour.

   ✅ Expected: the domain shows **Verified**. Don't do step 7 until it does: until then Resend can only email the Resend account's own address.
5. Go to **API Keys → Create API Key**. Name it `lead-responder`, permission **Sending access**, domain `example.com`. Copy the key (`re_...`). That's the **Resend API key**, and it's only shown once.

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
| `RESEND_API_KEY` | Resend API key |
| `REPLY_TO` | The inbox where leads' replies should go: Alex's personal Gmail. **Ask Alex** if you're not sure which address. |
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
- The test inbox gets "Thanks for your interest in Acme" from `hello@example.com`. Check spam the first time.
- Discord shows a blue card "📨 Auto-replied" with a **Write follow-up** button.

**Test B, review and send:** submit again with a new test email, choosing **School** and an institution name.

✅ Expected:
- No email yet.
- Discord shows an amber card "🟡 Needs a reply" with a draft and **Send / Edit / Skip**.
- Press **Edit**, change a word, and press Submit. The card turns green ("✅ Sent by ..."), and the test inbox gets the edited email.

**Test C, reply:** reply to either test email. ✅ The reply lands in the `REPLY_TO` inbox.

## 9. Tidy up

1. Once tests A–C pass, turn off Formspree's own Discord messages, so each lead shows up once: in Formspree, open the form `xdaynvvg` → **Workflow** (or **Plugins**) → Discord → disable. Formspree still keeps every submission in its dashboard as a backup.
2. Delete your test cards from Discord if you like.
3. Tell Alex it's live, in one line: "Leads now show up in Discord with Send / Edit / Skip buttons; small ones get an automatic reply."

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No card in Discord after a test | `npx wrangler tail` while submitting the form shows the worker's logs. `Discord 403` = the bot can't see or post in the channel (step 4.6). `Discord 401` = wrong bot token (step 5). |
| Card appears, but no email arrives | The card says "didn't send" with the reason. `Resend 403` = domain not verified yet (step 3.4) or the wrong API key. Also check spam. |
| Nothing reaches the worker at all | In the browser's DevTools Network tab on example.com, look for a request to `.../lead`. Missing = the website deploy didn't pick up the variable (step 7). Status 403 = the page's address isn't in `ALLOWED_ORIGINS` in `wrangler.toml`. |
| Pressing a button says "Only the Acme team can reply" | Add that person's Discord user ID to `ALLOWED_USER_IDS` and redo step 5 for that key (`npx wrangler secret put ALLOWED_USER_IDS`). |
| "This interaction failed" in Discord | The Interactions Endpoint URL is wrong, or the worker is down. Open the Worker URL in a browser. |
