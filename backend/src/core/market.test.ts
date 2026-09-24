import { test } from "node:test";
import assert from "node:assert/strict";
import { sign } from "./binance.ts";
import { parseCorporateActions } from "./config.ts";
import { isRegularSession, minutesToWeekendClose, toMarketStatus, toMarketWindow, type StatusInfo } from "./market.ts";

const status = (o: Partial<StatusInfo>): StatusInfo => ({ openState: true, marketStatus: "regular", reasonCode: "TRADING", reasonMsg: null, ...o });

test("signature matches openssl HMAC-SHA256 base64", () => {
  // printf '%s' "${ts}GET${path}" | openssl dgst -sha256 -hmac test-secret -binary | base64
  assert.equal(sign("2026-05-11T10:08:57.715Z", "GET", "/build/api/v1/dex/market/rwa/price?binanceChainId=56", "", "test-secret"), "qu9m651jqD87zWo/iEvhk+XDcf9s2K+rzC90G5hVJbo=");
});

// 15:00 UTC Wed 23 Sep = 11:00 EDT (regular); 22:27 UTC Thu 24 Sep = 18:27 EDT (after close).
const REGULAR = new Date("2026-09-23T15:00:00Z");
const AFTER_CLOSE = new Date("2026-09-24T22:27:00Z");
const price = (tokenPrice: string, referencePrice: string) => ({ tokenContractAddress: "0x", tokenPrice, referencePrice });

test("reason codes collapse to Guard states, unknown = closed", () => {
  assert.equal(toMarketStatus(status({}), true), "TRADING");
  assert.equal(toMarketStatus(status({ reasonCode: "MARKET_CLOSED" }), true), "MARKET_CLOSED");
  assert.equal(toMarketStatus(status({ reasonCode: "ASSET_PAUSED", reasonMsg: "cash_dividend" }), true), "ASSET_PAUSED");
  assert.equal(toMarketStatus(status({ reasonCode: "ASSET_LIMITED", reasonMsg: "earnings" }), true), "ASSET_LIMITED");
  assert.equal(toMarketStatus(status({ reasonCode: "UNSUPPORTED" }), true), "ASSET_PAUSED");
  assert.equal(toMarketStatus(status({ reasonCode: "SOMETHING_NEW" }), true), "MARKET_CLOSED");
});

test("TRADING outside the NY regular session counts as closed (live API reports TRADING 24/5)", () => {
  const live = status({ marketStatus: null }); // exact shape seen on 24 Sep 2026, 18:27 EDT
  assert.equal(toMarketWindow("NVDAB", price("223.85", "223.68"), live, AFTER_CLOSE).status, "MARKET_CLOSED");
  assert.equal(toMarketWindow("NVDAB", price("223.85", "223.68"), live, REGULAR).status, "TRADING");
});

test("regular session: weekdays 09:30–16:00 New York only", () => {
  assert.equal(isRegularSession(new Date("2026-09-23T13:29:00Z")), false); // 09:29 EDT
  assert.equal(isRegularSession(new Date("2026-09-23T13:30:00Z")), true); // 09:30 EDT
  assert.equal(isRegularSession(new Date("2026-09-23T20:00:00Z")), false); // 16:00 EDT
  assert.equal(isRegularSession(new Date("2026-09-26T15:00:00Z")), false); // Saturday
});

test("spread from on-chain vs reference; zero reference never reads as tight", () => {
  assert.ok(Math.abs(toMarketWindow("NVDAB", price("102", "100"), status({}), REGULAR).spread - 0.02) < 1e-9);
  assert.equal(toMarketWindow("NVDAB", price("1", "0"), status({}), REGULAR).spread, 1);
});

test("corporate action calendar: hours to the next future date, past dates ignored", () => {
  const actions = parseCorporateActions("NVDAB=2026-09-22T00:00:00Z, nvdab=2026-09-24T11:00:00Z").NVDAB!;
  assert.equal(toMarketWindow("NVDAB", price("1", "1"), status({}), REGULAR, actions).hoursToCorporateAction, 20);
  assert.equal(toMarketWindow("NVDAB", price("1", "1"), status({}), REGULAR).hoursToCorporateAction, null);
  assert.throws(() => parseCorporateActions("NVDAB=soon"), /bad entry/);
});

test("weekend close counts down on Friday afternoon New York time", () => {
  assert.equal(minutesToWeekendClose(new Date("2026-09-25T19:30:00Z")), 30); // Fri 15:30 EDT
  assert.equal(minutesToWeekendClose(new Date("2026-09-25T20:30:00Z")), null); // after close
});
