// Guard policy engine (PRD §5.1 F3). Pure: snapshot in, one action out.

export type Mode = "cash" | "accumulate";
export type MarketStatus = "TRADING" | "MARKET_CLOSED" | "ASSET_PAUSED" | "ASSET_LIMITED";
export type Status = "Safe" | "Careful" | "Protecting";

export type RiskProfile = "conservative" | "balanced" | "growth";

export interface Policy {
  mode: Mode;
  profile: RiskProfile; // user-chosen; see PROFILES
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
  liquidationThreshold: number; // Venus LT of the collateral market, read on-chain
}

export type Action =
  | { kind: "hold" }
  | { kind: "repay" | "borrow" | "sell"; usd: number }
  | { kind: "notify" };

export interface Decision {
  action: Action;
  ltv: number;
  targetLtv: number;
  thresholds: Thresholds;
  status: Status;
  reason: string;
}

export const DEFAULT_POLICY: Policy = { mode: "cash", profile: "balanced", keeperCanSell: true, bufferBps: 1500 };

export interface Thresholds {
  normal: number; // target in a regular session
  overnight: number; // market closed, weekend close near, or price spread > 2%
  halt: number; // paused, or corporate action within 24h
  protect: number; // repay from buffer at or above this
  lastResort: number; // sell stock at or above this once the buffer is empty
  afterSell: number; // sell just enough to land here
}

// Written for a stock with a 70% liquidation threshold (NVDAB, TSLAB). "balanced" = PRD §5.1 F3.
const BASE_LT = 0.7;
export const PROFILES: Record<RiskProfile, Thresholds> = {
  conservative: { normal: 0.25, overnight: 0.2, halt: 0.15, protect: 0.4, lastResort: 0.5, afterSell: 0.3 },
  balanced: { normal: 0.35, overnight: 0.3, halt: 0.25, protect: 0.5, lastResort: 0.58, afterSell: 0.4 },
  growth: { normal: 0.45, overnight: 0.38, halt: 0.3, protect: 0.55, lastResort: 0.6, afterSell: 0.45 },
};
const RAISE_GAP = 0.05; // borrow more only once LTV is this far below target

/** Profile thresholds scaled to the market's LT, so a riskier stock (e.g. SPCXB, LT 65%) is held lower. */
export function thresholds(profile: RiskProfile, liquidationThreshold: number): Thresholds {
  const k = liquidationThreshold / BASE_LT;
  const t = PROFILES[profile];
  return Object.fromEntries(Object.entries(t).map(([key, v]) => [key, v * k])) as unknown as Thresholds;
}

const MIN_ACTION_USD = 1; // ponytail: ignore dust moves, gas costs more than they fix

export function ltvOf(s: Pick<Snapshot, "collateralUsd" | "debtUsd">): number {
  return s.collateralUsd > 0 ? s.debtUsd / s.collateralUsd : s.debtUsd > 0 ? Infinity : 0;
}

export function targetLtv(s: Snapshot, profile: RiskProfile): { target: number; canBorrow: boolean; why: string } {
  const t = thresholds(profile, s.liquidationThreshold);
  if (s.market === "ASSET_PAUSED" || s.market === "ASSET_LIMITED")
    return { target: t.halt, canBorrow: false, why: "the token is paused" };
  if (s.hoursToCorporateAction !== null && s.hoursToCorporateAction <= 24)
    return {
      target: t.halt,
      canBorrow: false,
      why: `a corporate action is in ${Math.round(s.hoursToCorporateAction)} hours and the token will be paused`,
    };
  if (s.spread > 0.02)
    return { target: t.overnight, canBorrow: false, why: "on-chain price is more than 2% off the reference" };
  if (s.market === "MARKET_CLOSED")
    return { target: t.overnight, canBorrow: false, why: "the stock market is closed" };
  if (s.minutesToWeekendClose !== null && s.minutesToWeekendClose <= 30)
    return { target: t.overnight, canBorrow: false, why: "the market closes for the weekend soon" };
  // ponytail: PRD only defines ≤0.5% as "normal"; 0.5–2% keeps the normal target but blocks new borrows.
  return { target: t.normal, canBorrow: s.spread <= 0.005, why: "regular trading session" };
}

export function decide(s: Snapshot, p: Policy = DEFAULT_POLICY): Decision {
  const ltv = ltvOf(s);
  const t = thresholds(p.profile, s.liquidationThreshold);
  const { target, canBorrow, why } = targetLtv(s, p.profile);
  const halted = s.market === "ASSET_PAUSED" || s.market === "ASSET_LIMITED";
  const out = (action: Action, status: Status, reason: string): Decision => ({
    action,
    ltv,
    targetLtv: target,
    thresholds: t,
    status,
    reason,
  });
  const repayToTarget = Math.max(0, s.debtUsd - target * s.collateralUsd);

  // Buffer is spent first; only once it is empty does the last-resort sell kick in.
  if (ltv >= t.lastResort && s.bufferUsd < MIN_ACTION_USD) {
    if (!p.keeperCanSell || halted)
      return out({ kind: "notify" }, "Protecting", `Loan at ${pct(ltv)}, buffer empty and ${halted ? "the token is paused" : "selling is turned off"}. Add USDT or repay now.`);
    // Sell X of collateral and repay X: (D − X) / (C − X) = afterSell.
    const usd = (s.debtUsd - t.afterSell * s.collateralUsd) / (1 - t.afterSell);
    return out({ kind: "sell", usd }, "Protecting", `Sold ${usd$(usd)} of stock to bring the loan from ${pct(ltv)} to ${pct(t.afterSell)}; a Venus liquidation would sell more with a 10% penalty.`);
  }

  if (ltv >= t.protect || ltv > target) {
    const usd = Math.min(repayToTarget, s.bufferUsd);
    if (usd >= MIN_ACTION_USD)
      return out({ kind: "repay", usd }, "Protecting", `Repaid ${usd$(usd)} from the safety buffer because ${why}.`);
    return out({ kind: "notify" }, ltv >= t.protect ? "Protecting" : "Careful", `Loan at ${pct(ltv)} is above the ${pct(target)} target and the buffer cannot cover it. Add USDT or repay.`);
  }

  if (canBorrow && ltv < target - RAISE_GAP) {
    const usd = target * s.collateralUsd - s.debtUsd;
    if (usd >= MIN_ACTION_USD) {
      const where = p.mode === "cash" ? "available to draw" : "used to buy more stock";
      return out({ kind: "borrow", usd }, "Safe", `Credit line raised by ${usd$(usd)}, ${where}, because the stock rose.`);
    }
  }

  return out({ kind: "hold" }, "Safe", `Holding at ${pct(ltv)}; target is ${pct(target)} because ${why}.`);
}

/** Extra USDT the user can draw right now without crossing the target. */
export function availableCash(s: Snapshot, profile: RiskProfile): number {
  const { target, canBorrow } = targetLtv(s, profile);
  return canBorrow ? Math.max(0, target * s.collateralUsd - s.debtUsd) : 0;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const usd$ = (x: number) => `${x.toFixed(2)} USDT`;
