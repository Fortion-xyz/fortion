// Market brain: Binance Web3 RWA Data API (PRD §6) + market clock.
import { config, type Ticker } from "./config.ts";
import type { MarketStatus } from "./policy.ts";

async function binance<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!config.binance.url) throw new Error("BINANCE_WEB3_API_URL is not configured");
  const res = await fetch(`${config.binance.url}${path}?${new URLSearchParams(params)}`, {
    headers: config.binance.key ? { "X-API-KEY": config.binance.key } : {},
  });
  if (!res.ok) throw new Error(`Binance ${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface MarketWindow {
  ticker: Ticker;
  status: MarketStatus;
  reason: string | null; // e.g. cash_dividend, stock_split
  onchainUsd: number;
  referenceUsd: number;
  spread: number;
  hoursToCorporateAction: number | null;
  minutesToWeekendClose: number | null;
}

// TODO(day1): response shapes are unverified — confirm field names against the API key docs.
interface RwaPrice { onchainPrice: string; referencePrice: string }
interface RwaMarket { status: MarketStatus; reason?: string; nextCorporateActionAt?: string }

export async function getMarketWindow(ticker: Ticker, now = new Date()): Promise<MarketWindow> {
  const [p, m] = await Promise.all([
    binance<RwaPrice>("/rwa/price", { symbol: ticker }),
    binance<RwaMarket>("/rwa/underlying-market", { symbol: ticker }),
  ]);
  const onchainUsd = Number(p.onchainPrice);
  const referenceUsd = Number(p.referencePrice);
  return {
    ticker,
    status: m.status,
    reason: m.reason ?? null,
    onchainUsd,
    referenceUsd,
    spread: Math.abs(onchainUsd - referenceUsd) / referenceUsd,
    hoursToCorporateAction: m.nextCorporateActionAt
      ? Math.max(0, (Date.parse(m.nextCorporateActionAt) - now.getTime()) / 3.6e6)
      : null,
    minutesToWeekendClose: minutesToWeekendClose(now),
  };
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
