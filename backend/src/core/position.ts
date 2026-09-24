// One entry point shared by API, keeper and MCP: live state → policy decision.
import { getAddress, isAddress, type Address } from "viem";
import { TICKERS, type Ticker } from "./config.ts";
import { getMarketWindow } from "./market.ts";
import { availableCash, decide, DEFAULT_POLICY, type Policy, type Snapshot } from "./policy.ts";
import { readVenusPosition, usdtBalance } from "./venus.ts";

// ponytail: in-memory, lost on restart. Move to a file/KV once the keeper runs on Agent Studio.
const policies = new Map<Address, Policy>();

export const getPolicy = (a: Address) => policies.get(a) ?? DEFAULT_POLICY;
export const setPolicy = (a: Address, p: Partial<Policy>) => policies.set(a, { ...getPolicy(a), ...p }).get(a)!;

export function parseAddress(a: string): Address {
  if (!isAddress(a)) throw new InputError(`Invalid address: ${a}`);
  return getAddress(a);
}

export function parseTicker(t: string | undefined): Ticker {
  const up = (t ?? "NVDAB").toUpperCase();
  if (!TICKERS.includes(up as Ticker)) throw new InputError(`Unsupported ticker: ${t}. Use ${TICKERS.join(", ")}`);
  return up as Ticker;
}

export class InputError extends Error {}

export async function getPosition(account: Address, ticker: Ticker) {
  const policy = getPolicy(account);
  const [venus, usdt, market] = await Promise.all([
    readVenusPosition(account, ticker),
    usdtBalance(account),
    getMarketWindow(ticker),
  ]);
  // Shadow oracle (PRD §13): value collateral at the lower of Venus oracle and RWA reference.
  const collateralUsd = venus.collateralUsd * Math.min(1, market.referenceUsd / market.onchainUsd);
  // ponytail: buffer = the tagged 15% of debt, capped by what is actually in the wallet.
  const bufferUsd = Math.min(usdt, (venus.debtUsd * policy.bufferBps) / 10_000);
  const snapshot: Snapshot = {
    collateralUsd,
    debtUsd: venus.debtUsd,
    bufferUsd,
    market: market.status,
    spread: market.spread,
    hoursToCorporateAction: market.hoursToCorporateAction,
    minutesToWeekendClose: market.minutesToWeekendClose,
  };
  return { account, ticker, policy, snapshot, market, decision: decide(snapshot, policy), availableCash: availableCash(snapshot) };
}

export type Position = Awaited<ReturnType<typeof getPosition>>;
