// Read-only Venus position (PRD §7, direct ABI calls). Writes come with the Wallet Skill.
import { createPublicClient, decodeAbiParameters, encodeFunctionData, formatUnits, http, parseAbi, type Address } from "viem";
import { bsc } from "viem/chains";
import { config, USDT, VENUS, type Ticker } from "./config.ts";

export const client = createPublicClient({ chain: bsc, transport: http(config.rpcUrl) });

const vTokenAbi = parseAbi([
  "function getAccountSnapshot(address) view returns (uint256 err, uint256 vBalance, uint256 borrowBalance, uint256 exchangeRate)",
]);
const comptrollerAbi = parseAbi(["function oracle() view returns (address)", "function markets(address) view returns (bool)"]);
const oracleAbi = parseAbi(["function getUnderlyingPrice(address vToken) view returns (uint256)"]);

let oracle: Address | undefined;
async function price(vToken: Address): Promise<bigint> {
  oracle ??= await client.readContract({ address: VENUS.comptroller, abi: comptrollerAbi, functionName: "oracle" });
  return client.readContract({ address: oracle, abi: oracleAbi, functionName: "getUnderlyingPrice", args: [vToken] });
}

async function snapshot(vToken: Address, account: Address) {
  const [err, vBalance, borrow, rate] = await client.readContract({
    address: vToken,
    abi: vTokenAbi,
    functionName: "getAccountSnapshot",
    args: [account],
  });
  if (err !== 0n) throw new Error(`Venus getAccountSnapshot error ${err} on ${vToken}`);
  return { vBalance, borrow, rate };
}

/** Collateral factor (borrow limit) and liquidation threshold, both 0..1. */
export async function riskParams(vToken: Address) {
  // markets() grew extra return fields across Comptroller versions; decode by position.
  const { data } = await client.call({
    to: VENUS.comptroller,
    data: encodeFunctionData({ abi: comptrollerAbi, functionName: "markets", args: [vToken] }),
  });
  const [, cf, , lt] = decodeAbiParameters(
    [{ type: "bool" }, { type: "uint256" }, { type: "bool" }, { type: "uint256" }],
    data!,
  );
  return { collateralFactor: num(cf, 18), liquidationThreshold: num(lt, 18) };
}

// Venus prices are scaled 1e(36 − decimals), so these formulas are decimals-agnostic.
const num = (x: bigint, decimals: number) => Number(formatUnits(x, decimals));

export async function readVenusPosition(account: Address, ticker: Ticker) {
  const vToken = VENUS.vTokens[ticker];
  const [coll, debt, collPrice, usdtPrice, risk] = await Promise.all([
    snapshot(vToken, account),
    snapshot(VENUS.vUSDT, account),
    price(vToken),
    price(VENUS.vUSDT),
    riskParams(vToken),
  ]);
  return {
    ...risk,
    collateralUsd: num(coll.vBalance * coll.rate * collPrice, 54),
    debtUsd: num(debt.borrow * usdtPrice, 36),
  };
}

const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export async function usdtBalance(account: Address): Promise<number> {
  return num(await client.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [account] }), 18);
}
