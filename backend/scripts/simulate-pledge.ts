// Dry-run Flow A (PRD §8) against live BSC mainnet state, zero funds needed:
// a fresh address gets a fake bStock balance via state override, then approve → mint →
// enterMarkets → borrow USDT run in one eth_simulateV1 block.
// Usage: npx tsx scripts/simulate-pledge.ts [TICKER] [amount] [ltv]
import { encodeAbiParameters, encodeFunctionData, formatUnits, keccak256, parseAbi, parseEther, type Address, type Hex } from "viem";
import { BSTOCKS, TICKERS, USDT, VENUS, type Ticker } from "../src/core/config.ts";
import { client } from "../src/core/venus.ts";
import { callError, pledge, type Call } from "../src/core/venus-tx.ts";

const ticker = (process.argv[2] ?? "NVDAB").toUpperCase() as Ticker;
if (!TICKERS.includes(ticker)) throw new Error(`ticker must be one of ${TICKERS.join(", ")}`);
const amount = parseEther(process.argv[3] ?? "1");
const ltv = Number(process.argv[4] ?? "0.35");
const account: Address = "0x00000000000000000000000000000000f0271011";

const reads = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function oracle() view returns (address)",
  "function getUnderlyingPrice(address) view returns (uint256)",
  "function getAccountLiquidity(address) view returns (uint256 err, uint256 liquidity, uint256 shortfall)",
  "function borrowBalanceStored(address) view returns (uint256)",
]);

// Balance mapping slot: plain layouts use slot 0..20, OZ upgradeable uses the ERC-7201 namespace.
const ERC7201_ERC20 = 0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00n;
async function balanceSlot(token: Address): Promise<Hex> {
  for (const slot of [...Array.from({ length: 21 }, (_, i) => BigInt(i)), ERC7201_ERC20]) {
    const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [account, slot]));
    const bal = await client.readContract({
      address: token, abi: reads, functionName: "balanceOf", args: [account],
      stateOverride: [{ address: token, stateDiff: [{ slot: key, value: `0x${amount.toString(16).padStart(64, "0")}` }] }],
    });
    if (bal === amount) return key;
  }
  throw new Error(`balance slot not found for ${token}`);
}

const token = BSTOCKS[ticker];
const vToken = VENUS.vTokens[ticker];
const oracle = await client.readContract({ address: VENUS.comptroller, abi: reads, functionName: "oracle" });
const price = await client.readContract({ address: oracle, abi: reads, functionName: "getUnderlyingPrice", args: [vToken] });
const collateralUsd = Number(formatUnits(amount * price, 36));
const borrow = parseEther((collateralUsd * ltv).toFixed(6));
const slot = await balanceSlot(token);

const read = (to: Address, functionName: "getAccountLiquidity" | "borrowBalanceStored" | "balanceOf", label: string): Call =>
  ({ to, label, data: encodeFunctionData({ abi: reads, functionName, args: [account] }) });
const calls = [
  ...pledge(ticker, amount, borrow),
  read(VENUS.comptroller, "getAccountLiquidity", "account liquidity"),
  read(VENUS.vUSDT, "borrowBalanceStored", "USDT debt"),
  read(USDT, "balanceOf", "USDT in wallet"),
];

console.log(`${ticker}: supply ${process.argv[3] ?? "1"} (~$${collateralUsd.toFixed(2)}), borrow ${(collateralUsd * ltv).toFixed(2)} USDT (${ltv * 100}% LTV)\n`);
const { results } = await client.simulateCalls({
  account,
  calls: calls.map(({ to, data }) => ({ to, data })),
  stateOverrides: [
    { address: token, stateDiff: [{ slot, value: `0x${amount.toString(16).padStart(64, "0")}` }] },
    { address: account, balance: parseEther("1") }, // gas
  ],
});

let ok = true;
results.forEach((r, i) => {
  const c = calls[i]!;
  if (r.status !== "success") return (ok = false), console.log(`✖ ${c.label}: reverted ${r.error?.message.split("\n")[0]}`);
  if (i < calls.length - 3) {
    const err = callError(c, r.data);
    if (err) ok = false;
    return console.log(err ? `✖ ${err}` : `✔ ${c.label}`);
  }
  const words = (r.data.slice(2).match(/.{64}/g) ?? []).map((w) => (Number(BigInt(`0x${w}`)) / 1e18).toFixed(2));
  console.log(`  ${c.label}: ${words.join(" / ")}`);
});
console.log(ok ? "\nGO: USDT can be borrowed against this bStock." : "\nNO-GO: see failures above.");
process.exitCode = ok ? 0 : 1;
