# Safety: how stock collateral differs from crypto

Observed on BSC mainnet, 25–27 Sep 2026 (Binance Web3 RWA API + Venus contracts):

- **The token trades 24/7, the stock doesn't.** bStocks keep trading on-chain on nights and weekends
  and the Venus oracle follows the on-chain price. When the stock market reopens, the token can jump to
  the real price. Compare the token price with the stock's last close before borrowing off-hours.
- **RWA `referencePrice` is not an exchange quote.** It equals `tokenPrice / tokenToShareRatio`, so
  it can't show a gap between the token and the stock. Use an exchange quote for that.
- **Status stays `TRADING` most of the time.** Binance RWA `statusInfo.reasonCode` did not change over a
  weekend or a broker maintenance window. `ASSET_PAUSED` / `ASSET_LIMITED` (reasons such as
  `cash_dividend`, `stock_split`, `earnings`) mark real halts: during one the stock can't be sold or
  withdrawn, only repaid against.
- **Earnings dates are not in the RWA API.** Reduce the loan *before* earnings: during the halt you
  can only repay.
- **Two limits:** borrowing stops at the collateral factor, liquidation starts at the liquidation
  threshold (10% penalty). `Comptroller.getAccountLiquidity` reports headroom against the
  **liquidation threshold**, so it is not "how much more I can borrow".
- **Supply caps** can fill up. Check them before pledging.
- **One transaction at a time**, each mined before the next preview, and approvals sized to the
  exact amount.
