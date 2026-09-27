// Durable state: user policies and the Guard's event log (PRD F3 "every action is one sentence", F4 log).
// ponytail: one JSON file, synchronous atomic writes (tmp + rename), re-read on every access.
// Fine for a hackathon's handful of wallets; move to SQLite/KV when this grows.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";
import type { Ticker } from "./config.ts";
import { DEFAULT_POLICY, type Action, type Policy, type Status } from "./policy.ts";

export interface GuardEvent {
  at: string; // ISO
  account: Address;
  ticker: Ticker;
  kind: Action["kind"];
  usd: number | null;
  status: Status;
  reason: string; // the user-facing sentence
  outcome: "dry-run" | "done" | "pending" | "failed" | "blocked";
  txHashes: string[];
  simulated: boolean;
  error?: string;
}

interface Data {
  policies: Record<string, Policy>;
  events: Record<string, GuardEvent[]>; // per account, newest first
}

const MAX_EVENTS = 500;
const key = (a: Address) => a.toLowerCase();

export function openStore(dir: string) {
  const file = join(dir, "store.json");
  // Always read from disk: the API and the keeper are separate processes sharing this file.
  const load = (): Data => {
    if (!existsSync(file)) return { policies: {}, events: {} };
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Data;
    } catch (err) {
      // Never overwrite a file we can't read: that would silently erase every policy and event.
      throw new Error(`${file} is not valid JSON (${(err as Error).message}); fix or move it before starting`);
    }
  };
  // Read-modify-write so one process never clobbers the other's changes.
  // ponytail: no cross-process lock; two writes in the same millisecond can still race. Fine at
  // keeper cadence (60s); use SQLite if writers multiply.
  const update = (mutate: (d: Data) => void) => {
    const data = load();
    mutate(data);
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`; // per process, so two writers never share a tmp file
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
  };
  load(); // fail fast on a corrupt file

  return {
    getPolicy: (a: Address): Policy => ({ ...DEFAULT_POLICY, ...load().policies[key(a)] }),
    setPolicy(a: Address, p: Partial<Policy>): Policy {
      let next = DEFAULT_POLICY;
      update((d) => (next = d.policies[key(a)] = { ...DEFAULT_POLICY, ...d.policies[key(a)], ...p }));
      return next;
    },
    addEvent(e: GuardEvent) {
      update((d) => {
        const list = [e, ...(d.events[key(e.account)] ?? [])].sort((x, y) => y.at.localeCompare(x.at));
        d.events[key(e.account)] = list.slice(0, MAX_EVENTS);
      });
    },
    events: (a: Address, limit = 50): GuardEvent[] => (load().events[key(a)] ?? []).slice(0, limit),
  };
}

export type Store = ReturnType<typeof openStore>;
