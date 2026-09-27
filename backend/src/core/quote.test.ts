import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNasdaqQuote } from "./quote.ts";
import { toMarketWindow, type StatusInfo } from "./market.ts";

// Real api.nasdaq.com/api/quote/NVDA/info response fields, Sun 27 Sep 2026.
const CLOSED = { data: { symbol: "NVDA", marketStatus: "Closed", primaryData: { lastSalePrice: "$225.07", lastTradeTimestamp: "Sep 24, 2026", isRealTime: false } } };
const status: StatusInfo = { openState: true, marketStatus: null, reasonCode: "TRADING", reasonMsg: null };
const SATURDAY = new Date("2026-09-26T12:03:00Z");

test("parses the Nasdaq last sale price", () => {
  assert.deepEqual(parseNasdaqQuote(CLOSED), { priceUsd: 225.07, asOf: "Sep 24, 2026", marketOpen: false });
});

test("open market and malformed responses", () => {
  assert.equal(parseNasdaqQuote({ data: { ...CLOSED.data, marketStatus: "Open" } })?.marketOpen, true);
  assert.equal(parseNasdaqQuote({ data: null }), null);
  assert.equal(parseNasdaqQuote({ data: { primaryData: { lastSalePrice: "N/A" } } }), null);
});

test("weekend spread compares the token's per-share price with the real last close", () => {
  // Monitor, Sat 26 Sep 12:03 UTC: NVDAB tokenPrice 224.44, referencePrice 224.27 (= token / 1.000778).
  const w = toMarketWindow("NVDAB", { tokenContractAddress: "0x", tokenPrice: "224.44", referencePrice: "224.27" }, status, SATURDAY, [], { priceUsd: 225.07, asOf: "Sep 24, 2026", marketOpen: false });
  assert.equal(w.stockUsd, 225.07);
  assert.ok(Math.abs(w.spread - (225.07 - 224.27) / 225.07) < 1e-12);
});

test("Important #5: without a real stock quote the spread is unknown, not the always-tight RWA pair", () => {
  const w = toMarketWindow("NVDAB", { tokenContractAddress: "0x", tokenPrice: "102", referencePrice: "100" }, status, SATURDAY, [], null);
  assert.equal(w.stockUsd, null);
  assert.equal(w.spread, Infinity);
});

test("Important #5: a quote older than 15 minutes is not used", async () => {
  const { freshQuote } = await import("./quote.ts");
  const q = { priceUsd: 225, asOf: "Sep 24, 2026", marketOpen: false };
  assert.deepEqual(freshQuote({ at: 1_000, value: q }, 1_000 + 14 * 60_000), q);
  assert.equal(freshQuote({ at: 1_000, value: q }, 1_000 + 16 * 60_000), null);
  assert.equal(freshQuote(undefined, 0), null);
});

test("shadow oracle values collateral at the lower of token and real stock price", async () => {
  const { conservativeCollateral } = await import("./position.ts");
  assert.equal(conservativeCollateral(1000, { referenceUsd: 224.27, stockUsd: 225.07 }), 1000); // stock above token: no haircut
  assert.ok(Math.abs(conservativeCollateral(1000, { referenceUsd: 224.27, stockUsd: 220 }) - 1000 * (220 / 224.27)) < 1e-9);
  assert.equal(conservativeCollateral(1000, { referenceUsd: 224.27, stockUsd: null }), 1000); // no quote: trust Venus
});

test("Critical #3: account-wide debt is split across pledged stocks by collateral value", async () => {
  const { debtShare } = await import("./position.ts");
  // Only NVDAB pledged: TSLAB and SPCXB carry none of the debt or buffer, so the Guard leaves them alone.
  assert.deepEqual(debtShare({ NVDAB: 100, TSLAB: 0, SPCXB: 0 }, "TSLAB", 40, 6), { debtUsd: 0, bufferUsd: 0 });
  assert.deepEqual(debtShare({ NVDAB: 100, TSLAB: 0, SPCXB: 0 }, "NVDAB", 40, 6), { debtUsd: 40, bufferUsd: 6 });
  // Two stocks: each carries its share, so each sees the account's true LTV (40 / 200).
  assert.deepEqual(debtShare({ NVDAB: 150, TSLAB: 50, SPCXB: 0 }, "TSLAB", 40, 6), { debtUsd: 10, bufferUsd: 1.5 });
  // Debt but no collateral anywhere: the NVDAB pass alone reports it, so it is surfaced exactly once.
  assert.deepEqual(debtShare({ NVDAB: 0, TSLAB: 0, SPCXB: 0 }, "NVDAB", 40, 6), { debtUsd: 40, bufferUsd: 6 });
  assert.deepEqual(debtShare({ NVDAB: 0, TSLAB: 0, SPCXB: 0 }, "TSLAB", 40, 6), { debtUsd: 0, bufferUsd: 0 });
});
