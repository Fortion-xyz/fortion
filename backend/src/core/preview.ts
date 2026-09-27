// Previews for the app's Get cash / draw / repay flows (PRD F2, Flow A; issue #18).
// Everything is simulated against live mainnet state; nothing is signed here.
import { formatUnits, parseAbi, parseUnits, type Address } from "viem";
import { BSTOCKS, type Ticker } from "./config.ts";
import { availableCash } from "./policy.ts";
import { conservativeCollateral, getPosition, InputError } from "./position.ts";
import { simulate, type Simulation } from "./simulate.ts";
import { client } from "./venus.ts";
import { borrowUsdt, pledge, REPAY_ALL, repayUsdt, type Call } from "./venus-tx.ts";

/** Split a draw into spendable cash and the safety buffer that stays in the wallet. */
export function quoteDraw(maxBorrow: number, bufferBps: number, cash?: number) {
  const keep = 1 - bufferBps / 10_000;
  const maxCash = Math.max(0, maxBorrow) * keep;
  const want = cash ?? maxCash;
  if (cash !== undefined && !(cash > 0)) throw new InputError("Choose an amount more than zero.");
  if (want > maxCash + 1e-9) throw new InputError(`You can take up to ${maxCash.toFixed(2)} USDT today.`);
  const borrow = keep > 0 ? want / keep : 0;
  return { maxCash, cash: want, borrow, safetyBuffer: borrow - want };
}

export function pledgeShortfall(have: bigint, want: bigint, ticker: Ticker): string | null {
  return have >= want ? null : `Your wallet holds ${formatUnits(have, 18)} ${ticker}, so ${formatUnits(want, 18)} can't be pledged.`;
}

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const usdt = (x: number) => parseUnits(x.toFixed(6), 18);

async function withSimulation<T extends object>(account: Address, calls: Call[], body: T) {
  const simulation: Simulation = calls.length ? await simulate(account, calls) : { ok: true, steps: [] };
  return { ...body, steps: calls.map((c) => c.label), calls, simulation };
}

/** Pledge `amount` bStock (decimal string, e.g. "0.5") and optionally draw `cash` spendable USDT. */
export async function previewPledge(account: Address, ticker: Ticker, amount: string, cash?: number) {
  let tokens: bigint;
  try {
    tokens = parseUnits(amount, 18);
  } catch {
    throw new InputError(`"${amount}" is not an amount of stock.`);
  }
  if (tokens <= 0n) throw new InputError("Choose an amount of stock more than zero.");
  const [p, have] = await Promise.all([
    getPosition(account, ticker),
    client.readContract({ address: BSTOCKS[ticker], abi: erc20, functionName: "balanceOf", args: [account] }),
  ]);
  const short = pledgeShortfall(have, tokens, ticker);
  if (short) throw new InputError(short);
  const addUsd = conservativeCollateral(Number(formatUnits(tokens, 18)) * p.market.onchainUsd, p.market);
  const after = { ...p.snapshot, collateralUsd: p.snapshot.collateralUsd + addUsd };
  const q = quoteDraw(availableCash(after, p.policy.profile), p.policy.bufferBps, cash);
  const calls = pledge(ticker, tokens, usdt(q.borrow));
  return withSimulation(account, q.borrow > 0 ? calls : calls.slice(0, -1), {
    ticker,
    stockValueAfter: after.collateralUsd,
    ...q,
  });
}

export async function previewDraw(account: Address, ticker: Ticker, cash?: number) {
  const p = await getPosition(account, ticker);
  const q = quoteDraw(p.availableCash, p.policy.bufferBps, cash);
  return withSimulation(account, q.borrow > 0 ? [borrowUsdt(usdt(q.borrow))] : [], { ticker, ...q });
}

/** Repay `usdtAmount` USDT, or everything owed when "all". */
export async function previewRepay(account: Address, ticker: Ticker, usdtAmount: number | "all") {
  if (usdtAmount !== "all" && !(usdtAmount > 0)) throw new InputError("Choose an amount more than zero.");
  const p = await getPosition(account, ticker);
  if (p.snapshot.debtUsd <= 0) throw new InputError("Nothing to repay: there is no loan on this stock.");
  const repaid = usdtAmount === "all" ? p.snapshot.debtUsd : Math.min(usdtAmount, p.snapshot.debtUsd);
  // Repay-all: pull the exact debt at execution time, approve debt + 0.1% + 0.01 for accrued interest.
  const calls = usdtAmount === "all" ? repayUsdt(REPAY_ALL, usdt(repaid * 1.001 + 0.01)) : repayUsdt(usdt(usdtAmount));
  return withSimulation(account, calls, { ticker, repay: repaid, debtAfter: p.snapshot.debtUsd - repaid });
}
