// Day-1 check (PRD §11): list Venus Core Pool markets relevant to Fortion.
import { parseAbi } from "viem";
import { client } from "../src/core/venus.ts";
import { VENUS } from "../src/core/config.ts";
const abi = parseAbi(["function getAllMarkets() view returns (address[])","function symbol() view returns (string)","function underlying() view returns (address)","function oracle() view returns (address)"]);
const markets = await client.readContract({ address: VENUS.comptroller, abi, functionName: "getAllMarkets" });
console.log("oracle", await client.readContract({ address: VENUS.comptroller, abi, functionName: "oracle" }));
const syms = await Promise.all(markets.map(m => client.readContract({ address: m, abi, functionName: "symbol" }).catch(() => "?")));
markets.forEach((m, i) => { if (/USDT|NVDA|TSLA|SPCX|B$/i.test(syms[i]!)) console.log(syms[i], m); });
