import { z } from "zod";

const env = z
  .object({
    BSC_RPC_URL: z.url().default("https://bsc-dataseed.bnbchain.org"),
    PORT: z.coerce.number().default(4000),
    BINANCE_WEB3_API_URL: z.url().optional(),
    BINANCE_WEB3_API_KEY: z.string().optional(),
    WATCH_ADDRESSES: z.string().default(""),
  })
  .parse(process.env);

export const config = {
  rpcUrl: env.BSC_RPC_URL,
  port: env.PORT,
  binance: { url: env.BINANCE_WEB3_API_URL, key: env.BINANCE_WEB3_API_KEY },
  watch: env.WATCH_ADDRESSES.split(",").map((a) => a.trim()).filter(Boolean),
};

// Venus Core Pool, BSC mainnet. Verified 25 Sep 2026 via scripts/venus-markets.ts.
export const VENUS = {
  comptroller: "0xfD36E2c2a6789Db23113685031d7F16329158384",
  vUSDT: "0xfD5840Cd36d94D7229439859C0112a4185BC0255",
  vTokens: {
    NVDAB: "0xEb8Ca841cBe1BC4832A10b15c7dAB1081eDaD371",
    TSLAB: "0x97421799419Eb782628e73e7220d8E0A207469a3",
    SPCXB: "0xC36dFaCc7a125859C106F29b9F2d874CCF29A55A",
  },
} as const;

export type Ticker = keyof typeof VENUS.vTokens;
export const TICKERS = Object.keys(VENUS.vTokens) as Ticker[];
