import { test } from "node:test";
import assert from "node:assert/strict";
import { sign } from "./binance.ts";
import { minutesToWeekendClose, toMarketStatus, toMarketWindow, type StatusInfo } from "./market.ts";

const status = (o: Partial<StatusInfo>): StatusInfo => ({ openState: true, marketStatus: "regular", reasonCode: "TRADING", reasonMsg: null, ...o });

test("signature matches openssl HMAC-SHA256 base64", () => {
  // printf '%s' "${ts}GET${path}" | openssl dgst -sha256 -hmac test-secret -binary | base64
  assert.equal(sign("2026-05-11T10:08:57.715Z", "GET", "/build/api/v1/dex/market/rwa/price?binanceChainId=56", "", "test-secret"), "qu9m651jqD87zWo/iEvhk+XDcf9s2K+rzC90G5hVJbo=");
});

test("reason codes collapse to Guard states, unknown = closed", () => {
  assert.equal(toMarketStatus(status({})), "TRADING");
  assert.equal(toMarketStatus(status({ marketStatus: "postmarket" })), "MARKET_CLOSED");
  assert.equal(toMarketStatus(status({ reasonCode: "MARKET_CLOSED", marketStatus: "closed" })), "MARKET_CLOSED");
  assert.equal(toMarketStatus(status({ reasonCode: "ASSET_PAUSED", reasonMsg: "cash_dividend" })), "ASSET_PAUSED");
  assert.equal(toMarketStatus(status({ reasonCode: "ASSET_LIMITED", reasonMsg: "earnings" })), "ASSET_LIMITED");
  assert.equal(toMarketStatus(status({ reasonCode: "UNSUPPORTED" })), "ASSET_PAUSED");
  assert.equal(toMarketStatus(status({ reasonCode: "SOMETHING_NEW" })), "MARKET_CLOSED");
});

test("window: spread, earnings flag and reason", () => {
  const w = toMarketWindow("NVDAB", { tokenContractAddress: "0x", tokenPrice: "102", referencePrice: "100" }, status({}), true, new Date("2026-09-23T15:00:00Z"));
  assert.ok(Math.abs(w.spread - 0.02) < 1e-9);
  assert.equal(w.hoursToCorporateAction, 0);
  assert.equal(w.minutesToWeekendClose, null); // Wednesday
});

test("zero reference price never reads as a tight spread", () => {
  assert.equal(toMarketWindow("NVDAB", { tokenContractAddress: "0x", tokenPrice: "1", referencePrice: "0" }, status({}), false, new Date()).spread, 1);
});

test("weekend close counts down on Friday afternoon New York time", () => {
  assert.equal(minutesToWeekendClose(new Date("2026-09-25T19:30:00Z")), 30); // Fri 15:30 EDT
  assert.equal(minutesToWeekendClose(new Date("2026-09-25T20:30:00Z")), null); // after close
});
