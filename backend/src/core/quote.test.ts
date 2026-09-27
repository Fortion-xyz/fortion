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

test("without a stock quote the spread falls back to the RWA pair", () => {
  const w = toMarketWindow("NVDAB", { tokenContractAddress: "0x", tokenPrice: "102", referencePrice: "100" }, status, SATURDAY, [], null);
  assert.equal(w.stockUsd, null);
  assert.ok(Math.abs(w.spread - 0.02) < 1e-12);
});

test("shadow oracle values collateral at the lower of token and real stock price", async () => {
  const { conservativeCollateral } = await import("./position.ts");
  assert.equal(conservativeCollateral(1000, { referenceUsd: 224.27, stockUsd: 225.07 }), 1000); // stock above token: no haircut
  assert.ok(Math.abs(conservativeCollateral(1000, { referenceUsd: 224.27, stockUsd: 220 }) - 1000 * (220 / 224.27)) < 1e-9);
  assert.equal(conservativeCollateral(1000, { referenceUsd: 224.27, stockUsd: null }), 1000); // no quote: trust Venus
});
