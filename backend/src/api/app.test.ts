import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FORTION_DATA_DIR = mkdtempSync(join(tmpdir(), "fortion-api-"));
const { createApp } = await import("./app.ts");
const A = "0x000000000000000000000000000000000000dEaD";
const put = (app: ReturnType<typeof createApp>, headers: Record<string, string> = {}) =>
  app.request(`/policy/${A}`, { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ keeperCanSell: false }) });

test("Critical #4: policy writes need the operator token", async () => {
  const app = createApp({ apiToken: "s3cret", corsOrigins: ["http://localhost:3000"] });
  assert.equal((await put(app)).status, 401);
  assert.equal((await put(app, { authorization: "Bearer wrong" })).status, 401);
  const ok = await put(app, { authorization: "Bearer s3cret" });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { keeperCanSell: boolean }).keeperCanSell, false);
});

test("Critical #4: with no token configured, writes are off (secure default)", async () => {
  const app = createApp({ apiToken: undefined, corsOrigins: ["http://localhost:3000"] });
  const r = await put(app, { authorization: "Bearer anything" });
  assert.equal(r.status, 403);
  assert.match(((await r.json()) as { error: string }).error, /FORTION_API_TOKEN/);
});

test("Critical #4: CORS only for the configured frontend origin", async () => {
  const app = createApp({ apiToken: "s3cret", corsOrigins: ["http://localhost:3000"] });
  const good = await app.request("/health", { headers: { origin: "http://localhost:3000" } });
  const evil = await app.request("/health", { headers: { origin: "https://evil.example" } });
  assert.equal(good.headers.get("access-control-allow-origin"), "http://localhost:3000");
  assert.notEqual(evil.headers.get("access-control-allow-origin"), "https://evil.example");
});
