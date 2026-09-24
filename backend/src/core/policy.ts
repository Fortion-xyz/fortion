// Guard policy engine (PRD §5.1 F3). Pure: snapshot in, one action out.

export type Mode = "cash" | "accumulate";
export type MarketStatus = "TRADING" | "MARKET_CLOSED" | "ASSET_PAUSED" | "ASSET_LIMITED";
export type Status = "Safe" | "Careful" | "Protecting";

export interface Policy {
  mode: Mode;
  keeperCanSell: boolean; // last-resort sell, default ON
  bufferBps: number; // share of each borrow kept as USDT buffer, default 1500
}

export interface Snapshot {
  collateralUsd: number; // conservative of Venus oracle vs RWA reference
  debtUsd: number;
  bufferUsd: number;
  market: MarketStatus;
  spread: number; // |on-chain − reference| / reference
  hoursToCorporateAction: number | null;
  minutesToWeekendClose: number | null; // set only on Fridays
}

export type Action =
  | { kind: "hold" }
  | { kind: "repay" | "borrow" | "sell"; usd: number }
  | { kind: "notify" };

export interface Decision {
  action: Action;
  ltv: number;
  targetLtv: number;
  status: Status;
  reason: string;
}

export const DEFAULT_POLICY: Policy = { mode: "cash", keeperCanSell: true, bufferBps: 1500 };

export const LTV = {
  normal: 0.35,
  overnight: 0.3,
  halt: 0.25,
  protect: 0.5,
  lastResort: 0.58,
  afterSell: 0.4,
  raiseGap: 0.05,
} as const;

const MIN_ACTION_USD = 1; // ponytail: ignore dust moves, gas costs more than they fix

export function ltvOf(s: Pick<Snapshot, "collateralUsd" | "debtUsd">): number {
  return s.collateralUsd > 0 ? s.debtUsd / s.collateralUsd : s.debtUsd > 0 ? Infinity : 0;
}

export function targetLtv(s: Snapshot): { target: number; canBorrow: boolean; why: string } {
  if (s.market === "ASSET_PAUSED" || s.market === "ASSET_LIMITED")
    return { target: LTV.halt, canBorrow: false, why: "the token is paused" };
  if (s.hoursToCorporateAction !== null && s.hoursToCorporateAction <= 24)
    return {
      target: LTV.halt,
      canBorrow: false,
      why: `a corporate action is in ${Math.round(s.hoursToCorporateAction)} hours and the token will be paused`,
    };
  if (s.spread > 0.02)
    return { target: LTV.overnight, canBorrow: false, why: "on-chain price is more than 2% off the reference" };
  if (s.market === "MARKET_CLOSED")
    return { target: LTV.overnight, canBorrow: false, why: "the stock market is closed" };
  if (s.minutesToWeekendClose !== null && s.minutesToWeekendClose <= 30)
    return { target: LTV.overnight, canBorrow: false, why: "the market closes for the weekend soon" };
  // ponytail: PRD only defines ≤0.5% as "normal"; 0.5–2% keeps the normal target but blocks new borrows.
  return { target: LTV.normal, canBorrow: s.spread <= 0.005, why: "regular trading session" };
}

export function decide(s: Snapshot, p: Policy = DEFAULT_POLICY): Decision {
  const ltv = ltvOf(s);
  const { target, canBorrow, why } = targetLtv(s);
  const halted = s.market === "ASSET_PAUSED" || s.market === "ASSET_LIMITED";
  const out = (action: Action, status: Status, reason: string): Decision => ({
    action,
    ltv,
    targetLtv: target,
    status,
    reason,
  });
  const repayToTarget = Math.max(0, s.debtUsd - target * s.collateralUsd);

  // Buffer is spent first; only once it is empty does the last-resort sell kick in.
  if (ltv >= LTV.lastResort && s.bufferUsd < MIN_ACTION_USD) {
    if (!p.keeperCanSell || halted)
      return out({ kind: "notify" }, "Protecting", `Loan at ${pct(ltv)}, buffer empty and ${halted ? "the token is paused" : "selling is turned off"}. Add USDT or repay now.`);
    // Sell X of collateral and repay X: (D − X) / (C − X) = afterSell.
    const usd = (s.debtUsd - LTV.afterSell * s.collateralUsd) / (1 - LTV.afterSell);
    return out({ kind: "sell", usd }, "Protecting", `Sold ${usd$(usd)} of stock to bring the loan from ${pct(ltv)} to ${pct(LTV.afterSell)}; a Venus liquidation would sell more with a 10% penalty.`);
  }

  if (ltv >= LTV.protect || ltv > target) {
    const usd = Math.min(repayToTarget, s.bufferUsd);
    if (usd >= MIN_ACTION_USD)
      return out({ kind: "repay", usd }, "Protecting", `Repaid ${usd$(usd)} from the safety buffer because ${why}.`);
    return out({ kind: "notify" }, ltv >= LTV.protect ? "Protecting" : "Careful", `Loan at ${pct(ltv)} is above the ${pct(target)} target and the buffer cannot cover it. Add USDT or repay.`);
  }

  if (canBorrow && ltv < target - LTV.raiseGap) {
    const usd = target * s.collateralUsd - s.debtUsd;
    if (usd >= MIN_ACTION_USD) {
      const where = p.mode === "cash" ? "available to draw" : "used to buy more stock";
      return out({ kind: "borrow", usd }, "Safe", `Credit line raised by ${usd$(usd)}, ${where}, because the stock rose.`);
    }
  }

  return out({ kind: "hold" }, "Safe", `Holding at ${pct(ltv)}; target is ${pct(target)} because ${why}.`);
}

/** Extra USDT the user can draw right now without crossing the target. */
export function availableCash(s: Snapshot): number {
  const { target, canBorrow } = targetLtv(s);
  return canBorrow ? Math.max(0, target * s.collateralUsd - s.debtUsd) : 0;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const usd$ = (x: number) => `${x.toFixed(2)} USDT`;
