// Plain-language risk narrative for agents and power users (PRD Flow D, MCP explain_risk).
// Agent-facing, so LTV numbers are allowed here; the app shows decision.reason instead.
import type { Position } from "./position.ts";

export function explain({ snapshot: s, decision: d, market: m, policy }: Position): string {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  // Drop that pushes LTV to the last-resort line, after the buffer is spent on repay.
  const debtAfterBuffer = s.debtUsd - s.bufferUsd;
  const cushion = debtAfterBuffer <= 0 ? 1 : 1 - debtAfterBuffer / (d.thresholds.lastResort * s.collateralUsd);
  const next =
    s.hoursToCorporateAction !== null ? `corporate action in ${Math.round(s.hoursToCorporateAction)}h` :
    s.minutesToWeekendClose !== null ? `weekend close in ${s.minutesToWeekendClose} min` : `market is ${m.status}`;
  const earnings = m.nextEarnings
    ? ` Next earnings: ${m.nextEarnings.at.toISOString().slice(0, 10)} (${m.nextEarnings.confirmed ? "confirmed" : "estimate, not acted on yet"}).`
    : "";
  return `LTV ${pct(d.ltv)}, target ${pct(d.targetLtv)} (${policy.profile} profile), status ${d.status}. ` +
    `Buffer covers a ${pct(Math.max(0, cushion))} drop before any share would be sold. Next risk event: ${next}.${earnings}`;
}

