# Developer Experience Report (running log)

Filled into the official template at the end (PRD §10). Add findings as they happen, dated.

## Findings

- **25 Sep 2026, Venus:** bStock vToken addresses aren't in an obvious doc page; `Comptroller.getAllMarkets()` + `symbol()` found vNVDAB, vTSLAB, vSPCXB (plus vSKHYB) — see `backend/scripts/venus-markets.ts`.

- **25 Sep 2026, Venus supply caps differ from the PRD / launch coverage.** Live values: NVDAB cap 1,500 (1,244 used, ~256 room), TSLAB 236 (~122 room), SPCXB 2,000 (~621 room). Borrowing bStocks is paused (borrow cap 0), as expected. Source: `pnpm --filter backend check:venus`.
- **25 Sep 2026, USDT borrow against bStocks works (go decision, PRD §13).** Proven with a zero-fund dry run: `eth_simulateV1` + state override gives a fresh address 1 NVDAB, then approve → mint → enterMarkets → borrow runs against live mainnet state. Works for NVDAB, TSLAB and SPCXB at 35% LTV. Source: `pnpm --filter backend simulate:pledge NVDAB 1 0.35`.
- **25 Sep 2026, Venus: two different limits, easy to confuse.** Borrow is gated by the collateral factor (NVDAB 1 @ 59% LTV succeeds, @ 65% reverts), but `getAccountLiquidity` reports headroom against the *liquidation threshold* (70%), not the CF. A UI that shows `getAccountLiquidity` as "you can still borrow" overstates it.
- **25 Sep 2026, SPCXB has CF 50% / LT 65%**, not the 60/70 of NVDAB/TSLAB. The PRD's ticker-agnostic 58% last-resort line leaves only 7 points to liquidation on SPCXB.
- **25 Sep 2026, public BSC RPCs block `eth_getLogs`** (limit exceeded / archive-only / 50-block ranges), so finding existing Venus borrowers for a cross-check is impractical without a paid RPC or indexer. `eth_simulateV1` on the other hand is supported by every public RPC we tried, which makes full-flow dry runs free.

## To verify (PRD §10)

1. DeFi Transaction API: deposit/redeem only, no borrow/repay for lending.
2. DeFi Data `position/list` coverage of Venus bStock markets; health factor vs `getAccountLiquidity`.
3. RWA `underlying-market` status vs Venus oracle behaviour during halts and off-hours (run `check:venus` over a weekend and compare prices).
5. Agentic Wallet: Venus skill coverage, session scope granularity, delegation to an external keeper.
6. Agent Studio: scheduling granularity, cost of a 60s loop, gas self-funding.
