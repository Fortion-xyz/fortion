import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardOnce, type GuardDeps } from "./guard.ts";
import { openStore } from "../core/store.ts";
import { DEFAULT_POLICY, PROFILES, type Decision } from "../core/policy.ts";
import type { Position } from "../core/position.ts";
import type { Signer } from "../core/wallet.ts";

const A = "0x00000000000000000000000000000000000000AA" as const;
const T0 = new Date("2026-09-30T19:00:00Z");
const decision = (o: Partial<Decision>): Decision => ({ action: { kind: "hold" }, ltv: 0.3, targetLtv: 0.35, thresholds: PROFILES.balanced, status: "Safe", reason: "All good.", ...o });
const position = (d: Decision) => ({
  account: A, ticker: "NVDAB", policy: DEFAULT_POLICY, decision: d, collateralFactor: 0.6, availableCash: 0,
  snapshot: { collateralUsd: 100, debtUsd: 40, bufferUsd: 10, market: "TRADING", spread: 0, hoursToCorporateAction: null, minutesToWeekendClose: null, liquidationThreshold: 0.7 },
  market: { onchainUsd: 200 },
}) as unknown as Position;
const REPAY = decision({ action: { kind: "repay", usd: 5 }, status: "Protecting", reason: "Repaid 5.00 USDT from the safety buffer because earnings are near." });

function deps(d: Decision, o: Partial<GuardDeps> = {}): GuardDeps & { clock: { now: Date } } {
  const clock = { now: T0 };
  return {
    clock,
    position: async () => position(d),
    store: openStore(mkdtempSync(join(tmpdir(), "fortion-guard-"))),
    signerFor: async () => null,
    simulate: async () => ({ ok: true, steps: [] }),
    balances: async () => ({ stock: 0n, usdt: 0n }),
    balanceOf: () => async () => 0n,
    now: () => clock.now,
    ...o,
  };
}

test("hold records nothing", async () => {
  const g = deps(decision({}));
  assert.equal(await guardOnce(A, "NVDAB", g), null);
  assert.equal(g.store.events(A).length, 0);
});

test("an action is recorded as one sentence; dry run when no signer", async () => {
  const g = deps(REPAY);
  const e = await guardOnce(A, "NVDAB", g);
  assert.equal(e?.outcome, "dry-run");
  assert.equal(e?.simulated, true);
  assert.match(e!.reason, /^Simulated only \(signing is off\): would repay 5\.00 USDT/, "never claims a repay that was only simulated");
  assert.equal(g.store.events(A).length, 1);
});

test("cooldown: the same stock isn't acted on again for 10 minutes", async () => {
  const g = deps(REPAY);
  await guardOnce(A, "NVDAB", g);
  g.clock.now = new Date(+T0 + 9 * 60_000);
  assert.equal(await guardOnce(A, "NVDAB", g), null);
  g.clock.now = new Date(+T0 + 11 * 60_000);
  assert.ok(await guardOnce(A, "NVDAB", g));
  assert.equal(g.store.events(A).length, 2);
});

test("while an action waits for the user in the Binance App, nothing else is stacked on it", async () => {
  const pendingSigner = { kind: "baw", from: A, send: async () => ({ status: "pending", note: "Waiting for you to confirm in the Binance App (order o1)." }), swap: async () => ({ status: "failed", error: "x" }) } as unknown as Signer;
  const g = deps(REPAY, { signerFor: async () => pendingSigner });
  const e = await guardOnce(A, "NVDAB", g);
  assert.equal(e?.outcome, "pending");
  g.clock.now = new Date(+T0 + 30 * 60_000); // well past the cooldown
  assert.equal(await guardOnce(A, "NVDAB", g), null, "still pending: wait for the user");
  g.clock.now = new Date(+T0 + 61 * 60_000); // pending orders expire; re-plan from chain state
  assert.ok(await guardOnce(A, "NVDAB", g));
});

test("the same heads-up isn't repeated for an hour", async () => {
  const notify = decision({ action: { kind: "notify" }, status: "Protecting", reason: "Your loan needs attention: add USDT or repay now." });
  const g = deps(notify);
  assert.ok(await guardOnce(A, "NVDAB", g));
  g.clock.now = new Date(+T0 + 30 * 60_000);
  assert.equal(await guardOnce(A, "NVDAB", g), null);
  g.clock.now = new Date(+T0 + 61 * 60_000);
  assert.ok(await guardOnce(A, "NVDAB", g));
});

test("a plan that can't run is recorded as blocked with the reason", async () => {
  const sell = decision({ action: { kind: "sell", usd: 30 }, status: "Protecting", reason: "Sold stock to keep your loan safe." });
  const g = deps(sell, { position: async () => ({ ...position(sell), snapshot: { ...position(sell).snapshot, debtUsd: 60 } }) as Position });
  const e = await guardOnce(A, "NVDAB", g);
  assert.equal(e?.outcome, "blocked");
  assert.match(e!.error!, /withdrawn safely/);
});

