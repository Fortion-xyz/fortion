import { test } from "node:test";
import assert from "node:assert/strict";
import { runEvery } from "./loop.ts";

test("Critical #1: a slow tick is never overlapped by the next one", async () => {
  let running = 0, maxRunning = 0, ticks = 0;
  const slowTick = async () => {
    running++, ticks++;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((r) => setTimeout(r, 30)); // longer than the interval
    running--;
  };
  await runEvery(slowTick, 5, { times: 4 });
  assert.equal(ticks, 4);
  assert.equal(maxRunning, 1);
});

test("a tick that throws doesn't stop the loop", async () => {
  let ticks = 0;
  await runEvery(async () => { ticks++; throw new Error("boom"); }, 1, { times: 3, onError: () => {} });
  assert.equal(ticks, 3);
});
