// Market brain: Binance Web3 RWA Data API (PRD §6) + market clock.
// Docs: https://web3.binance.com/en/dev-docs/catalog/web3-wallet/api/rest-api/rwa-data
import { binanceGet } from "./binance.ts";
import { BSTOCKS, type Ticker } from "./config.ts";
import type { MarketStatus } from "./policy.ts";

const RWA = "/api/v1/dex/market/rwa";
const BSC = "56";
const UPCOMING_EARNINGS_TAB = "3";

export interface StatusInfo {
  openState: boolean;
  marketStatus: string; // premarket | regular | postmarket | overnight | closed | pause
  reasonCode: string; // TRADING | MARKET_CLOSED | MARKET_PAUSED | MARKET_MAINTENANCE | ASSET_PAUSED | ASSET_LIMITED | UNSUPPORTED
  reasonMsg: string | null; // cash_dividend, stock_split, earnings, …
}
interface RwaPrice { tokenContractAddress: string; tokenPrice: string; referencePrice: string }
interface RwaToken { tokenContractAddress: string }

export interface MarketWindow {
  ticker: Ticker;
  status: MarketStatus;
  session: string;
  reason: string | null;
  onchainUsd: number;
  referenceUsd: number;
  spread: number;
  hoursToCorporateAction: number | null;
  minutesToWeekendClose: number | null;
}

/** Collapse Binance status into the Guard's four states. Anything unknown is treated as closed. */
export function toMarketStatus(s: StatusInfo): MarketStatus {
  switch (s.reasonCode) {
    case "ASSET_PAUSED":
    case "UNSUPPORTED":
      return "ASSET_PAUSED";
    case "ASSET_LIMITED":
      return "ASSET_LIMITED";
    case "TRADING":
      // Pre/post/overnight sessions trade on thinner books; hold them to the overnight target.
      return s.marketStatus === "regular" ? "TRADING" : "MARKET_CLOSED";
    default:
      return "MARKET_CLOSED";
  }
}

export function toMarketWindow(ticker: Ticker, price: RwaPrice, status: StatusInfo, earningsSoon: boolean, now: Date): MarketWindow {
  const onchainUsd = Number(price.tokenPrice);
  const referenceUsd = Number(price.referencePrice);
  return {
    ticker,
    status: toMarketStatus(status),
    session: status.marketStatus,
    reason: status.reasonMsg,
    onchainUsd,
    referenceUsd,
    spread: referenceUsd > 0 ? Math.abs(onchainUsd - referenceUsd) / referenceUsd : 1,
    // ponytail: the API has no earnings date, only an "Upcoming Earnings" list. Being on it counts as
    // "corporate action now" (halt target). Replace with a real hour count if a date field appears.
    hoursToCorporateAction: earningsSoon ? 0 : null,
    minutesToWeekendClose: minutesToWeekendClose(now),
  };
}

export async function getMarketWindow(ticker: Ticker, now = new Date()): Promise<MarketWindow> {
  const address = BSTOCKS[ticker];
  const same = (a: string) => a.toLowerCase() === address.toLowerCase();
  const [prices, market, upcoming] = await Promise.all([
    binanceGet<RwaPrice[]>(`${RWA}/price`, { binanceChainId: BSC, tokenContractAddresses: address }),
    binanceGet<{ statusInfo: StatusInfo }>(`${RWA}/underlying-market`, { binanceChainId: BSC, tokenContractAddress: address }),
    binanceGet<RwaToken[]>(`${RWA}/tokens`, { binanceChainId: BSC, platformId: "bstock", tabId: UPCOMING_EARNINGS_TAB }),
  ]);
  const price = prices.find((p) => same(p.tokenContractAddress));
  if (!price) throw new Error(`Binance RWA returned no price for ${ticker}`);
  return toMarketWindow(ticker, price, market.statusInfo, upcoming.some((t) => same(t.tokenContractAddress)), now);
}

/** Minutes until Friday 16:00 New York close; null on other days or after close. */
export function minutesToWeekendClose(now: Date): number | null {
  const ny = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => ny.find((x) => x.type === t)!.value;
  if (get("weekday") !== "Fri") return null;
  const left = 16 * 60 - (Number(get("hour")) * 60 + Number(get("minute")));
  return left > 0 ? left : null;
}
