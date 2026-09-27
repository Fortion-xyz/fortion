// One entry point shared by API, keeper and MCP: live state → policy decision.
import { getAddress, isAddress, type Address } from "viem";
import { config, TICKERS, type Ticker } from "./config.ts";
import { getMarketWindow } from "./market.ts";
import { availableCash, decide, type Policy, type Snapshot } from "./policy.ts";
import { openStore } from "./store.ts";
import { readVenusPosition, usdtBalance } from "./venus.ts";

export const db = openStore(config.dataDir);
export const getPolicy = (a: Address) => db.getPolicy(a);
export const setPolicy = (a: Address, p: Partial<Policy>) => db.setPolicy(a, p);

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

/**
 * Shadow oracle (PRD §13): value collateral at the lower of the Venus oracle (≈ token price) and the
 * real stock price. The token's implied per-share price is `referenceUsd`, so the haircut is stock / reference.
 */
export function conservativeCollateral(venusUsd: number, m: { referenceUsd: number; stockUsd: number | null }): number {
  if (m.stockUsd === null || m.referenceUsd <= 0) return venusUsd;
  return venusUsd * Math.min(1, m.stockUsd / m.referenceUsd);
}

/**
 * Venus debt (vUSDT) and the USDT buffer are account-wide; collateral is per stock. Each stock's Guard
 * pass carries its share by collateral value, so it sees the account's true LTV and stocks the user
 * never pledged carry nothing (review Critical #3). With no collateral anywhere, the first stock
 * alone reports the debt so it is surfaced once, not three times.
 */
export function debtShare(collateral: Record<Ticker, number>, ticker: Ticker, debtUsd: number, bufferUsd: number) {
  const total = TICKERS.reduce((sum, t) => sum + collateral[t], 0);
  const share = total > 0 ? collateral[ticker] / total : ticker === TICKERS[0] ? 1 : 0;
  return { debtUsd: debtUsd * share, bufferUsd: bufferUsd * share };
}

export async function getPosition(account: Address, ticker: Ticker) {
  const policy = getPolicy(account);
  const [markets, usdt, market] = await Promise.all([
    Promise.all(TICKERS.map((t) => readVenusPosition(account, t))),
    usdtBalance(account),
    getMarketWindow(ticker),
  ]);
  const venus = markets[TICKERS.indexOf(ticker)]!;
  const collateralUsd = conservativeCollateral(venus.collateralUsd, market);
  // ponytail: buffer = the tagged 15% of debt, capped by what is actually in the wallet.
  const accountBuffer = Math.min(usdt, (venus.debtUsd * policy.bufferBps) / 10_000);
  const byTicker = Object.fromEntries(TICKERS.map((t, i) => [t, markets[i]!.collateralUsd])) as Record<Ticker, number>;
  const share = debtShare(byTicker, ticker, venus.debtUsd, accountBuffer);
  const snapshot: Snapshot = {
    collateralUsd,
    debtUsd: share.debtUsd,
    bufferUsd: share.bufferUsd,
    market: market.status,
    spread: market.spread,
    hoursToCorporateAction: market.hoursToCorporateAction,
    minutesToWeekendClose: market.minutesToWeekendClose,
    liquidationThreshold: venus.liquidationThreshold,
  };
  return { account, ticker, policy, snapshot, market, collateralFactor: venus.collateralFactor, decision: decide(snapshot, policy), availableCash: availableCash(snapshot, policy.profile) };
}

export type Position = Awaited<ReturnType<typeof getPosition>>;
