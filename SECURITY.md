# Security policy

## Reporting a vulnerability

Please **don't** open a public issue for security problems.

Report them privately through GitHub instead: on the repository, open **Security → Report a vulnerability**, or go straight to <https://github.com/amriteshdasgupta/leads-disbot/security/advisories/new>.

Include what you found, how to reproduce it, and what an attacker could do with it. We aim to reply within a week. Once a fix is out, we'll publish an advisory and credit you, unless you'd rather stay anonymous.

## Supported versions

Fixes go into the latest version on the `main` branch. Self-hosted deployments should update by pulling and redeploying (see [docs/deployment.md](docs/deployment.md#updating)).

## In scope

- Bypassing the Discord request signature check or `ALLOWED_USER_IDS`
- Making the worker send email it shouldn't (beyond `AUTO_SEND_DAILY_LIMIT`, twice to one address, or with injected headers)
- Submitting leads from origins outside `ALLOWED_ORIGINS`
- Reading or changing other people's leads
- Leaking secrets through responses, cards or logs

## Keeping your deployment safe

- Keep `secrets.json` out of git (it's gitignored) and delete it after uploading the secrets.
- Keep the leads channel private to your team, or set `ALLOWED_USER_IDS`.
- Turn **Public Bot** off for your Discord application so nobody else can add it to their server.
- If a token or password leaks, reset it (Discord bot token, Gmail app password, Resend key) and upload the new one with `npx wrangler secret put`.
