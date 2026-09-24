// Venus call builders (PRD §7). Unsigned {to, data}: simulate first, then the Agentic Wallet signs.
// Venus vTokens are Compound-style: many failures return a non-zero uint instead of reverting,
// so callers must check `callError()` on every simulated result, not just the call status.
import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, maxUint256, parseAbi, type Address, type Hex } from "viem";
import { BSTOCKS, USDT, VENUS, type Ticker } from "./config.ts";

export interface Call {
  to: Address;
  data: Hex;
  label: string; // human-readable, shown in logs and simulation output
}

export const abi = {
  erc20: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
  vToken: parseAbi([
    "function mint(uint256 amount) returns (uint256)",
    "function borrow(uint256 amount) returns (uint256)",
    "function repayBorrow(uint256 amount) returns (uint256)",
    "function redeemUnderlying(uint256 amount) returns (uint256)",
  ]),
  comptroller: parseAbi(["function enterMarkets(address[] vTokens) returns (uint256[])"]),
};

const call = (to: Address, label: string, data: Hex): Call => ({ to, data, label });

export function supply(ticker: Ticker, amount: bigint): Call[] {
  const vToken = VENUS.vTokens[ticker];
  return [
    call(BSTOCKS[ticker], `approve ${ticker}`, encodeFunctionData({ abi: abi.erc20, functionName: "approve", args: [vToken, amount] })),
    call(vToken, `supply ${ticker}`, encodeFunctionData({ abi: abi.vToken, functionName: "mint", args: [amount] })),
    call(VENUS.comptroller, `use ${ticker} as collateral`, encodeFunctionData({ abi: abi.comptroller, functionName: "enterMarkets", args: [[vToken]] })),
  ];
}

export const borrowUsdt = (amount: bigint): Call =>
  call(VENUS.vUSDT, "borrow USDT", encodeFunctionData({ abi: abi.vToken, functionName: "borrow", args: [amount] }));

/** Pass maxUint256 to repay the full debt including interest accrued until the tx lands. */
export function repayUsdt(amount: bigint): Call[] {
  return [
    call(USDT, "approve USDT", encodeFunctionData({ abi: abi.erc20, functionName: "approve", args: [VENUS.vUSDT, amount] })),
    call(VENUS.vUSDT, "repay USDT", encodeFunctionData({ abi: abi.vToken, functionName: "repayBorrow", args: [amount] })),
  ];
}

export const withdraw = (ticker: Ticker, amount: bigint): Call =>
  call(VENUS.vTokens[ticker], `withdraw ${ticker}`, encodeFunctionData({ abi: abi.vToken, functionName: "redeemUnderlying", args: [amount] }));

/** Flow A (PRD §8): supply + enter market + borrow, as one batch for a single wallet approval. */
export const pledge = (ticker: Ticker, collateral: bigint, borrow: bigint): Call[] => [...supply(ticker, collateral), borrowUsdt(borrow)];

export const REPAY_ALL = maxUint256;

const all = [...abi.erc20, ...abi.vToken, ...abi.comptroller];

/** Why a simulated call failed despite not reverting, or null if it succeeded. */
export function callError(c: Call, returnData: Hex): string | null {
  const { functionName } = decodeFunctionData({ abi: all, data: c.data });
  const result = decodeFunctionResult({ abi: all, functionName, data: returnData }) as unknown;
  if (functionName === "approve") return result === true ? null : `${c.label}: approve returned false`;
  const codes = Array.isArray(result) ? (result as bigint[]) : [result as bigint];
  const bad = codes.find((x) => x !== 0n);
  return bad === undefined ? null : `${c.label}: Venus error code ${bad}`;
}
