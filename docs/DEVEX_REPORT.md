# Developer Experience Report (running log)

Filled into the official template at the end (PRD §10). Add findings as they happen, dated.

## Findings

- **25 Sep 2026, Venus:** bStock vToken addresses aren't in an obvious doc page; `Comptroller.getAllMarkets()` + `symbol()` found vNVDAB, vTSLAB, vSPCXB (plus vSKHYB) — see `backend/scripts/venus-markets.ts`.

## To verify (PRD §10)

1. DeFi Transaction API: deposit/redeem only, no borrow/repay for lending.
2. DeFi Data `position/list` coverage of Venus bStock markets; health factor vs `getAccountLiquidity`.
3. RWA `underlying-market` status vs Venus oracle behaviour during halts.
4. Venus supply caps as a consumer ceiling.
5. Agentic Wallet: Venus skill coverage, session scope granularity, delegation to an external keeper.
6. Agent Studio: scheduling granularity, cost of a 60s loop, gas self-funding.
