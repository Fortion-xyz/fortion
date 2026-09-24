// Day-1 go/no-go (PRD §11, §13): are the bStock markets usable as collateral for a USDT loan?
import { decodeAbiParameters, encodeFunctionData, formatUnits, parseAbi, type Address } from "viem";
import { VENUS } from "../src/core/config.ts";
import { client } from "../src/core/venus.ts";

const abi = parseAbi([
  "function markets(address) view returns (bool)",
  "function supplyCaps(address) view returns (uint256)",
  "function borrowCaps(address) view returns (uint256)",
  "function actionPaused(address, uint8) view returns (bool)",
  "function oracle() view returns (address)",
  "function getUnderlyingPrice(address) view returns (uint256)",
  "function underlying() view returns (address)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
]);
const ACTION = { MINT: 0, BORROW: 2, REPAY: 3, ENTER_MARKET: 7 } as const;

const read = <T,>(address: Address, functionName: string, args: unknown[] = []) =>
  client.readContract({ address, abi, functionName, args } as never) as Promise<T>;

// markets() return shape differs across Comptroller versions; decode the first words only.
async function marketParams(vToken: Address) {
  const { data } = await client.call({
    to: VENUS.comptroller,
    data: encodeFunctionData({ abi, functionName: "markets", args: [vToken] }),
  });
  const words = (data!.length - 2) / 64;
  const [listed, cf, , lt] = decodeAbiParameters(
    [{ type: "bool" }, { type: "uint256" }, { type: "bool" }, { type: "uint256" }].slice(0, words),
    data!,
  ) as [boolean, bigint, boolean?, bigint?];
  return { listed, cf: formatUnits(cf, 18), lt: lt !== undefined ? formatUnits(lt, 18) : "n/a" };
}

const oracle = await read<Address>(VENUS.comptroller, "oracle");

for (const [ticker, vToken] of [...Object.entries(VENUS.vTokens), ["USDT", VENUS.vUSDT] as const]) {
  const underlying = await read<Address>(vToken, "underlying");
  const [dec, sym, supplyCap, borrowCap, totalSupply, totalBorrows, rate, price, params, ...paused] = await Promise.all([
    read<number>(underlying, "decimals"),
    read<string>(underlying, "symbol"),
    read<bigint>(VENUS.comptroller, "supplyCaps", [vToken]),
    read<bigint>(VENUS.comptroller, "borrowCaps", [vToken]),
    read<bigint>(vToken, "totalSupply"),
    read<bigint>(vToken, "totalBorrows"),
    read<bigint>(vToken, "exchangeRateStored"),
    read<bigint>(oracle, "getUnderlyingPrice", [vToken]),
    marketParams(vToken),
    ...Object.values(ACTION).map((a) => read<boolean>(VENUS.comptroller, "actionPaused", [vToken, a])),
  ]);
  const supplied = (totalSupply * rate) / 10n ** 18n;
  const fmt = (x: bigint) => Number(formatUnits(x, dec)).toLocaleString("en-US", { maximumFractionDigits: 4 });
  console.log(`\n${ticker} (${sym}, ${dec} dec) underlying ${underlying}`);
  console.log(`  listed=${params.listed} CF=${params.cf} LT=${params.lt} price=$${formatUnits(price, 36 - dec)}`);
  console.log(`  supplied ${fmt(supplied)} / cap ${fmt(supplyCap)} → room ${fmt(supplyCap > supplied ? supplyCap - supplied : 0n)}`);
  console.log(`  borrowed ${fmt(totalBorrows)} / borrowCap ${fmt(borrowCap)}`);
  console.log(`  paused: ${Object.keys(ACTION).map((k, i) => `${k}=${paused[i]}`).join(" ")}`);
}
