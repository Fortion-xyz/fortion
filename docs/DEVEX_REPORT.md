# Developer Experience Report (running log)

Filled into the official template at the end (PRD §10). Add findings as they happen, dated.

## Findings

- **25 Sep 2026, Venus:** bStock vToken addresses aren't in an obvious doc page; `Comptroller.getAllMarkets()` + `symbol()` found vNVDAB, vTSLAB, vSPCXB (plus vSKHYB) — see `backend/scripts/venus-markets.ts`.

- **25 Sep 2026, Venus supply caps differ from the PRD / launch coverage.** Live values: NVDAB cap 1,500 (1,244 used, ~256 room), TSLAB 236 (~122 room), SPCXB 2,000 (~621 room). Borrowing bStocks is paused (borrow cap 0), as expected. Source: `pnpm --filter backend check:venus`.
- **25 Sep 2026, USDT borrow against bStocks works (go decision, PRD §13).** Proven with a zero-fund dry run: `eth_simulateV1` + state override gives a fresh address 1 NVDAB, then approve → mint → enterMarkets → borrow runs against live mainnet state. Works for NVDAB, TSLAB and SPCXB at 35% LTV. Source: `pnpm --filter backend simulate:pledge NVDAB 1 0.35`.
- **25 Sep 2026, Venus: two different limits, easy to confuse.** Borrow is gated by the collateral factor (NVDAB 1 @ 59% LTV succeeds, @ 65% reverts), but `getAccountLiquidity` reports headroom against the *liquidation threshold* (70%), not the CF. A UI that shows `getAccountLiquidity` as "you can still borrow" overstates it.
- **25 Sep 2026, SPCXB has CF 50% / LT 65%**, not the 60/70 of NVDAB/TSLAB. The PRD's ticker-agnostic 58% last-resort line leaves only 7 points to liquidation on SPCXB.
- **25 Sep 2026, public BSC RPCs block `eth_getLogs`** (limit exceeded / archive-only / 50-block ranges), so finding existing Venus borrowers for a cross-check is impractical without a paid RPC or indexer. `eth_simulateV1` on the other hand is supported by every public RPC we tried, which makes full-flow dry runs free.

- **25 Sep 2026, Binance Web3 API docs sit behind a bot challenge.** `curl` of web3.binance.com/en/dev-docs returns nothing; only a browser-like fetch reads them. The keyless `www.binance.com/bapi/...` RWA endpoints in the official `binance-tokenized-securities-info` skill use different field names (`sharesMultiplier`, `tokenInfo.price`) than the hackathon API (`tokenPrice`, `referencePrice`), which is confusing when both are "Binance RWA".
- **25 Sep 2026, RWA API has no earnings date, and the "Upcoming Earnings" filter doesn't filter.** `statusInfo` only says a stock is paused or limited *now*. `/tokens?platformId=bstock&tabId=3` returned all 46 bStocks (same as no `tabId`). A lender needs "halt starts in N hours" to de-risk before the pause; we fell back to an operator calendar.
- **25 Sep 2026 (live), `marketStatus` is always null and bStocks report `TRADING` 24/5.** Checked at 18:27 ET on a Thursday: all 46 bStocks `TRADING/null/null`. The docs list `regular/premarket/postmarket/overnight/closed/pause`. So the API can't tell regular hours from overnight; we derive the session from the New York clock.
- **25 Sep 2026 (live), rate limit is ~5 req/s per key across endpoints.** 6 back-to-back calls → `429 42900` on the 6th, and mixing `/price` + `/underlying-market` hits it sooner than the per-endpoint limit in the docs suggests. We added a 4 req/s client queue and a 15s cache.
- **25 Sep 2026 (live), docs vs response drift:** `/underlying-profile` returns `protections.collateralReport` (docs: `dailyAttestationReport` / `monthlyAttestationReport`); `/underlying-market` `marketData.referencePrice` is null (use `/price`).
- **25 Sep 2026, bStock swaps are RFQ.** Quote → swap returns EIP-712 typed data to sign → `order/submit` → poll. Not a plain transaction, so it cannot be batched or simulated like the Venus calls.
- **25 Sep 2026, Agentic Wallet sessions can't be scoped or delegated.** No per-contract allowlist (only per-category daily USD caps + token list + Developer Mode expiry), no way to hand a session to an external agent such as a BNB Agent Studio keeper, sign-in lasts ~48h, and no in-wallet automation runtime. Venus borrow/repay is possible only as raw `contract-call` in Developer Mode. Agent Studio in turn has no Binance Agentic Wallet integration. The two prize-track products don't connect out of the box.

## To verify (PRD §10)

1. DeFi Transaction API: deposit/redeem only, no borrow/repay for lending.
2. DeFi Data `position/list` coverage of Venus bStock markets; health factor vs `getAccountLiquidity`.
3. RWA `underlying-market` status vs Venus oracle behaviour during halts and off-hours (run `check:venus` over a weekend and compare prices).
6. Agent Studio: scheduling granularity, cost of a 60s loop, gas self-funding.
