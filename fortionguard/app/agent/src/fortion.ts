/**
 * Fortion's service: a plain-language risk report for a stock-backed Venus loan.
 *
 * Deterministic on purpose: the report comes from the Fortion backend (the same engine the app,
 * the keeper and the MCP server use), so no LLM call, no model cost, and nothing here can sign.
 * The user's own loan is signed by their Agentic Wallet on the keeper host, never by this Agent.
 */
import type { RunWork } from "./sellerCore.js";

const TICKERS: Record<string, string> = {
  nvdab: "NVDAB", nvda: "NVDAB", nvidia: "NVDAB",
  tslab: "TSLAB", tsla: "TSLAB", tesla: "TSLAB",
  spcxb: "SPCXB", spcx: "SPCXB", spacex: "SPCXB",
};

export function parseRequest(prompt: string): { address: string; ticker: string } | null {
  const address = prompt.match(/0x[0-9a-fA-F]{40}/)?.[0];
  if (!address) return null;
  const word = prompt.toLowerCase().match(/\b(nvdab|nvda|nvidia|tslab|tsla|tesla|spcxb|spcx|spacex)\b/)?.[1];
  return { address, ticker: word ? TICKERS[word]! : "NVDAB" };
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function fortionRunWork(deps: { apiUrl: string; fetch?: typeof fetch }): RunWork {
  const get = deps.fetch ?? fetch;
  return async (prompt, { abortSignal }) => {
    const req = parseRequest(prompt);
    if (!req)
      return "Send a BNB Smart Chain wallet address (and optionally NVDAB, TSLAB or SPCXB) to get a risk report for its Venus loan against tokenized stock.";
    const res = await get(`${deps.apiUrl}/explain/${req.address}?ticker=${req.ticker}`, { signal: abortSignal });
    const body = await res.text();
    if (!res.ok) {
      const why = (() => { try { return (JSON.parse(body) as { error?: string }).error ?? body; } catch { return body; } })();
      return `Fortion couldn't read that position: ${why}`;
    }
    return `Fortion risk report · ${req.ticker} · ${short(req.address)}\n${body}`;
  };
}
