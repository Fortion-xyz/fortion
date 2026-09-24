import { test } from "node:test";
import assert from "node:assert/strict";
import { availableCash, decide, DEFAULT_POLICY, PROFILES, thresholds, type RiskProfile, type Snapshot } from "./policy.ts";

const base: Snapshot = {
  collateralUsd: 100,
  debtUsd: 35,
  bufferUsd: 10,
  market: "TRADING",
  spread: 0.001,
  hoursToCorporateAction: null,
  minutesToWeekendClose: null,
  liquidationThreshold: 0.7,
};
const at = (o: Partial<Snapshot>) => decide({ ...base, ...o });

test("holds at normal target", () => {
  assert.equal(at({}).action.kind, "hold");
  assert.equal(at({}).status, "Safe");
});

test("earnings within 24h repays down to 25% from buffer", () => {
  const d = at({ hoursToCorporateAction: 20 });
  assert.deepEqual(d.action, { kind: "repay", usd: 10 }); // needs 10, buffer has 10
  assert.match(d.reason, /corporate action/);
});

test("repay is capped by buffer", () => {
  const d = at({ hoursToCorporateAction: 20, bufferUsd: 4 });
  assert.deepEqual(d.action, { kind: "repay", usd: 4 });
});

test("market closed tightens to 30%", () => {
  assert.equal(at({ market: "MARKET_CLOSED" }).targetLtv, 0.3);
});

test("stock rise raises credit line", () => {
  const d = at({ collateralUsd: 120 }); // ltv 29% < 35-5
  assert.equal(d.action.kind, "borrow");
  assert.ok(d.action.kind === "borrow" && Math.abs(d.action.usd - 7) < 1e-9);
});

test("no borrow when spread > 0.5%, when closed, or when paused", () => {
  for (const o of [{ spread: 0.01 }, { market: "MARKET_CLOSED" as const }, { market: "ASSET_PAUSED" as const }])
    assert.notEqual(at({ collateralUsd: 200, ...o }).action.kind, "borrow");
  assert.equal(availableCash({ ...base, collateralUsd: 200, spread: 0.01 }, "balanced"), 0);
});

test("last resort sells to exactly 40%", () => {
  const d = at({ debtUsd: 60, bufferUsd: 0 });
  assert.equal(d.action.kind, "sell");
  if (d.action.kind !== "sell") return;
  const ltvAfter = (60 - d.action.usd) / (100 - d.action.usd);
  assert.ok(Math.abs(ltvAfter - 0.4) < 1e-9);
});

test("last resort only notifies when selling is off or token paused", () => {
  assert.equal(decide({ ...base, debtUsd: 60, bufferUsd: 0 }, { ...DEFAULT_POLICY, keeperCanSell: false }).action.kind, "notify");
  assert.equal(at({ debtUsd: 60, bufferUsd: 0, market: "ASSET_PAUSED" }).action.kind, "notify");
});

test("buffer is spent before selling", () => {
  assert.equal(at({ debtUsd: 60, bufferUsd: 5 }).action.kind, "repay");
});

const profiles = Object.keys(PROFILES) as RiskProfile[];

test("profile picks the target: conservative 25%, balanced 35%, growth 45%", () => {
  const targets = profiles.map((profile) => decide(base, { ...DEFAULT_POLICY, profile }).targetLtv);
  assert.deepEqual(targets.map((x) => Math.round(x * 100)), [25, 35, 45]);
});

test("same position: conservative repays, growth offers more cash", () => {
  assert.equal(decide(base, { ...DEFAULT_POLICY, profile: "conservative" }).action.kind, "repay");
  assert.equal(decide(base, { ...DEFAULT_POLICY, profile: "growth" }).action.kind, "borrow");
});

test("thresholds scale with LT: SPCXB (65%) is held lower than NVDAB (70%)", () => {
  const spcx = thresholds("balanced", 0.65);
  assert.ok(Math.abs(spcx.normal - 0.325) < 1e-9);
  assert.ok(spcx.lastResort < PROFILES.balanced.lastResort);
});

test("every profile stays inside Venus limits for all live markets", () => {
  // Live values 25 Sep 2026: NVDAB/TSLAB CF 60 LT 70, SPCXB CF 50 LT 65.
  for (const { cf, lt } of [{ cf: 0.6, lt: 0.7 }, { cf: 0.5, lt: 0.65 }])
    for (const p of profiles) {
      const t = thresholds(p, lt);
      assert.ok(t.normal < cf, `${p} normal target must be borrowable (< CF)`);
      assert.ok(lt - t.lastResort >= 0.08, `${p} must sell well before liquidation`);
      assert.ok(t.halt < t.overnight && t.overnight < t.normal && t.normal < t.protect && t.protect < t.lastResort);
      assert.ok(t.afterSell < t.protect, `${p} selling must land below the protect line`);
    }
});
