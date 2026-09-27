// One Guard pass for one wallet and one stock: decide → plan → execute → record (PRD F3).
// All I/O is injected so the rules below are testable.
import type { Address } from "viem";
import type { Ticker } from "../core/config.ts";
import { execute } from "../core/executor.ts";
import { plan, type PlanContext } from "../core/plan.ts";
import type { Decision } from "../core/policy.ts";
import type { Position } from "../core/position.ts";
import type { Simulation } from "../core/simulate.ts";
import type { GuardEvent, Store } from "../core/store.ts";
import type { Call } from "../core/venus-tx.ts";
import type { Signer } from "../core/wallet.ts";

export interface GuardDeps {
  position: (a: Address, t: Ticker) => Promise<Position>;
  store: Pick<Store, "events" | "addEvent">;
  signerFor: (a: Address) => Promise<Signer | null>; // null = dry run
  simulate: (a: Address, calls: Call[]) => Promise<Simulation>;
  balances: (a: Address, t: Ticker) => Promise<PlanContext["startBalance"]>;
  balanceOf: (a: Address) => PlanContext["balanceOf"];
  now: () => Date;
}

const COOLDOWN_MS = 10 * 60_000; // let the chain and the prices settle before acting again
const PENDING_MS = 60 * 60_000; // an App confirmation the user ignores expires; then re-plan
const NOTIFY_REPEAT_MS = 60 * 60_000;

const DATA_GAP = "The agent couldn't read market data right now, so it took no action and will retry.";

export async function guardOnce(account: Address, ticker: Ticker, deps: GuardDeps): Promise<GuardEvent | null> {
  const now = deps.now();
  const recent = deps.store.events(account, 50);
  const last = recent.find((e) => e.ticker === ticker);
  const age = last ? +now - Date.parse(last.at) : Infinity;

  let p: Position;
  try {
    p = await deps.position(account, ticker);
  } catch (err) {
    // Record the gap (once an hour), instead of silently doing nothing while data is missing.
    if (last?.reason === DATA_GAP && age < NOTIFY_REPEAT_MS) return null;
    const e: GuardEvent = { at: now.toISOString(), account, ticker, kind: "notify", usd: null, status: "Careful", reason: DATA_GAP, outcome: "blocked", txHashes: [], simulated: false, error: (err as Error).message };
    deps.store.addEvent(e);
    return e;
  }
  const d = p.decision;
  if (d.action.kind === "hold") return null;

  // Debt is account-wide, so actions lock the account, not one stock. Heads-ups always get through
  // (deduped per stock), so a pending order never silences a worsening loan (review Important #7).
  if (d.action.kind === "notify") {
    const lastNotify = recent.find((e) => e.ticker === ticker && e.kind === "notify");
    if (lastNotify?.reason === d.reason && +now - Date.parse(lastNotify.at) < NOTIFY_REPEAT_MS) return null;
  } else {
    const lastAction = recent.find((e) => e.kind !== "notify");
    const actionAge = lastAction ? +now - Date.parse(lastAction.at) : Infinity;
    if (lastAction?.outcome === "pending" && actionAge < PENDING_MS) return null;
    if (actionAge < COOLDOWN_MS) return null;
  }

  const base = {
    at: now.toISOString(),
    account,
    ticker,
    kind: d.action.kind,
    usd: "usd" in d.action ? d.action.usd : null,
    status: d.status,
    reason: d.reason,
  };
  // The stored sentence must describe what actually happened (review Important #9).
  const record = (e: GuardEvent) => {
    const final = { ...e, reason: sentence(d, e) };
    deps.store.addEvent(final);
    return final;
  };

  const pl = plan(d, p.policy, {
    ticker,
    priceUsd: p.market.onchainUsd,
    collateralUsd: p.snapshot.collateralUsd,
    debtUsd: p.snapshot.debtUsd,
    collateralFactor: p.collateralFactor,
    startBalance: await deps.balances(account, ticker),
    balanceOf: deps.balanceOf(account),
  });
  if (pl && "usd" in pl && pl.usd !== undefined) base.usd = pl.usd; // e.g. the sell chunk
  if ("blocked" in pl) return record({ ...base, outcome: "blocked", txHashes: [], simulated: false, error: pl.blocked });
  if (!pl.steps.length) return record({ ...base, outcome: "done", txHashes: [], simulated: false }); // a heads-up

  const signer = await deps.signerFor(account);
  const r = await execute(account, pl.steps, { signer, simulate: deps.simulate });
  return record({ ...base, outcome: r.outcome, txHashes: r.txHashes, simulated: !signer, ...(r.error ? { error: r.error } : {}) });
}

const usd$ = (x: number | null) => `${(x ?? 0).toFixed(2)} USDT`;

function intent(kind: GuardEvent["kind"], usd: number | null): string {
  if (kind === "repay") return `repay ${usd$(usd)} from your safety buffer`;
  if (kind === "borrow") return `raise your credit line by ${usd$(usd)}`;
  if (kind === "sell") return `sell ${usd$(usd)} of stock`;
  return "act on your loan";
}

function sentence(d: Decision, e: GuardEvent): string {
  if (e.kind === "notify") return e.reason;
  const doing = intent(e.kind, e.usd);
  const because = d.cause ? ` because ${d.cause}` : "";
  switch (e.outcome) {
    case "done":
      return e.kind === "sell"
        ? `Sold ${usd$(e.usd)} of stock to keep your loan safe, as much as Venus releases at once; more follows if needed.`
        : e.reason;
    case "dry-run":
      return `Simulated only (signing is off): would ${doing}${because}.`;
    case "pending":
      return /Binance App/.test(e.error ?? "")
        ? `Waiting for you in the Binance App to ${doing}${because}.`
        : `Sent: ${doing}; waiting for the chain to confirm it.`;
    case "failed":
      return `Tried to ${doing}${because}, but it didn't go through. The agent will check again.`;
    case "blocked":
      return `Couldn't ${e.kind === "sell" ? "sell stock" : doing}: ${e.error ?? "not possible right now"}`;
  }
}
