import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData } from "viem";
import { calldata, parseCommand } from "./commands.ts";
import { VENUS } from "../core/config.ts";
import { abi } from "../core/venus-tx.ts";

const A = "0x000000000000000000000000000000000000dEaD";

test("parses every command with its options", () => {
  assert.deepEqual(parseCommand(["status", A]), { cmd: "status", address: A, ticker: undefined });
  assert.deepEqual(parseCommand(["pledge", A, "NVDAB", "0.5", "--cash", "50", "--yes"]), { cmd: "pledge", address: A, ticker: "NVDAB", amount: "0.5", cash: 50, mode: "cash", yes: true });
  assert.deepEqual(parseCommand(["pledge", A, "tslab", "1", "--mode", "accumulate"]), { cmd: "pledge", address: A, ticker: "TSLAB", amount: "1", cash: undefined, mode: "accumulate", yes: false });
  assert.deepEqual(parseCommand(["repay", A, "NVDAB", "all"]), { cmd: "repay", address: A, ticker: "NVDAB", usdt: "all", yes: false });
  assert.deepEqual(parseCommand(["draw", A, "NVDAB", "10"]), { cmd: "draw", address: A, ticker: "NVDAB", cash: 10, yes: false });
  assert.deepEqual(parseCommand(["signin"]), { cmd: "signin" });
});

test("rejects bad input with usage, never guesses", () => {
  assert.throws(() => parseCommand([]), /Usage/);
  assert.throws(() => parseCommand(["pledge", A, "NVDAB"]), /Usage/);
  assert.throws(() => parseCommand(["pledge", A, "NVDAB", "1", "--mode", "yolo"]), /mode/);
  assert.throws(() => parseCommand(["repay", A, "NVDAB", "-5"]), /amount/);
  assert.throws(() => parseCommand(["fly"]), /Unknown command/);
});

test("calldata prints unsigned calls for the Wallet Skill", () => {
  const supply = calldata(["supply", "NVDAB", "0.5"]);
  assert.deepEqual(supply.map((c) => c.label), ["approve NVDAB", "supply NVDAB", "use NVDAB as collateral"]);
  const [borrow] = calldata(["borrow", "12.5"]);
  assert.equal(borrow!.to, VENUS.vUSDT);
  assert.deepEqual(decodeFunctionData({ abi: abi.vToken, data: borrow!.data }).args, [12_500_000_000_000_000_000n]);
  assert.deepEqual(calldata(["repay", "3"]).map((c) => c.label), ["approve USDT", "repay USDT"]);
  assert.deepEqual(calldata(["withdraw", "TSLAB", "0.1"]).map((c) => c.label), ["withdraw TSLAB"]);
  assert.throws(() => calldata(["borrow"]), /Usage/);
});
