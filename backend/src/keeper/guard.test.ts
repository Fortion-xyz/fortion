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
  assert.equal(e?.reason, REPAY.reason);
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
