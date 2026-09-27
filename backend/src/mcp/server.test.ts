import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type McpDeps } from "./server.ts";

const A = "0x000000000000000000000000000000000000dEaD";
const preview = { ticker: "NVDAB", maxCash: 20, cash: 10, borrow: 11.76, safetyBuffer: 1.76, steps: ["borrow USDT"], calls: [], simulation: { ok: true, steps: [] } };

async function connect(o: Partial<McpDeps> = {}) {
  const calls: string[] = [];
  const deps: McpDeps = {
    position: async () => { throw new Error("not used"); },
    market: async () => ({}) as never,
    setPolicy: (_a, p) => (calls.push(`setPolicy ${JSON.stringify(p)}`), { mode: "cash", profile: "balanced", keeperCanSell: true, bufferBps: 1500, ...p }),
    previewDraw: async () => preview as never,
    previewRepay: async () => ({ ...preview, repay: 5, debtAfter: 0 }) as never,
    sign: async () => (calls.push("sign"), "done: https://bscscan.com/tx/0x1"),
    ...o,
  };
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([createServer(deps).connect(a), client.connect(b)]);
  const call = async (name: string, args: object) => {
    const r = await client.callTool({ name, arguments: args });
    return { text: (r.content as { text: string }[])[0]!.text, isError: r.isError === true };
  };
  return { client, call, calls };
}

test("exposes the seven PRD F5 tools", async () => {
  const { client } = await connect();
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["available_cash", "draw_cash", "explain_risk", "get_position", "market_window", "repay", "set_policy"]);
});

test("set_policy validates and stores", async () => {
  const { call, calls } = await connect();
  const r = await call("set_policy", { address: A, profile: "conservative", mode: "accumulate" });
  assert.match(r.text, /conservative/);
  assert.deepEqual(calls, ['setPolicy {"profile":"conservative","mode":"accumulate"}']);
  assert.equal((await call("set_policy", { address: A, profile: "yolo" })).isError, true);
});

test("draw_cash and repay only preview unless confirm is true", async () => {
  const { call, calls } = await connect();
  const p = await call("draw_cash", { address: A, usdt: 10 });
  assert.match(p.text, /Preview only/);
  assert.match(p.text, /10\.00 USDT/);
  assert.deepEqual(calls, []);
  const s = await call("repay", { address: A, usdt: 5, confirm: true });
  assert.match(s.text, /done/);
  assert.deepEqual(calls, ["sign"]);
});

test("a failed simulation is never signed, even with confirm", async () => {
  const bad = { ...preview, simulation: { ok: false, steps: [{ label: "borrow USDT", error: "borrow USDT: Venus error code 3" }] } };
  const { call, calls } = await connect({ previewDraw: async () => bad as never });
  const r = await call("draw_cash", { address: A, usdt: 10, confirm: true });
  assert.match(r.text, /Venus error code 3/);
  assert.deepEqual(calls, []);
});

test("draw_cash with nothing available says so instead of previewing 0", async () => {
  const { call } = await connect({ previewDraw: async () => ({ ...preview, maxCash: 0, cash: 0, borrow: 0, safetyBuffer: 0 }) as never });
  assert.match((await call("draw_cash", { address: A })).text, /Nothing to draw right now/);
});
