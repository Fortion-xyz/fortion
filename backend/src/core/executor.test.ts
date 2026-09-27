import { test } from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import { execute, type Step } from "./executor.ts";
import { bawSigner, type Run } from "./wallet.ts";
import { borrowUsdt, repayUsdt } from "./venus-tx.ts";
import type { Simulation } from "./simulate.ts";

const FROM = "0x00000000000000000000000000000000000000AA" as const;
const ok = (data: unknown) => JSON.stringify({ success: true, data });
const preview = (requestId: string, extra: object = {}) =>
  ok({ requestId, simulationResult: { simulationCode: "000000000", simulationErrorDetail: null }, risks: { riskDetails: [] }, requireConfirmation: false, ...extra });
const broadcast = (txHash: string) => ok({ orderId: "o", status: "BROADCASTED", txHash });

/** Fake `baw`: answers queued per command ("contract-call preview", "market-order list", …) and records calls. */
function fakeBaw(answers: Record<string, string[]>) {
  const calls: string[][] = [];
  const run: Run = async (args) => {
    calls.push(args);
    const next = answers[`${args[0]} ${args[1]}`]?.shift();
    if (!next) throw new Error(`unexpected baw ${args.join(" ")}`);
    return next;
  };
  return { run, calls, cmds: () => calls.map((c) => `${c[0]} ${c[1]}`) };
}
const simOk = async (): Promise<Simulation> => ({ ok: true, steps: [] });
const receipt = (status: "success" | "reverted") => async (_: Hex) => ({ status });
const steps = (...s: Step[]) => s;
const repay = repayUsdt(10n).map((call) => ({ kind: "call" as const, call }));

test("happy path: each call is previewed, executed and mined before the next", async () => {
  const baw = fakeBaw({ "contract-call preview": [preview("r1"), preview("r2")], "contract-call execute": [broadcast("0x1"), broadcast("0x2")] });
  const r = await execute(FROM, repay, { signer: bawSigner(FROM, { run: baw.run, waitReceipt: receipt("success") }), simulate: simOk });
  assert.deepEqual(r, { outcome: "done", txHashes: ["0x1", "0x2"], stepsDone: 2 });
  assert.deepEqual(baw.cmds(), ["contract-call preview", "contract-call execute", "contract-call preview", "contract-call execute"]);
  assert.ok(baw.calls[0]!.includes(repay[0]!.call.data), "sends our calldata");
});

test("preview blocked by Binance risk engine: stop, nothing executed", async () => {
  const blocked = JSON.stringify({ success: false, error: { code: 351803, name: "AGENT_DEV_MODE_RISK_BLOCKED", message: "High risk transaction" } });
  const baw = fakeBaw({ "contract-call preview": [blocked] });
  const r = await execute(FROM, repay, { signer: bawSigner(FROM, { run: baw.run, waitReceipt: receipt("success") }), simulate: simOk });
  assert.equal(r.outcome, "failed");
  assert.match(r.error!, /High risk transaction/);
  assert.deepEqual(baw.cmds(), ["contract-call preview"]);
});

test("a RISK item in the preview is never executed", async () => {
  const risky = preview("r1", { risks: { riskDetails: [{ code: "RISK_001", title: "High Risk Address", description: "flagged", riskType: "RISK" }] } });
  const baw = fakeBaw({ "contract-call preview": [risky] });
  const r = await execute(FROM, repay, { signer: bawSigner(FROM, { run: baw.run, waitReceipt: receipt("success") }), simulate: simOk });
  assert.equal(r.outcome, "failed");
  assert.match(r.error!, /High Risk Address/);
  assert.ok(!baw.cmds().includes("contract-call execute"));
});

test("App confirmation required: pending, and the plan stops there", async () => {
  const baw = fakeBaw({ "contract-call preview": [preview("r1", { requireConfirmation: true })], "contract-call execute": [ok({ orderId: "o9", status: "PENDING_CONFIRMATION", txHash: null })] });
  const r = await execute(FROM, repay, { signer: bawSigner(FROM, { run: baw.run, waitReceipt: receipt("success") }), simulate: simOk });
  assert.deepEqual(r, { outcome: "pending", txHashes: [], stepsDone: 0, error: "Waiting for you to confirm in the Binance App (order o9)." });
});

