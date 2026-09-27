# Supply (pledge) a bStock

`node scripts/calldata.mjs supply <NVDAB|TSLAB|SPCXB> <amount>` → three calls:

1. `approve <ticker>`: lets the Venus market pull exactly `<amount>` (never an unlimited approval)
2. `supply <ticker>`: `vToken.mint(amount)`, the stock moves into Venus and the wallet receives vTokens
3. `use <ticker> as collateral`: `Comptroller.enterMarkets([vToken])`, without it the stock earns no borrowing power

Before supplying, check the market's **supply cap**: `Comptroller.supplyCaps(vToken)` minus
`totalSupply × exchangeRateStored / 1e18`. On 27 Sep 2026 NVDAB had about 1.2 tokens of room left, and
a `mint` over the cap fails.

Venus markets are Compound-style: some failures return an error code **without reverting**. After
`mint` is mined, confirm the vToken balance increased (`baw defi position --json`) before borrowing.
