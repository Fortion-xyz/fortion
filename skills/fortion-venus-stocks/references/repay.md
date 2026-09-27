# Repay

- Part of the loan: `node scripts/calldata.mjs repay <usdt>` → approve exactly `<usdt>` → `vUSDT.repayBorrow(amount)`.
- Everything: `node scripts/calldata.mjs repay all <cap>` → approve `<cap>` → `repayBorrow(2^256−1)`,
  which repays the exact debt including interest accrued until the transaction lands. Use the current
  debt plus about 0.1% as `<cap>`, so no large allowance is left behind. Never approve an unlimited amount.

The wallet must hold enough USDT (BSC-USD, `0x55d398326f99059fF775485246999027B3197955`). Repaying
during a stock trading pause is fine: it moves USDT, not the paused stock.
