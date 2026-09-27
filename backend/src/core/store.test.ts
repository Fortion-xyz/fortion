import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type GuardEvent } from "./store.ts";

const A = "0x000000000000000000000000000000000000dEaD" as const;
const B = "0x00000000000000000000000000000000000000B0" as const;
const dir = () => mkdtempSync(join(tmpdir(), "fortion-store-"));
const ev = (at: string, account = A): GuardEvent => ({
  at, account, ticker: "NVDAB", kind: "repay", usd: 10, status: "Protecting", reason: "Repaid 10.00 USDT.", outcome: "dry-run", txHashes: [], simulated: true,
});

test("policies default, update, and survive a reload", () => {
  const d = dir();
  const s = openStore(d);
  assert.equal(s.getPolicy(A).profile, "balanced");
  s.setPolicy(A, { profile: "growth" });
  assert.equal(openStore(d).getPolicy(A).profile, "growth");
  assert.equal(openStore(d).getPolicy(A).keeperCanSell, true, "partial update keeps the rest");
});

test("events are per account, newest first, limited", () => {
  const s = openStore(dir());
  s.addEvent(ev("2026-09-27T10:00:00Z"));
  s.addEvent(ev("2026-09-27T11:00:00Z"));
  s.addEvent(ev("2026-09-27T12:00:00Z", B));
  assert.deepEqual(s.events(A, 10).map((e) => e.at), ["2026-09-27T11:00:00Z", "2026-09-27T10:00:00Z"]);
  assert.equal(s.events(A, 1).length, 1);
});

test("keeps at most 500 events per account", () => {
  const s = openStore(dir());
  for (let i = 0; i < 510; i++) s.addEvent(ev(new Date(Date.UTC(2026, 8, 27, 0, i)).toISOString()));
  assert.equal(s.events(A, 1000).length, 500);
  assert.equal(s.events(A, 1)[0]!.at, new Date(Date.UTC(2026, 8, 27, 0, 509)).toISOString());
});

test("file on disk is always valid JSON; a corrupt file is refused, not wiped", () => {
  const d = dir();
  openStore(d).addEvent(ev("2026-09-27T10:00:00Z"));
  JSON.parse(readFileSync(join(d, "store.json"), "utf8"));
  writeFileSync(join(d, "store.json"), "{not json");
  assert.throws(() => openStore(d), /store\.json/);
  assert.equal(readFileSync(join(d, "store.json"), "utf8"), "{not json");
});

test("two processes on one file (API + keeper) see and keep each other's writes", () => {
  const d = dir();
  const api = openStore(d);
  const keeper = openStore(d);
  api.setPolicy(A, { profile: "conservative" }); // user changes profile in the app
  keeper.addEvent(ev("2026-09-27T10:00:00Z")); // keeper logs an action with its older copy
  assert.equal(api.events(A, 5).length, 1, "API sees the keeper's event");
  assert.equal(keeper.getPolicy(A).profile, "conservative", "keeper sees the new profile");
  assert.equal(openStore(d).getPolicy(A).profile, "conservative", "the keeper's write did not clobber the policy");
});
