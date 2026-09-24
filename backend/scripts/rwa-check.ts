// Live check of the Binance Web3 RWA endpoints Fortion uses. Prints raw `data` so shapes can be verified.
// Usage: pnpm --filter backend check:rwa
import { binanceGet } from "../src/core/binance.ts";
import { BSTOCKS } from "../src/core/config.ts";

const RWA = "/api/v1/dex/market/rwa";
const show = (label: string, v: unknown) => console.log(`\n== ${label}\n${JSON.stringify(v, null, 2).slice(0, 1500)}`);
const tryGet = async (label: string, path: string, q: Record<string, string>) => {
  try { show(label, await binanceGet(path, q)); } catch (e) { show(`${label} FAILED`, (e as Error).message); }
};

await tryGet("price (all bStocks)", `${RWA}/price`, { binanceChainId: "56", tokenContractAddresses: Object.values(BSTOCKS).join(",") });
await tryGet("underlying-market NVDAB", `${RWA}/underlying-market`, { binanceChainId: "56", tokenContractAddress: BSTOCKS.NVDAB });
await tryGet("tokens bstock Upcoming Earnings (tabId=3)", `${RWA}/tokens`, { binanceChainId: "56", platformId: "bstock", tabId: "3" });
await tryGet("underlying-profile NVDAB", `${RWA}/underlying-profile`, { binanceChainId: "56", tokenContractAddress: BSTOCKS.NVDAB });
