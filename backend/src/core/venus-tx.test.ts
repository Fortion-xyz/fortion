import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionResult } from "viem";
import { VENUS } from "./config.ts";
import { abi, callError, pledge, repayUsdt } from "./venus-tx.ts";

test("pledge = approve, mint, enterMarkets, borrow in order", () => {
  const calls = pledge("NVDAB", 10n ** 18n, 50n * 10n ** 18n);
  assert.deepEqual(calls.map((c) => c.label), ["approve NVDAB", "supply NVDAB", "use NVDAB as collateral", "borrow USDT"]);
  assert.equal(calls[1]!.to, VENUS.vTokens.NVDAB);
  assert.equal(calls[3]!.to, VENUS.vUSDT);
});

test("callError flags Venus error codes, including code 1", () => {
  const [, mint] = pledge("NVDAB", 1n, 1n);
  const ret = (x: bigint) => encodeFunctionResult({ abi: abi.vToken, functionName: "mint", result: x });
  assert.equal(callError(mint!, ret(0n)), null);
  assert.match(callError(mint!, ret(1n))!, /error code 1/);
});

test("callError checks approve and enterMarkets shapes", () => {
  const [approve] = repayUsdt(1n);
  assert.equal(callError(approve!, encodeFunctionResult({ abi: abi.erc20, functionName: "approve", result: true })), null);
  const enter = pledge("TSLAB", 1n, 1n)[2]!;
  assert.match(callError(enter, encodeFunctionResult({ abi: abi.comptroller, functionName: "enterMarkets", result: [3n] }))!, /code 3/);
});
