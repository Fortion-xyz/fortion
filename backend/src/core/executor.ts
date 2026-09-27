// Runs a plan one step at a time: simulate → sign → wait for the chain → next.
// Stops at the first step that doesn't land; the next Guard tick re-plans from real on-chain state,
// so a half-done plan is never retried blindly.
import type { Address, Hex } from "viem";
import type { Simulation } from "./simulate.ts";
import type { Call } from "./venus-tx.ts";
import type { SendResult, Signer, Swap } from "./wallet.ts";

export type Step =
  | { kind: "call"; call: Call }
  | { kind: "swap"; swap: Swap }
  // Built at execution time from what earlier steps produced (e.g. repay exactly the swap proceeds).
  | { kind: "lazy"; label: string; build: () => Promise<Call[]> };

export interface Execution {
  outcome: "done" | "pending" | "failed" | "dry-run";
  txHashes: Hex[];
  stepsDone: number;
  error?: string;
}

interface Deps {
  signer: Signer | null; // null = dry run
  simulate: (account: Address, calls: Call[]) => Promise<Simulation>;
}

/** Consecutive contract calls from `i`, the unit we can simulate together (a swap breaks the chain). */
function segment(steps: Step[], i: number): Call[] {
  const out: Call[] = [];
  for (let j = i; j < steps.length && steps[j]!.kind === "call"; j++) out.push((steps[j] as { call: Call }).call);
  return out;
}

export async function execute(account: Address, steps: Step[], deps: Deps): Promise<Execution> {
  const txHashes: Hex[] = [];
  const progress = { stepsDone: 0 };
  try {
    return await run(account, steps, deps, txHashes, progress);
  } catch (err) {
    // A thrown error (baw timeout, RPC down) must end as a recorded outcome, never an exception:
    // the caller records it and the cooldown applies (review Critical #2).
    return { outcome: "failed", txHashes, stepsDone: progress.stepsDone, error: (err as Error).message };
  }
}

async function run(account: Address, steps: Step[], { signer, simulate }: Deps, txHashes: Hex[], progress: { stepsDone: number }): Promise<Execution> {
  const stop = (outcome: Execution["outcome"], error?: string): Execution => ({ outcome, txHashes, stepsDone: progress.stepsDone, ...(error ? { error } : {}) });

  const land = (r: SendResult): boolean => {
    if (r.status === "mined") return txHashes.push(r.txHash), true;
    if (r.txHash) txHashes.push(r.txHash);
    return false;
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const afterSwap = steps.slice(0, i).some((s) => s.kind === "swap");

    if (step.kind === "lazy") {
      if (!signer) continue; // dry run: what it would act on doesn't exist yet
      const calls = await step.build();
      if (!calls.length) return stop("failed", `${step.label}: nothing arrived to act on`);
      const sim = await simulate(account, calls);
      if (!sim.ok) return stop("failed", sim.steps.find((s) => s.error)?.error ?? "simulation failed");
      for (const c of calls) {
        const r = await signer.send(c);
        if (r.status === "pending") return land(r), stop("pending", r.note);
        if (!land(r)) return stop("failed", (r as { error: string }).error);
      }
      progress.stepsDone++;
      continue;
    }

    // Before the first call of each segment, simulate the whole segment on current state: Binance's
    // preview doesn't catch Venus error codes (they don't revert), ours does. In a dry run a segment
    // after a swap can't be simulated honestly: the swap never happened.
    if (step.kind === "call" && (i === 0 || steps[i - 1]!.kind !== "call") && (signer || !afterSwap)) {
      const sim = await simulate(account, segment(steps, i));
      if (!sim.ok) return stop("failed", sim.steps.find((s) => s.error)?.error ?? "simulation failed");
    }
    if (!signer) continue;
    const r = step.kind === "call" ? await signer.send(step.call) : await signer.swap(step.swap);
    if (r.status === "pending") return land(r), stop("pending", r.note);
    if (!land(r)) return stop("failed", (r as { error: string }).error);
    progress.stepsDone++;
  }
  return signer ? stop("done") : stop("dry-run");
}
