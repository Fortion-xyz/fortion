import { test } from "node:test";
import assert from "node:assert/strict";
import { plan } from "./plan.ts";
import { DEFAULT_POLICY, PROFILES, type Action, type Decision } from "./policy.ts";

const d = (action: Action): Decision =>
  ({ action, ltv: 0.3, targetLtv: 0.35, thresholds: PROFILES.balanced, status: "Safe", reason: "" });

test("repay → approve + repayBorrow for the exact amount", () => {
  const p = plan(d({ kind: "repay", usd: 12.5 }), DEFAULT_POLICY);
  assert.ok("calls" in p);
  assert.deepEqual(p.calls.map((c) => c.label), ["approve USDT", "repay USDT"]);
});

test("borrow in cash mode → one borrow call", () => {
  const p = plan(d({ kind: "borrow", usd: 7 }), DEFAULT_POLICY);
  assert.ok("calls" in p && p.calls.length === 1 && p.calls[0]!.label === "borrow USDT");
});

test("swaps are blocked until the Trading API is wired", () => {
  assert.ok("blocked" in plan(d({ kind: "sell", usd: 5 }), DEFAULT_POLICY));
  assert.ok("blocked" in plan(d({ kind: "borrow", usd: 5 }), { ...DEFAULT_POLICY, mode: "accumulate" }));
});

test("hold and notify sign nothing", () => {
  for (const kind of ["hold", "notify"] as const) assert.deepEqual(plan(d({ kind }), DEFAULT_POLICY), { calls: [] });
});
