// Runs a plan one step at a time: simulate → sign → wait for the chain → next.
// Stops at the first step that doesn't land; the next Guard tick re-plans from real on-chain state,
// so a half-done plan is never retried blindly.
import type { Address, Hex } from "viem";
import type { Simulation } from "./simulate.ts";
import type { Call } from "./venus-tx.ts";
import type { Signer, Swap } from "./wallet.ts";

export type Step = { kind: "call"; call: Call } | { kind: "swap"; swap: Swap };

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

export async function execute(account: Address, steps: Step[], { signer, simulate }: Deps): Promise<Execution> {
  const txHashes: Hex[] = [];
  let stepsDone = 0;
  const stop = (outcome: Execution["outcome"], error?: string): Execution => ({ outcome, txHashes, stepsDone, ...(error ? { error } : {}) });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    // Before the first call of each segment, simulate the whole segment on current state: Binance's
    // preview doesn't catch Venus error codes (they don't revert), ours does.
    const afterSwap = steps.slice(0, i).some((s) => s.kind === "swap");
    // In a dry run a segment after a swap can't be simulated honestly: the swap never happened.
    if (step.kind === "call" && (i === 0 || steps[i - 1]!.kind === "swap") && (signer || !afterSwap)) {
      const sim = await simulate(account, segment(steps, i));
      if (!sim.ok) return stop("failed", sim.steps.find((s) => s.error)?.error ?? "simulation failed");
    }
    if (!signer) continue; // dry run: swaps can't be simulated, nothing else to check
    const r = step.kind === "call" ? await signer.send(step.call) : await signer.swap(step.swap);
    if (r.status === "pending") return stop("pending", r.note);
    if (r.status === "failed") {
      if (r.txHash) txHashes.push(r.txHash);
      return stop("failed", r.error);
    }
    txHashes.push(r.txHash);
    stepsDone++;
  }
  return signer ? stop("done") : stop("dry-run");
}
