# Borrow USDT

`node scripts/calldata.mjs borrow <usdt>` → `vUSDT.borrow(amount)`.

- Borrowing is capped by the **collateral factor**: NVDAB/TSLAB 60%, SPCXB 50% of the stock's value
  (27 Sep 2026; governance can change it). A borrow above it reverts.
- Don't borrow to the cap. A stock-backed loan needs room for price gaps when the stock market
  reopens and for trading pauses around earnings (see [safety](safety.md)). A common rule is to stay
  around half of the liquidation threshold (≈35% for NVDAB/TSLAB, ≈32% for SPCXB) and lower overnight,
  on weekends and before earnings.
- Keep part of what you borrow (e.g. 15%) as USDT in the wallet, so the loan can be reduced quickly.
