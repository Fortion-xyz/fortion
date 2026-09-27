# Withdraw pledged stock

`node scripts/calldata.mjs withdraw <ticker> <amount>` → `vToken.redeemUnderlying(amount)`.

Venus only releases collateral while the remaining loan stays under the collateral factor. With a
loan close to that line, only a small amount can leave. To exit a large position, repay first, or
withdraw in small chunks and repay with the proceeds between chunks. Withdrawal fails while the stock
itself is paused for a corporate action.
