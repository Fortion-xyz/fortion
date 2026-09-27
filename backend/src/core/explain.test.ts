import { test } from "node:test";
import assert from "node:assert/strict";
import { explain } from "./explain.ts";
import { DEFAULT_POLICY, PROFILES, type Decision } from "./policy.ts";
import type { Position } from "./position.ts";

const d: Decision = { action: { kind: "hold" }, ltv: 0.31, targetLtv: 0.3, thresholds: PROFILES.balanced, status: "Careful", reason: "x" };
const pos = (o: object = {}) => ({
  policy: DEFAULT_POLICY, decision: d,
  snapshot: { collateralUsd: 100, debtUsd: 31, bufferUsd: 4.65, market: "MARKET_CLOSED", spread: 0, hoursToCorporateAction: null, minutesToWeekendClose: 180, liquidationThreshold: 0.7 },
  market: { status: "MARKET_CLOSED", nextEarnings: null },
  ...o,
}) as unknown as Position;

test("PRD Flow D narrative: LTV vs target, cushion before any sale, next risk event", () => {
  const t = explain(pos());
  assert.match(t, /LTV 31%, target 30% \(balanced profile\), status Careful/);
  // (31 − 4.65) / (0.58 × 100) → shares sold only after a 55% drop
  assert.match(t, /covers a 55% drop/);
  assert.match(t, /weekend close in 180 min/);
});

test("earnings are named, estimates flagged", () => {
  const t = explain(pos({ market: { status: "TRADING", nextEarnings: { at: new Date("2026-11-18T14:30:00Z"), confirmed: false } } }));
  assert.match(t, /Next earnings: 2026-11-18 \(estimate, not acted on yet\)/);
});
