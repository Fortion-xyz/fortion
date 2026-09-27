// Real stock price (last sale) from Nasdaq's keyless quote endpoint.
// Needed because Binance RWA `referencePrice` is derived from the token price itself
// (= tokenPrice / tokenToShareRatio, verified by the RWA monitor 25–27 Sep), so it can't
// show a weekend gap between the token and the stock.
// ponytail: unofficial endpoint, no SLA. Without a fresh quote the spread is unknown and new borrowing freezes.
import { UNDERLYING, type Ticker } from "./config.ts";

export interface StockQuote {
  priceUsd: number;
  asOf: string; // as Nasdaq prints it, e.g. "Sep 24, 2026"
  marketOpen: boolean;
}

export function parseNasdaqQuote(json: unknown): StockQuote | null {
  const d = (json as { data?: { marketStatus?: string; primaryData?: { lastSalePrice?: string; lastTradeTimestamp?: string } } | null })?.data;
  const price = Number(d?.primaryData?.lastSalePrice?.replace(/[$,]/g, ""));
  if (!d || !Number.isFinite(price) || price <= 0) return null;
  return { priceUsd: price, asOf: d.primaryData?.lastTradeTimestamp ?? "", marketOpen: d.marketStatus === "Open" };
}

const TTL_MS = 60_000;
const MAX_AGE_MS = 15 * 60_000; // never decide on a stock price older than this

/** A cached quote, or null once it is older than 15 minutes (review Important #5). */
export function freshQuote(hit: { at: number; value: StockQuote | null } | undefined, now: number): StockQuote | null {
  return hit && now - hit.at <= MAX_AGE_MS ? hit.value : null;
}
const cache = new Map<Ticker, { at: number; value: StockQuote | null }>();

export async function lastStockPrice(ticker: Ticker): Promise<StockQuote | null> {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const res = await fetch(`https://api.nasdaq.com/api/quote/${UNDERLYING[ticker]}/info?assetclass=stocks`, {
      headers: { "User-Agent": "Mozilla/5.0 (Fortion keeper)", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const value = parseNasdaqQuote(await res.json());
    cache.set(ticker, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.warn(`quote: nasdaq ${ticker} failed:`, (err as Error).message);
    return freshQuote(hit, Date.now());
  }
}
