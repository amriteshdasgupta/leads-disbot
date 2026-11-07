# Contributing to leads-disbot

Thanks for helping. Bug reports, fixes, docs and small features are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach. It saves you rewriting a pull request.
- Security problems go through a private report, not an issue. See [SECURITY.md](SECURITY.md).
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setting up

You need Node.js 22 or newer.

```sh
git clone https://github.com/amriteshdasgupta/leads-disbot.git
cd leads-disbot
npm ci
npm test
npm run typecheck
```

The tests mock Discord, Gmail and Resend, so they need no accounts or network. To try the worker for real, follow [docs/deployment.md](docs/deployment.md) with your own Cloudflare account and a test Discord server.

## Making a change

- Keep it small and readable. The project is deliberately a handful of short files; prefer plain code over new abstractions or dependencies.
- Match the surrounding style: two-space indents, double quotes, and short comments that explain *why*, not what.
- Keep it generic. Nothing specific to one business belongs in the code, defaults or docs. Anything that differs between deployments is a var in `wrangler.example.toml`, validated in `src/config.ts`.
- When you add or change a var, update `wrangler.example.toml`, `src/config.ts`, the configuration table in the README, and a test in `test/config.test.ts`.
- Don't break existing deployments without saying so. Pinned Discord templates, the `/lead` payload fields and KV data written by older versions should keep working.
- Add or update tests for behaviour you change. `npm test` and `npm run typecheck` must pass; CI runs both.
- Never commit secrets, real account IDs or real people's data. Use `example.com` addresses in tests and docs.

## Pull requests

- One change per pull request, with a clear title in the imperative ("Add a Slack fallback", not "Added…").
- Describe what changed and why, and how you tested it. The pull request template has a short checklist.
- By contributing, you agree that your contribution is licensed under the project's [MIT License](LICENSE).
