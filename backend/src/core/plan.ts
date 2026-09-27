// Guard decision → the steps the keeper signs. Pure: I/O comes in through `ctx`.
import { formatUnits, parseEther, parseUnits, type Address } from "viem";
import { BSTOCKS, USDT, type Ticker } from "./config.ts";
import type { Step } from "./executor.ts";
import type { Decision, Policy } from "./policy.ts";
import { borrowUsdt, repayUsdt, supply, withdraw } from "./venus-tx.ts";

export type Plan = { steps: Step[]; usd?: number } | { blocked: string }; // usd: amount actually acted on, if less than asked

export interface PlanContext {
  ticker: Ticker;
  priceUsd: number; // token price, for converting USD to stock quantity
  collateralUsd: number;
  debtUsd: number;
  collateralFactor: number; // Venus lets collateral leave only while debt stays under this
  /** Wallet balances right before execution; lazy steps act on what changed since. */
  startBalance: { stock: bigint; usdt: bigint };
  balanceOf: (token: Address) => Promise<bigint>;
}

// ponytail: 1 USD of debt = 1 USDT; USDT's oracle price sits within ~0.1% of $1 and the target has slack.
const usdt = (usd: number) => parseEther(usd.toFixed(6));
const WITHDRAW_MARGIN = 0.9; // never withdraw right up to the collateral-factor edge

/** USDT to spend on stock in accumulate mode: the borrow minus the safety buffer, rounded DOWN to cents. */
const buyQty = (borrowedUsd: number, bufferBps: number) =>
  (Math.floor(borrowedUsd * (1 - bufferBps / 10_000) * 100) / 100).toFixed(2);

export function plan(d: Decision, policy: Policy, ctx: PlanContext): Plan {
  const a = d.action;
  const stock = BSTOCKS[ctx.ticker];
  switch (a.kind) {
    case "hold":
    case "notify":
      return { steps: [] };

    case "repay":
      return { steps: repayUsdt(usdt(a.usd)).map((call) => ({ kind: "call", call })) };

    case "borrow": {
      const borrow: Step = { kind: "call", call: borrowUsdt(usdt(a.usd)) };
      if (policy.mode === "cash") return { steps: [borrow] };
      // Accumulate: the loan buys more of the same stock, which goes back in as collateral.
      return {
        steps: [
          borrow,
          { kind: "swap", swap: { fromToken: USDT, toToken: stock, qty: buyQty(a.usd, policy.bufferBps), label: `buy ${ctx.ticker}` } },
          {
            kind: "lazy",
            label: `supply the ${ctx.ticker} just bought`,
            build: async () => {
              const bought = (await ctx.balanceOf(stock)) - ctx.startBalance.stock;
              return bought > 0n ? supply(ctx.ticker, bought) : [];
            },
          },
        ],
      };
    }

    case "sell": {
      // Venus only releases collateral while the remaining loan stays under the collateral factor,
      // so a deep sell happens in chunks: one safe chunk per Guard tick, re-planned from chain state.
      const room = ctx.collateralUsd - ctx.debtUsd / ctx.collateralFactor;
      const chunkUsd = Math.round(Math.min(a.usd, room * WITHDRAW_MARGIN) * 1e6) / 1e6; // no float noise in the log
      if (!(chunkUsd >= 1)) return { blocked: "Venus won't let any stock be withdrawn safely right now; the buffer or a manual repay has to help." };
      const qty = parseUnits((chunkUsd / ctx.priceUsd).toFixed(18), 18);
      return {
        usd: chunkUsd,
        steps: [
          { kind: "call", call: withdraw(ctx.ticker, qty) },
          { kind: "swap", swap: { fromToken: stock, toToken: USDT, qty: formatUnits(qty, 18), label: `sell ${ctx.ticker}` } },
          {
            kind: "lazy",
            label: "repay with the sale proceeds",
            build: async () => {
              const proceeds = (await ctx.balanceOf(USDT)) - ctx.startBalance.usdt;
              return proceeds > 0n ? repayUsdt(proceeds) : [];
            },
          },
        ],
      };
    }
  }
}
