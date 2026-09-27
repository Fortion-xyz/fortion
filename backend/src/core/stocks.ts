// Stock catalog for the Get stocks screen (PRD F1, issue #16).
import { formatUnits, parseAbi } from "viem";
import { binanceGet } from "./binance.ts";
import { BSTOCKS, TICKERS, UNDERLYING, VENUS, type Ticker } from "./config.ts";
import { getMarketWindow, type MarketWindow } from "./market.ts";
import { client } from "./venus.ts";

const BUY_MAX_SPREAD = 0.01; // PRD F1: spread > 1% blocks buying

interface TokenMeta { tokenName: string; tokenLogoUrl: string }
interface Supply { cap: number; supplied: number } // in tokens

export function toStock(m: MarketWindow, meta: TokenMeta | null, supply: Supply) {
  const paused = m.status === "ASSET_PAUSED" || m.status === "ASSET_LIMITED";
  const buyBlockedReason = paused
    ? `Trading is paused${m.reason ? ` (${m.reason.replace(/_/g, " ")})` : ""}.`
    : m.spread > BUY_MAX_SPREAD
      ? "The token price is too far from the real stock price right now."
      : null;
  return {
    ticker: m.ticker,
    name: meta?.tokenName ?? m.ticker,
    underlying: UNDERLYING[m.ticker],
    logoUrl: meta?.tokenLogoUrl ?? null,
    priceUsd: m.onchainUsd,
    stockUsd: m.stockUsd,
    spread: m.spread,
    status: m.status,
    regularSession: m.regularSession,
    reason: m.reason,
    nextEarnings: m.nextEarnings,
    supplyRoom: Math.max(0, supply.cap - supply.supplied),
    buyAllowed: buyBlockedReason === null,
    buyBlockedReason,
  };
}

export type Stock = ReturnType<typeof toStock>;

const venusAbi = parseAbi([
  "function supplyCaps(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
]);

async function supplyOf(ticker: Ticker): Promise<Supply> {
  const vToken = VENUS.vTokens[ticker];
  const [cap, total, rate] = await Promise.all([
    client.readContract({ address: VENUS.comptroller, abi: venusAbi, functionName: "supplyCaps", args: [vToken] }),
    client.readContract({ address: vToken, abi: venusAbi, functionName: "totalSupply" }),
    client.readContract({ address: vToken, abi: venusAbi, functionName: "exchangeRateStored" }),
  ]);
  // bStocks are 18 decimals; vToken × rate / 1e18 = underlying.
  return { cap: Number(formatUnits(cap, 18)), supplied: Number(formatUnits((total * rate) / 10n ** 18n, 18)) };
}

const META_TTL_MS = 10 * 60_000;
let meta: { at: number; byAddress: Map<string, TokenMeta> } | undefined;
async function tokenMeta(): Promise<Map<string, TokenMeta>> {
  if (meta && Date.now() - meta.at < META_TTL_MS) return meta.byAddress;
  const tokens = await binanceGet<(TokenMeta & { tokenContractAddress: string })[]>("/api/v1/dex/market/rwa/tokens", {
    binanceChainId: "56",
    platformId: "bstock",
  });
  meta = { at: Date.now(), byAddress: new Map(tokens.map((t) => [t.tokenContractAddress.toLowerCase(), t])) };
  return meta.byAddress;
}

export async function listStocks(): Promise<Stock[]> {
  // Names and logos are cosmetic: a metadata failure must not hide prices.
  const byAddress = await tokenMeta().catch(() => new Map<string, TokenMeta>());
  return Promise.all(
    TICKERS.map(async (t) => {
      const [m, s] = await Promise.all([getMarketWindow(t), supplyOf(t)]);
      return toStock(m, byAddress.get(BSTOCKS[t].toLowerCase()) ?? null, s);
    }),
  );
}
