// Guard decision → Venus calls the keeper would sign. Pure.
import { parseEther } from "viem";
import type { Decision, Policy } from "./policy.ts";
import { borrowUsdt, repayUsdt, type Call } from "./venus-tx.ts";

export type Plan = { calls: Call[] } | { blocked: string };

// ponytail: 1 USD of debt = 1 USDT; USDT's oracle price sits within ~0.1% of $1 and the target has slack.
const usdt = (usd: number) => parseEther(usd.toFixed(6));

export function plan(d: Decision, policy: Policy): Plan {
  const a = d.action;
  switch (a.kind) {
    case "hold":
    case "notify":
      return { calls: [] };
    case "repay":
      return { calls: repayUsdt(usdt(a.usd)) };
    case "borrow":
      if (policy.mode === "accumulate") return { blocked: "Accumulate mode needs the Trading API swap (USDT → bStock)" };
      return { calls: [borrowUsdt(usdt(a.usd))] };
    case "sell":
      return { blocked: "Last-resort sell needs the Trading API swap (bStock → USDT)" };
  }
}
