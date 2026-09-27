import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, parseEther } from "viem";
import { plan, type PlanContext } from "./plan.ts";
import { DEFAULT_POLICY, PROFILES, type Action, type Decision } from "./policy.ts";
import { BSTOCKS, USDT } from "./config.ts";
import { abi } from "./venus-tx.ts";

const d = (action: Action): Decision => ({ action, ltv: 0.3, targetLtv: 0.35, thresholds: PROFILES.balanced, status: "Safe", reason: "" });
const ctx = (o: Partial<PlanContext> = {}): PlanContext => ({
  ticker: "NVDAB", priceUsd: 200, collateralUsd: 100, debtUsd: 58, collateralFactor: 0.6,
  startBalance: { stock: 0n, usdt: 0n }, balanceOf: async () => 0n, ...o,
});
const labels = (p: ReturnType<typeof plan>) => ("steps" in p ? p.steps.map((s) => (s.kind === "call" ? s.call.label : s.kind === "swap" ? s.swap.label : s.label)) : p.blocked);

test("repay → approve + repayBorrow", () => {
  assert.deepEqual(labels(plan(d({ kind: "repay", usd: 12.5 }), DEFAULT_POLICY, ctx())), ["approve USDT", "repay USDT"]);
});

test("cash-mode raise → one borrow", () => {
  assert.deepEqual(labels(plan(d({ kind: "borrow", usd: 7 }), DEFAULT_POLICY, ctx())), ["borrow USDT"]);
});

test("accumulate raise → borrow, buy the same stock, supply what was bought", async () => {
  const p = plan(d({ kind: "borrow", usd: 7 }), { ...DEFAULT_POLICY, mode: "accumulate" }, ctx({
    startBalance: { stock: parseEther("1"), usdt: 0n },
    balanceOf: async (t) => (t === BSTOCKS.NVDAB ? parseEther("1.035") : 0n),
  }));
  assert.deepEqual(labels(p), ["borrow USDT", "buy NVDAB", "supply the NVDAB just bought"]);
  assert.ok("steps" in p);
  const swap = p.steps[1]!;
  assert.ok(swap.kind === "swap" && swap.swap.fromToken === USDT && swap.swap.toToken === BSTOCKS.NVDAB && swap.swap.qty === "5.95");
  const lazy = p.steps[2]!;
  assert.ok(lazy.kind === "lazy");
  const calls = await lazy.build();
  assert.deepEqual(decodeFunctionData({ abi: abi.vToken, data: calls[1]!.data }).args, [parseEther("0.035")], "only the bought amount");
});

test("last-resort sell withdraws only what Venus allows, sells it, repays the proceeds", async () => {
  // collateral 100, debt 58, CF 60% → at most 100 − 58/0.6 = 3.33 can leave; take 90% of that.
  const p = plan(d({ kind: "sell", usd: 30 }), DEFAULT_POLICY, ctx({ balanceOf: async (t) => (t === USDT ? parseEther("2.97") : 0n) }));
  assert.deepEqual(labels(p), ["withdraw NVDAB", "sell NVDAB", "repay with the sale proceeds"]);
  assert.ok("steps" in p);
  const w = p.steps[0]!;
  assert.ok(w.kind === "call");
  const [qty] = decodeFunctionData({ abi: abi.vToken, data: w.call.data }).args as [bigint];
  assert.ok(Math.abs(Number(qty) / 1e18 - (0.9 * (100 - 58 / 0.6)) / 200) < 1e-9);
  const repay = await (p.steps[2] as { build: () => Promise<{ data: `0x${string}` }[]> }).build();
  assert.deepEqual(decodeFunctionData({ abi: abi.vToken, data: repay[1]!.data }).args, [parseEther("2.97")]);
});

test("no safe room to withdraw → blocked with a reason", () => {
  const p = plan(d({ kind: "sell", usd: 30 }), DEFAULT_POLICY, ctx({ debtUsd: 60 }));
  assert.ok("blocked" in p && /withdraw/.test(p.blocked));
});

test("hold and notify sign nothing", () => {
  for (const kind of ["hold", "notify"] as const) assert.deepEqual(plan(d({ kind }), DEFAULT_POLICY, ctx()), { steps: [] });
});

test("Important #8: accumulate keeps the 15% safety buffer and never swaps more than was borrowed", () => {
  const qty = (usd: number) => {
    const p = plan(d({ kind: "borrow", usd }), { ...DEFAULT_POLICY, mode: "accumulate" }, ctx());
    assert.ok("steps" in p);
    const s = p.steps[1]!;
    return s.kind === "swap" ? s.swap.qty : "";
  };
  assert.equal(qty(7), "5.95"); // 85% of 7
  assert.equal(qty(7.009), "5.95"); // rounded down, not up
  assert.ok(Number(qty(0.0199)) <= 0.0199 * 0.85);
});
