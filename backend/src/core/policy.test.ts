import { test } from "node:test";
import assert from "node:assert/strict";
import { availableCash, decide, type Snapshot } from "./policy.ts";

const base: Snapshot = {
  collateralUsd: 100,
  debtUsd: 35,
  bufferUsd: 10,
  market: "TRADING",
  spread: 0.001,
  hoursToCorporateAction: null,
  minutesToWeekendClose: null,
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
  assert.equal(availableCash({ ...base, collateralUsd: 200, spread: 0.01 }), 0);
});

test("last resort sells to exactly 40%", () => {
  const d = at({ debtUsd: 60, bufferUsd: 0 });
  assert.equal(d.action.kind, "sell");
  if (d.action.kind !== "sell") return;
  const ltvAfter = (60 - d.action.usd) / (100 - d.action.usd);
  assert.ok(Math.abs(ltvAfter - 0.4) < 1e-9);
});

test("last resort only notifies when selling is off or token paused", () => {
  assert.equal(decide({ ...base, debtUsd: 60, bufferUsd: 0 }, { mode: "cash", keeperCanSell: false, bufferBps: 1500 }).action.kind, "notify");
  assert.equal(at({ debtUsd: 60, bufferUsd: 0, market: "ASSET_PAUSED" }).action.kind, "notify");
});

test("buffer is spent before selling", () => {
  assert.equal(at({ debtUsd: 60, bufferUsd: 5 }).action.kind, "repay");
});
