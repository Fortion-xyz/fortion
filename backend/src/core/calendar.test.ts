import { test } from "node:test";
import assert from "node:assert/strict";
import { nyTime, parseNasdaq } from "./calendar.ts";

// Real reportText samples from api.nasdaq.com, 25 Sep 2026.
const MU = "Micron Technology, Inc. Common Stock is expected* to report earnings on  09/30/2026 after market close.  The report will be for the fiscal Quarter ending Aug 2026.";
const NVDA = "NVIDIA Corporation Common Stock is estimated to report earnings on  11/18/2026. The upcoming earnings date is derived from an algorithm based on a company's historical reporting dates.";

test("company-scheduled date with time → confirmed, 16:00 New York", () => {
  assert.deepEqual(parseNasdaq(MU), { at: new Date("2026-09-30T20:00:00Z"), confirmed: true }); // EDT
});

test("algorithmic estimate → unconfirmed, no time → 09:30 New York (conservative)", () => {
  assert.deepEqual(parseNasdaq(NVDA), { at: new Date("2026-11-18T14:30:00Z"), confirmed: false }); // EST
});

test("unrecognised text → null", () => {
  assert.equal(parseNasdaq("No earnings date available"), null);
});

test("nyTime handles both sides of the DST switch", () => {
  assert.equal(nyTime(2026, 10, 30, 16, 0).toISOString(), "2026-10-30T20:00:00.000Z"); // EDT
  assert.equal(nyTime(2026, 11, 2, 16, 0).toISOString(), "2026-11-02T21:00:00.000Z"); // EST
});
