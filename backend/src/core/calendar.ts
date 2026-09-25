// Earnings calendar (PRD §5.1 F3). Binance RWA has no earnings date, so dates come from
// Nasdaq's keyless earnings-date endpoint plus operator overrides (CORPORATE_ACTIONS).
// ponytail: unofficial endpoint (Zacks data via api.nasdaq.com), no SLA. If it breaks, the operator
// calendar still works and RWA ASSET_PAUSED / ASSET_LIMITED still catch the halt itself.
import { config, type Ticker } from "./config.ts";

export interface Earnings {
  at: Date;
  /** true = scheduled by the company ("expected"); false = Zacks' algorithmic estimate. */
  confirmed: boolean;
  source: "nasdaq" | "operator";
}

const UNDERLYING: Record<Ticker, string> = { NVDAB: "NVDA", TSLAB: "TSLA", SPCXB: "SPCX" };

/** Wall-clock time in New York → UTC Date (DST-aware, no tz library). */
export function nyTime(y: number, m: number, d: number, hh: number, mm: number): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const ny = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "America/New_York" }));
  const utc = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess + (utc.getTime() - ny.getTime()));
}

/** Parse Nasdaq's reportText, e.g. "…is expected* to report earnings on  09/30/2026 after market close." */
export function parseNasdaq(reportText: string): Omit<Earnings, "source"> | null {
  const m = /(expected|estimated)\*? to report earnings on\s+(\d{2})\/(\d{2})\/(\d{4})(?:\s+(before market open|after market close))?/i.exec(reportText);
  if (!m) return null;
  const [, kind, mo, d, y, when] = m;
  // Unknown time → 09:30 ET, the earliest plausible halt; earlier is the conservative side.
  const [hh, mm] = /after/i.test(when ?? "") ? [16, 0] : [9, 30];
  return { at: nyTime(Number(y), Number(mo), Number(d), hh, mm), confirmed: kind!.toLowerCase() === "expected" };
}

const TTL_MS = 6 * 3600_000;
const cache = new Map<Ticker, { at: number; value: Earnings | null }>();

async function fromNasdaq(ticker: Ticker): Promise<Earnings | null> {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const res = await fetch(`https://api.nasdaq.com/api/analyst/${UNDERLYING[ticker]}/earnings-date`, {
      headers: { "User-Agent": "Mozilla/5.0 (Fortion keeper)", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { data?: { reportText?: string } };
    const parsed = parseNasdaq(json.data?.reportText ?? "");
    const value = parsed && { ...parsed, source: "nasdaq" as const };
    cache.set(ticker, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.warn(`calendar: nasdaq ${ticker} failed, keeping last value:`, (err as Error).message);
    return hit?.value ?? null; // stale beats nothing; the operator calendar still applies
  }
}

/** Upcoming earnings for a ticker: operator dates first (they override), then Nasdaq. */
export async function upcomingEarnings(ticker: Ticker, now = new Date()): Promise<Earnings[]> {
  const operator = (config.corporateActions[ticker] ?? []).map((at) => ({ at, confirmed: true, source: "operator" as const }));
  const nasdaq = await fromNasdaq(ticker);
  return [...operator, ...(nasdaq ? [nasdaq] : [])].filter((e) => e.at > now).sort((a, b) => +a.at - +b.at);
}
