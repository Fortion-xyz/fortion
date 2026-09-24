// Simulate-first (PRD §7): run a batch of calls in one eth_simulateV1 block against live state.
// ponytail: eth_simulateV1 until the Binance Transaction API key lands; swap the transport, keep the contract.
import type { Address, StateOverride } from "viem";
import { client } from "./venus.ts";
import { callError, type Call } from "./venus-tx.ts";

export interface Simulation {
  ok: boolean;
  steps: { label: string; error: string | null }[];
}

export async function simulate(account: Address, calls: Call[], stateOverrides?: StateOverride): Promise<Simulation> {
  const { results } = await client.simulateCalls({
    account,
    calls: calls.map(({ to, data }) => ({ to, data })),
    stateOverrides,
  });
  const steps = results.map((r, i) => {
    const c = calls[i]!;
    const error = r.status === "success" ? callError(c, r.data) : `${c.label}: reverted ${r.error?.message.split("\n")[0] ?? ""}`.trim();
    return { label: c.label, error };
  });
  return { ok: steps.every((s) => !s.error), steps };
}
