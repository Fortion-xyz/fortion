// Long-running evidence logger for PRD §10.3: how Binance RWA status and the Venus oracle behave
// around halts, earnings (e.g. MUB on 30 Sep), maintenance (26 Sep) and weekends.
// Appends JSONL to backend/data/rwa-monitor.jsonl:
//   {type:"status"} whenever any bStock's statusInfo changes (polled every 60s, one API call)
//   {type:"prices"} every 5 min: RWA tokenPrice/referencePrice + Venus oracle price for our markets
// Usage: pnpm --filter backend monitor:rwa   (safe to restart; state is rebuilt from the first poll)
import { appendFileSync, mkdirSync } from "node:fs";
import { formatUnits, parseAbi } from "viem";
import { binanceGet } from "../src/core/binance.ts";
import { BSTOCKS, VENUS } from "../src/core/config.ts";
import { client } from "../src/core/venus.ts";

const OUT = new URL("../data/rwa-monitor.jsonl", import.meta.url);
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
const write = (row: object) => appendFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n");

interface Token {
  tokenSymbol: string;
  tokenPrice: string;
  referencePrice: string;
  statusInfo: { openState: boolean; marketStatus: string | null; reasonCode: string; reasonMsg: string | null; nextOpenTime: unknown; nextCloseTime: unknown };
}

const last = new Map<string, string>();
async function pollStatus() {
  const tokens = await binanceGet<Token[]>("/api/v1/dex/market/rwa/tokens", { binanceChainId: "56", platformId: "bstock" });
  for (const t of tokens) {
    const key = JSON.stringify(t.statusInfo);
    const prev = last.get(t.tokenSymbol);
    if (prev !== key) write({ type: "status", symbol: t.tokenSymbol, first: prev === undefined, statusInfo: t.statusInfo, tokenPrice: t.tokenPrice, referencePrice: t.referencePrice });
    last.set(t.tokenSymbol, key);
  }
  return tokens;
}

const oracleAbi = parseAbi(["function oracle() view returns (address)", "function getUnderlyingPrice(address) view returns (uint256)"]);
async function pollPrices(tokens: Token[]) {
  const oracle = await client.readContract({ address: VENUS.comptroller, abi: oracleAbi, functionName: "oracle" });
  const rows = await Promise.all(
    (Object.keys(BSTOCKS) as (keyof typeof BSTOCKS)[]).map(async (symbol) => {
      const raw = await client.readContract({ address: oracle, abi: oracleAbi, functionName: "getUnderlyingPrice", args: [VENUS.vTokens[symbol]] });
      const t = tokens.find((x) => x.tokenSymbol === symbol);
      return { symbol, venusOracle: Number(formatUnits(raw, 18)), tokenPrice: Number(t?.tokenPrice), referencePrice: Number(t?.referencePrice) };
    }),
  );
  write({ type: "prices", rows });
}

let tick = 0;
async function loop() {
  try {
    const tokens = await pollStatus();
    if (tick % 5 === 0) await pollPrices(tokens);
  } catch (err) {
    write({ type: "error", message: (err as Error).message });
  }
  tick++;
}

console.log(`rwa-monitor → ${OUT.pathname}`);
await loop();
setInterval(loop, 60_000);
