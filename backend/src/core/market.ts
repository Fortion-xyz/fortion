// Market brain: Binance Web3 RWA Data API (PRD §6) + New York market clock.
// Docs: https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/rwa-data
// Verified live 25 Sep 2026: bStocks report reasonCode TRADING around the clock on weekdays and
// marketStatus is null, so the regular session comes from the clock, not the API.
import { binanceGet } from "./binance.ts";
import { upcomingEarnings, type Earnings } from "./calendar.ts";
import { BSTOCKS, type Ticker } from "./config.ts";
import type { MarketStatus } from "./policy.ts";

const RWA = "/api/v1/dex/market/rwa";
const BSC = "56";

export interface StatusInfo {
  openState: boolean;
  marketStatus: string | null;
  reasonCode: string; // TRADING | MARKET_CLOSED | MARKET_PAUSED | MARKET_MAINTENANCE | ASSET_PAUSED | ASSET_LIMITED | UNSUPPORTED
  reasonMsg: string | null; // cash_dividend, stock_split, earnings, …
}
interface RwaPrice { tokenContractAddress: string; tokenPrice: string; referencePrice: string }

export interface MarketWindow {
  ticker: Ticker;
  status: MarketStatus;
  regularSession: boolean;
  reason: string | null;
  onchainUsd: number;
  referenceUsd: number;
  spread: number;
  hoursToCorporateAction: number | null; // from confirmed dates only
  nextEarnings: Earnings | null; // may be an estimate; shown to the user, not acted on
  minutesToWeekendClose: number | null;
}

/** Binance status + clock → the Guard's four states. Anything unknown is treated as closed. */
export function toMarketStatus(s: StatusInfo, regularSession: boolean): MarketStatus {
  switch (s.reasonCode) {
    case "ASSET_PAUSED":
    case "UNSUPPORTED":
      return "ASSET_PAUSED";
    case "ASSET_LIMITED":
      return "ASSET_LIMITED";
    case "TRADING":
      // Outside 09:30–16:00 NY the token trades but the stock doesn't: hold to the overnight target.
      return regularSession ? "TRADING" : "MARKET_CLOSED";
    default:
      return "MARKET_CLOSED";
  }
}

export function toMarketWindow(ticker: Ticker, price: RwaPrice, status: StatusInfo, now: Date, earnings: Earnings[] = []): MarketWindow {
  const onchainUsd = Number(price.tokenPrice);
  const referenceUsd = Number(price.referencePrice);
  const regularSession = isRegularSession(now);
  const upcoming = earnings.filter((e) => e.at > now).sort((a, b) => +a.at - +b.at);
  const next = upcoming.find((e) => e.confirmed);
  return {
    ticker,
    status: toMarketStatus(status, regularSession),
    regularSession,
    reason: status.reasonMsg,
    onchainUsd,
    referenceUsd,
    spread: referenceUsd > 0 ? Math.abs(onchainUsd - referenceUsd) / referenceUsd : 1,
    hoursToCorporateAction: next ? (+next.at - +now) / 3.6e6 : null,
    nextEarnings: upcoming[0] ?? null,
    minutesToWeekendClose: minutesToWeekendClose(now),
  };
}

// Binance allows ~5 req/s per endpoint (measured 25 Sep). Raw data is cached briefly and shared by
// concurrent callers; clock-derived fields are recomputed on every read.
const CACHE_MS = 15_000;
const cache = new Map<Ticker, { at: number; data: Promise<{ price: RwaPrice; statusInfo: StatusInfo }> }>();

function fetchRaw(ticker: Ticker) {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const address = BSTOCKS[ticker];
  const data = Promise.all([
    binanceGet<RwaPrice[]>(`${RWA}/price`, { binanceChainId: BSC, tokenContractAddresses: address }),
    binanceGet<{ statusInfo: StatusInfo }>(`${RWA}/underlying-market`, { binanceChainId: BSC, tokenContractAddress: address }),
  ]).then(([prices, market]) => {
    const price = prices.find((p) => p.tokenContractAddress.toLowerCase() === address.toLowerCase());
    if (!price) throw new Error(`Binance RWA returned no price for ${ticker}`);
    return { price, statusInfo: market.statusInfo };
  });
  data.catch(() => cache.delete(ticker)); // never cache a failure
  cache.set(ticker, { at: Date.now(), data });
  return data;
}

export async function getMarketWindow(ticker: Ticker, now = new Date()): Promise<MarketWindow> {
  const [{ price, statusInfo }, earnings] = await Promise.all([fetchRaw(ticker), upcomingEarnings(ticker, now)]);
  return toMarketWindow(ticker, price, statusInfo, now, earnings);
}

function nyClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((x) => x.type === t)!.value;
  return { weekday: get("weekday"), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;

// ponytail: NYSE holidays are not modelled; on a holiday the clock says "regular" and only the
// on-chain / reference spread guards the loan. Add a holiday list if the demo window hits one.
export function isRegularSession(now: Date): boolean {
  const { weekday, minutes } = nyClock(now);
  return !["Sat", "Sun"].includes(weekday) && minutes >= OPEN && minutes < CLOSE;
}

/** Minutes until Friday 16:00 New York close; null on other days or after close. */
export function minutesToWeekendClose(now: Date): number | null {
  const { weekday, minutes } = nyClock(now);
  if (weekday !== "Fri") return null;
  const left = CLOSE - minutes;
  return left > 0 ? left : null;
}
