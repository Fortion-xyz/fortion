// Every env var the backend reads is documented in .env.example, so an operator can't miss one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const src = new URL("..", import.meta.url).pathname;
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".ts") && !f.endsWith(".test.ts") ? [join(dir, f)] : []));

test(".env.example documents every variable the code reads", () => {
  const used = new Set<string>();
  for (const f of files(src)) {
    const code = readFileSync(f, "utf8");
    for (const m of code.matchAll(/process\.env\.([A-Z0-9_]+)/g)) used.add(m[1]!);
    // zod env schema in config.ts: `  NAME: z.…`
    if (f.endsWith("config.ts")) for (const m of code.matchAll(/^\s+([A-Z][A-Z0-9_]+):\s*z\./gm)) used.add(m[1]!);
  }
  const documented = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  const missing = [...used].filter((v) => !new RegExp(`^#?\\s*${v}=`, "m").test(documented));
  assert.deepEqual(missing, []);
});
