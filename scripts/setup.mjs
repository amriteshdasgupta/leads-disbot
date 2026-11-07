// Creates wrangler.toml from wrangler.example.toml, then the KV namespace the
// worker stores leads in, and writes its id into wrangler.toml. Run once,
// after `npx wrangler login`. wrangler.toml is gitignored, so your account's
// IDs never end up in git.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

if (!existsSync("wrangler.toml")) {
  copyFileSync("wrangler.example.toml", "wrangler.toml");
  console.log("Created wrangler.toml from wrangler.example.toml.");
}

const toml = readFileSync("wrangler.toml", "utf8");
if (!toml.includes("REPLACE_WITH_KV_ID")) {
  console.log("wrangler.toml already has a KV namespace id. Nothing to do.");
  process.exit(0);
}

const output = execFileSync("npx", ["wrangler", "kv", "namespace", "create", "LEADS"], { encoding: "utf8" });
const id = output.match(/\b[0-9a-f]{32}\b/)?.[0];
if (!id) {
  console.error(output);
  console.error("Couldn't find the namespace id above. Paste it into wrangler.toml by hand.");
  process.exit(1);
}

writeFileSync("wrangler.toml", toml.replace("REPLACE_WITH_KV_ID", id));
console.log(`KV namespace ${id} written to wrangler.toml.`);
console.log("Next: set the [vars] in wrangler.toml for your business (see the README).");
