// One Guard pass for one wallet and one stock: decide → plan → execute → record (PRD F3).
// All I/O is injected so the rules below are testable.
import type { Address } from "viem";
import type { Ticker } from "../core/config.ts";
import { execute } from "../core/executor.ts";
import { plan, type PlanContext } from "../core/plan.ts";
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

export async function guardOnce(account: Address, ticker: Ticker, deps: GuardDeps): Promise<GuardEvent | null> {
  const p = await deps.position(account, ticker);
  const d = p.decision;
  if (d.action.kind === "hold") return null;

  const now = deps.now();
  const last = deps.store.events(account, 50).find((e) => e.ticker === ticker);
  const age = last ? +now - Date.parse(last.at) : Infinity;
  if (last?.outcome === "pending" && age < PENDING_MS) return null;
  if (d.action.kind === "notify") {
    if (last?.kind === "notify" && last.reason === d.reason && age < NOTIFY_REPEAT_MS) return null;
  } else if (last && last.kind !== "notify" && age < COOLDOWN_MS) return null;

  const base = {
    at: now.toISOString(),
    account,
    ticker,
    kind: d.action.kind,
    usd: "usd" in d.action ? d.action.usd : null,
    status: d.status,
    reason: d.reason,
  };
  const record = (e: GuardEvent) => (deps.store.addEvent(e), e);

  const pl = plan(d, p.policy, {
    ticker,
    priceUsd: p.market.onchainUsd,
    collateralUsd: p.snapshot.collateralUsd,
    debtUsd: p.snapshot.debtUsd,
    collateralFactor: p.collateralFactor,
    startBalance: await deps.balances(account, ticker),
    balanceOf: deps.balanceOf(account),
  });
  if ("blocked" in pl) return record({ ...base, outcome: "blocked", txHashes: [], simulated: false, error: pl.blocked });
  if (!pl.steps.length) return record({ ...base, outcome: "done", txHashes: [], simulated: false }); // a heads-up

  const signer = await deps.signerFor(account);
  const r = await execute(account, pl.steps, { signer, simulate: deps.simulate });
  return record({ ...base, outcome: r.outcome, txHashes: r.txHashes, simulated: !signer, ...(r.error ? { error: r.error } : {}) });
}
