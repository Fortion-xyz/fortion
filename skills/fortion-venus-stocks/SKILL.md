---
name: fortion-venus-stocks
description: |
  Use when the user wants to borrow USDT against tokenized stocks (bStocks such as NVDAB, TSLAB, SPCXB)
  on Venus Core Pool (BNB Smart Chain) with a Binance Agentic Wallet: pledge / supply stock as collateral,
  borrow or draw USDT, repay a loan, withdraw pledged stock, or check how safe a stock-backed loan is
  around market close, weekends and earnings halts.
version: 0.1.0
license: MIT
metadata:
  author: fortion
  version: '0.1.0'
  requiredCliVersion: '1.10.0'
  openclaw:
    requires:
      bins:
        - baw
        - node
---

# Fortion: Venus lending for tokenized stocks

Borrow USDT against bStocks without selling them. The Binance Agentic Wallet skill has no Venus
borrow or repay command, so this skill builds the Venus calls itself and signs them through
`baw contract-call` (Developer Mode). Nothing here is investment advice; a stock-backed loan can be
liquidated if the stock falls.

## Before anything (every session)

1. `baw wallet status --json` must report `CONNECTED`. If it returns an error such as
   `SERVICE_ERROR: illegal parameter`, the host is **not signed in**: run the sign-in flow of the
   `binance-agentic-wallet` skill (`baw auth signin` → QR in the Binance App → `baw auth verify`).
2. `baw wallet settings --json`: `devMode.enabled` must be true. If not, ask the user to enable
   Developer Mode in the Binance App. It cannot be turned on from the CLI.
3. Chain is always BSC: `--binanceChainId 56`.

## How every write works

```bash
node scripts/calldata.mjs <action> …        # prints [{ "to", "data", "label" }]
```
For **each** call, in order:
1. `baw contract-call preview --binanceChainId 56 --from <wallet> --to <to> --inputData <data> --json`
2. Show the user the label, the parsed transaction, and any `risks`. **Stop** on an error, a
   `simulationErrorDetail`, or any `riskType: "RISK"` item.
3. Ask the user to confirm, then `baw contract-call execute --requestId <id> --json`.
4. Wait until the transaction is mined before previewing the next call (the next call depends on
   it: `mint` needs the `approve`). `PENDING_CONFIRMATION` means the user approves in the Binance App.

| Action | Command | Calls |
| --- | --- | --- |
| Pledge stock | `supply NVDAB 0.5` | approve → mint → enterMarkets |
| Borrow USDT | `borrow 50` | borrow |
| Repay | `repay 20` | approve → repayBorrow |
| Repay everything | `repay all <debt + ~0.1% margin>` | approve (capped) → repayBorrow(max) |
| Withdraw stock | `withdraw NVDAB 0.1` | redeemUnderlying |

Details per action: [supply](references/supply.md) · [borrow](references/borrow.md) ·
[repay](references/repay.md) · [withdraw](references/withdraw.md). **Read
[safety](references/safety.md) before the first borrow.** It covers the rules that differ from
crypto collateral.

## Checking a position

`baw defi position --json` lists Venus supply and borrow balances. To check how much can still be
borrowed, remember that the **collateral factor** caps borrowing (NVDAB/TSLAB 60%, SPCXB 50% on 27 Sep
2026) while liquidation happens at the **liquidation threshold** (70% / 70% / 65%).
