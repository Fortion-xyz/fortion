// The Wallet Skill ships a zero-dependency calldata script; it must encode exactly what our viem builders do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnits } from "viem";
import { REPAY_ALL, borrowUsdt, repayUsdt, supply, withdraw } from "../core/venus-tx.ts";
// @ts-expect-error plain .mjs without types, by design (no build step in the skill)
import { build } from "../../../skills/fortion-venus-stocks/scripts/calldata.mjs";

const same = (a: { to: string; data: string; label: string }[], b: { to: string; data: string; label: string }[]) =>
  assert.deepEqual(a.map((c) => [c.to.toLowerCase(), c.data, c.label]), b.map((c) => [c.to.toLowerCase(), c.data, c.label]));

test("supply matches the backend builders", () => same(build(["supply", "NVDAB", "0.5"]), supply("NVDAB", parseUnits("0.5", 18))));
test("borrow matches", () => same(build(["borrow", "12.5"]), [borrowUsdt(parseUnits("12.5", 18))]));
test("repay matches", () => same(build(["repay", "3.25"]), repayUsdt(parseUnits("3.25", 18))));
test("repay all approves a cap, not unlimited", () => same(build(["repay", "all", "101"]), repayUsdt(REPAY_ALL, parseUnits("101", 18))));
test("withdraw matches", () => same(build(["withdraw", "SPCXB", "0.000000000000000001"]), [withdraw("SPCXB", 1n)]));
test("bad input is refused", () => {
  assert.throws(() => build(["supply", "DOGE", "1"]), /ticker/);
  assert.throws(() => build(["borrow", "-1"]), /amount/);
  assert.throws(() => build(["borrow", "1.1234567890123456789"]), /amount/);
  assert.throws(() => build(["repay", "all"]), /cap/);
});
