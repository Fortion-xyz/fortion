import { test } from "node:test";
import assert from "node:assert/strict";
import { toStock } from "./stocks.ts";
import type { MarketWindow } from "./market.ts";

const market: MarketWindow = {
  ticker: "NVDAB", status: "MARKET_CLOSED", regularSession: false, reason: null, onchainUsd: 224.85, referenceUsd: 224.675,
  stockUsd: 225.07, spread: 0.00175, hoursToCorporateAction: null, nextEarnings: null, minutesToWeekendClose: null,
};

test("stock card joins market, token metadata and Venus room", () => {
  const s = toStock(market, { tokenName: "NVIDIA (bStocks)", tokenLogoUrl: "https://x/logo.png" }, { cap: 1500, supplied: 1244.17 });
  assert.equal(s.ticker, "NVDAB");
  assert.equal(s.name, "NVIDIA (bStocks)");
  assert.equal(s.underlying, "NVDA");
  assert.equal(s.priceUsd, 224.85);
  assert.ok(Math.abs(s.supplyRoom - 255.83) < 1e-9);
  assert.equal(s.buyAllowed, true);
});

test("room never negative; spread > 1% blocks buying (PRD F1)", () => {
  const s = toStock({ ...market, spread: 0.012 }, null, { cap: 100, supplied: 120 });
  assert.equal(s.supplyRoom, 0);
  assert.equal(s.buyAllowed, false);
  assert.match(s.buyBlockedReason!, /price/i);
  assert.equal(s.name, "NVDAB", "falls back to the ticker without metadata");
});

test("paused stock can't be bought", () => {
  assert.equal(toStock({ ...market, status: "ASSET_PAUSED", reason: "cash_dividend" }, null, { cap: 1, supplied: 0 }).buyAllowed, false);
});