test("Critical #2: an exception during execution is still recorded, so the cooldown applies", async () => {
  const exploding = { kind: "baw", from: A, send: async () => { throw new Error("network down"); }, swap: async () => ({ status: "failed", error: "x" }) } as unknown as Signer;
  const g = deps(REPAY, { signerFor: async () => exploding });
  const e = await guardOnce(A, "NVDAB", g);
  assert.equal(e?.outcome, "failed");
  assert.match(e!.error!, /network down/);
  assert.equal(g.store.events(A).length, 1);
  assert.equal(await guardOnce(A, "NVDAB", g), null, "cooldown holds after a failure");
});

test("a market-data outage is recorded once as a data gap, not silently skipped", async () => {
  const g = deps(REPAY, { position: async () => { throw new Error("Binance /rwa/price → 429"); } });
  const e = await guardOnce(A, "NVDAB", g);
  assert.equal(e?.outcome, "blocked");
  assert.match(e!.reason, /couldn't read/i);
  g.clock.now = new Date(+T0 + 5 * 60_000);
  assert.equal(await guardOnce(A, "NVDAB", g), null, "not repeated every tick");
});

test("Important #7: a pending order locks the whole account (debt is account-wide), not just one stock", async () => {
  const pendingSigner = { kind: "baw", from: A, send: async () => ({ status: "pending", note: "Waiting for you to confirm in the Binance App." }), swap: async () => ({ status: "failed", error: "x" }) } as unknown as Signer;
  const g = deps(REPAY, { signerFor: async () => pendingSigner });
  assert.equal((await guardOnce(A, "NVDAB", g))?.outcome, "pending");
  g.clock.now = new Date(+T0 + 20 * 60_000);
  assert.equal(await guardOnce(A, "TSLAB", g), null, "no repay stacked from another stock's pass");
});

test("Important #7: warnings still get through while an order is pending", async () => {
  const pendingSigner = { kind: "baw", from: A, send: async () => ({ status: "pending", note: "Waiting." }), swap: async () => ({ status: "failed", error: "x" }) } as unknown as Signer;
  const g = deps(REPAY, { signerFor: async () => pendingSigner });
  await guardOnce(A, "NVDAB", g);
  const notify = decision({ action: { kind: "notify" }, status: "Protecting", reason: "Your loan needs attention: add USDT or repay now." });
  g.position = async () => position(notify);
  g.clock.now = new Date(+T0 + 5 * 60_000);
  assert.equal((await guardOnce(A, "NVDAB", g))?.kind, "notify");
});

test("cooldown is per account and ignores heads-ups in between", async () => {
  const g = deps(REPAY);
  await guardOnce(A, "NVDAB", g);
  g.store.addEvent({ at: new Date(+T0 + 60_000).toISOString(), account: A, ticker: "NVDAB", kind: "notify", usd: null, status: "Careful", reason: "heads-up", outcome: "done", txHashes: [], simulated: false });
  g.clock.now = new Date(+T0 + 5 * 60_000);
  assert.equal(await guardOnce(A, "TSLAB", g), null, "another stock can't act within the account cooldown");
});

test("Important #9: the sentence matches what actually happened", async () => {
  const why = decision({ ...REPAY, cause: "earnings are near" });
  const dry = await guardOnce(A, "NVDAB", deps(why));
  assert.match(dry!.reason, /^Simulated only \(signing is off\): would repay 5\.00 USDT from your safety buffer because earnings are near\.$/);

  const pendingSigner = { kind: "baw", from: A, send: async () => ({ status: "pending", note: "Waiting for you to confirm in the Binance App (order o1)." }), swap: async () => ({ status: "failed", error: "x" }) } as unknown as Signer;
  const pend = await guardOnce(A, "NVDAB", deps(why, { signerFor: async () => pendingSigner }));
  assert.match(pend!.reason, /^Waiting for you in the Binance App to repay 5\.00 USDT/);

  const failing = { kind: "baw", from: A, send: async () => ({ status: "failed", error: "slippage" }), swap: async () => ({ status: "failed", error: "x" }) } as unknown as Signer;
  const fail = await guardOnce(A, "NVDAB", deps(why, { signerFor: async () => failing }));
  assert.match(fail!.reason, /^Tried to repay 5\.00 USDT .* but it didn't go through/);
  assert.doesNotMatch(fail!.reason, /^Repaid/);
});

test("Important #9: a sell reports the chunk actually sold, and a blocked sell says it couldn't", async () => {
  const sell = decision({ action: { kind: "sell", usd: 30 }, status: "Protecting", reason: "Sold 30.00 USDT of stock…", cause: "the safety buffer is empty" });
  const blocked = await guardOnce(A, "NVDAB", deps(sell, { position: async () => ({ ...position(sell), snapshot: { ...position(sell).snapshot, debtUsd: 60 } }) as Position }));
  assert.match(blocked!.reason, /^Couldn't sell stock/);
  // collateral 100, debt 58, CF 60% → chunk = 0.9 × (100 − 58/0.6) = 3.00
  const g = deps(sell, { position: async () => ({ ...position(sell), snapshot: { ...position(sell).snapshot, debtUsd: 58 } }) as Position });
  const dry = await guardOnce(A, "NVDAB", g);
  assert.match(dry!.reason, /would sell 3\.00 USDT of stock/);
  assert.equal(dry!.usd, 3);
});
