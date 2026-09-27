import { test } from "node:test";
import assert from "node:assert/strict";
import { fortionRunWork, parseRequest } from "../src/fortion.ts";

const A = "0x000000000000000000000000000000000000dEaD";

test("finds the wallet and the stock in free text", () => {
  assert.deepEqual(parseRequest(`How safe is my Nvidia loan this weekend? wallet ${A}`), { address: A, ticker: "NVDAB" });
  assert.deepEqual(parseRequest(`risk for ${A} tslab`), { address: A, ticker: "TSLAB" });
  assert.deepEqual(parseRequest(`${A} SpaceX`), { address: A, ticker: "SPCXB" });
  assert.deepEqual(parseRequest(`${A}`), { address: A, ticker: "NVDAB" }, "NVDAB by default");
  assert.equal(parseRequest("how safe is my loan?"), null);
});

test("runWork returns the Fortion risk report for the wallet", async () => {
  const seen: string[] = [];
  const fetch = (async (url: string) => (seen.push(url), new Response("LTV 31%, target 30% (balanced profile), status Careful."))) as typeof globalThis.fetch;
  const out = await fortionRunWork({ apiUrl: "http://api", fetch })(`weekend risk ${A} nvidia`, { sessionId: "s" });
  assert.deepEqual(seen, [`http://api/explain/${A}?ticker=NVDAB`]);
  assert.match(out, /Fortion risk report · NVDAB · 0x0000…dEaD/);
  assert.match(out, /status Careful/);
});

test("without a wallet it explains how to ask; API errors are surfaced, not hidden", async () => {
  const fail = (async () => new Response(JSON.stringify({ error: "Invalid address" }), { status: 400 })) as typeof globalThis.fetch;
  const run = fortionRunWork({ apiUrl: "http://api", fetch: fail });
  assert.match(await run("hello", { sessionId: "s" }), /Send a BNB Smart Chain wallet address/);
  assert.match(await run(A, { sessionId: "s" }), /couldn't read that position: Invalid address/);
});