test("mined but reverted: failed with the hash kept", async () => {
  const baw = fakeBaw({ "contract-call preview": [preview("r1")], "contract-call execute": [broadcast("0xdead")] });
  const r = await execute(FROM, repay, { signer: bawSigner(FROM, { run: baw.run, waitReceipt: receipt("reverted") }), simulate: simOk });
  assert.equal(r.outcome, "failed");
  assert.deepEqual(r.txHashes, ["0xdead"]);
});

test("our own simulation catches Venus error codes before Binance is asked", async () => {
  const baw = fakeBaw({});
  const simBad = async (): Promise<Simulation> => ({ ok: false, steps: [{ label: "borrow USDT", error: "borrow USDT: Venus error code 3" }] });
  const r = await execute(FROM, steps({ kind: "call", call: borrowUsdt(1n) }), { signer: bawSigner(FROM, { run: baw.run, waitReceipt: receipt("success") }), simulate: simBad });
  assert.equal(r.outcome, "failed");
  assert.match(r.error!, /Venus error code 3/);
  assert.equal(baw.calls.length, 0);
});

test("swap: submitted, polled until FINISHED, then the next segment is simulated fresh", async () => {
  const listed = (status: string, txHash: string | null) => ok({ list: [{ orderId: "s1", status, txHash }] });
  const baw = fakeBaw({
    "market-order swap": [ok({ orderId: "s1" })],
    "market-order list": [listed("PENDING", null), listed("FINISHED", "0xswap")],
    "contract-call preview": [preview("r1"), preview("r2")],
    "contract-call execute": [broadcast("0x1"), broadcast("0x2")],
  });
  let sims = 0;
  const countSim = async (): Promise<Simulation> => (sims++, { ok: true, steps: [] });
  const swap: Step = { kind: "swap", swap: { fromToken: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436", toToken: "0x55d398326f99059fF775485246999027B3197955", qty: "0.1", label: "sell NVDAB" } };
  const r = await execute(FROM, [swap, ...repay], { signer: bawSigner(FROM, { run: baw.run, waitReceipt: receipt("success"), pollMs: 0 }), simulate: countSim });
  assert.deepEqual(r, { outcome: "done", txHashes: ["0xswap", "0x1", "0x2"], stepsDone: 3 });
  assert.equal(sims, 1, "the repay segment is simulated after the swap landed");
});

test("swap FAILED stops the plan", async () => {
  const baw = fakeBaw({ "market-order swap": [ok({ orderId: "s1" })], "market-order list": [ok({ list: [{ orderId: "s1", status: "FAILED", txHash: null }] })] });
  const swap: Step = { kind: "swap", swap: { fromToken: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436", toToken: "0x55d398326f99059fF775485246999027B3197955", qty: "0.1", label: "sell NVDAB" } };
  const r = await execute(FROM, [swap, ...repay], { signer: bawSigner(FROM, { run: baw.run, waitReceipt: receipt("success"), pollMs: 0 }), simulate: simOk });
  assert.equal(r.outcome, "failed");
  assert.equal(r.stepsDone, 0);
});

test("dry run (no signer): simulate only", async () => {
  const r = await execute(FROM, repay, { signer: null, simulate: simOk });
  assert.deepEqual(r, { outcome: "dry-run", txHashes: [], stepsDone: 0 });
});

test("dry run doesn't fail a plan whose later calls depend on a swap it can't perform", async () => {
  const noUsdtYet = async (): Promise<Simulation> => ({ ok: false, steps: [{ label: "repay USDT", error: "repay USDT: reverted" }] });
  const swap: Step = { kind: "swap", swap: { fromToken: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436", toToken: "0x55d398326f99059fF775485246999027B3197955", qty: "0.1", label: "sell NVDAB" } };
  const r = await execute(FROM, [swap, ...repay], { signer: null, simulate: noUsdtYet });
  assert.equal(r.outcome, "dry-run");
});

test("wallet status: connected, documented UNCONNECTED, and the real not-signed-in reply", async () => {
  const { walletStatus } = await import("./wallet.ts");
  const reply = (s: string): Run => async () => s;
  assert.deepEqual(await walletStatus(reply(ok({ status: "CONNECTED" }))), { connected: true });
  assert.equal((await walletStatus(reply(ok({ status: "UNCONNECTED" })))).connected, false);
  // Observed 27 Sep with baw 1.10.0 on a machine that never signed in:
  const real = JSON.stringify({ success: false, error: { code: 2, name: "SERVICE_ERROR", message: "illegal parameter" } });
  const r = await walletStatus(reply(real));
  assert.equal(r.connected, false);
  assert.match(r.detail!, /baw auth signin/);
});
