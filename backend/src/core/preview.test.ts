import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteDraw } from "./preview.ts";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("slider shows spendable cash; 15% of what's borrowed stays as the safety buffer", () => {
  // Dina, 1 NVDAB ≈ $225 on Balanced (35%): up to $78.75 can be borrowed.
  const q = quoteDraw(78.75, 1500);
  assert.ok(close(q.maxCash, 78.75 * 0.85));
  assert.ok(close(q.cash, q.maxCash), "defaults to the maximum");
  assert.ok(close(q.borrow, 78.75));
});

test("picking $50 borrows $58.82 and keeps $8.82 in the wallet", () => {
  const q = quoteDraw(78.75, 1500, 50);
  assert.ok(close(q.borrow, 50 / 0.85));
  assert.ok(close(q.safetyBuffer, 50 / 0.85 - 50));
  assert.ok(close(q.cash + q.safetyBuffer, q.borrow));
});

test("asking for more than today's limit is refused in plain words", () => {
  assert.throws(() => quoteDraw(78.75, 1500, 70), /up to 66\.94 USDT/);
  assert.throws(() => quoteDraw(78.75, 1500, -1), /more than zero/);
});

test("nothing available (paused, or no stock pledged)", () => {
  assert.deepEqual(quoteDraw(0, 1500), { maxCash: 0, cash: 0, borrow: 0, safetyBuffer: 0 });
});

test("explains a missing balance instead of a revert", async () => {
  const { pledgeShortfall } = await import("./preview.ts");
  assert.equal(pledgeShortfall(10n ** 18n, 5n * 10n ** 17n, "TSLAB"), null);
  assert.equal(pledgeShortfall(0n, 2n * 10n ** 17n, "TSLAB"), "Your wallet holds 0 TSLAB, so 0.2 can't be pledged.");
  assert.equal(pledgeShortfall(10n ** 17n, 2n * 10n ** 17n, "NVDAB"), "Your wallet holds 0.1 NVDAB, so 0.2 can't be pledged.");
});
