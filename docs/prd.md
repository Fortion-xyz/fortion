# PRD: Fortion, the unlimited pawnshop for tokenized stocks

**Tagline:** Hold the fortress. Draw the fortune.

**Product name:** Fortion (internal codename: Gadai Saham). **Team name:** Fortion.
**Hackathon:** BNB Hack: Tokenized Stocks Edition. Main Track + "Best Use of Agentic Wallet / Wallet Skills" + "Best Use of BNB Agent Studio"
**Deadline:** 11 Oct 2026, 12:00 UTC. **Chain:** BSC mainnet (chainId 56). **Scope:** spot + lending only, no perps.
**Status:** PRD v3.2 (25 Sep 2026): no custom contracts, positions live in the user's Binance Agentic Wallet. v3: mainnet verification done (go), live Venus parameters, user-chosen risk profiles. v3.1: real Binance Web3 API contract; v3.2: live API verification (session from clock, rate limit), Nasdaq earnings calendar, RWA monitor; Agentic Wallet capabilities verified, keeper execution path pending decision (§14).

---

## 1. One-liner

Pledge your tokenized stocks instead of selling them: an agent keeps a Venus loan against your bStocks safe through market hours, earnings halts, and weekend gaps, then raises your credit line as the stock rises. The same "buy, borrow, never sell" strategy wealthy investors use, now for a $50 NVDA holder on BSC.

## 2. Problem

Long-term stock holders are rich on paper and poor in cash. The only way to use the value is to sell, which means losing upside and triggering a taxable event. Wealthy investors never sell; they borrow against the shares. Retail has never had access to that.

On BSC this just became technically possible: Venus Core Pool now accepts NVDAB, TSLAB, and SPCXB (bStocks) as collateral. But nobody should use it raw, because liquidation risk on stock collateral is worse than on crypto:

1. **Gap risk.** The underlying market closes for 16 hours a day and all weekend. Monday can open 10% lower after news nobody could react to.
2. **Halt risk.** bStocks are paused during corporate actions (earnings, dividends, splits). During a halt the holder cannot top up collateral or sell, so a loan that was fine on Tuesday can be liquidated on Thursday.
3. **Oracle risk.** Venus uses an Atlas Oracle feed with a "Dynamic Protection Mode" that triggers at 16.67% deviation. Off-hours the reference price is frozen while the on-chain price keeps moving. That interaction is undocumented from the borrower's side.

CryptoSlate's launch coverage called the liquidation behaviour "still to be proven after launch." Fortion is the layer that proves it safely.

## 3. Target users

| Persona                                                   | Situation                                         | What they get                                         |
| --------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| **Long-term holder** (has NVDAB / TSLAB, refuses to sell) | Needs cash for a laptop, tuition, or a dip to buy | USDT today, shares intact, agent guards the loan      |
| **Accumulator** (believes in the stock)                   | Wants more exposure without new money             | Loan is recycled into more shares, capped and guarded |
| **Agent builders / Claude users**                         | Want stock-collateral positions programmatically  | MCP tools + a keeper policy they do not have to write |

Users never see "health factor," "collateral factor," or "vToken." They see: _Stock value, Cash available, Status (Safe / Careful / Protecting)_.

## 4. Hackathon rules mapped to the design

| Rule / criterion                               | How Fortion satisfies it                                                                                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bStocks / Ondo / xStocks must be central       | bStocks (NVDAB, TSLAB, SPCXB) are the collateral. Nothing works without them. Ondo tokens shown in catalog for buy-side only.                                                                                                                   |
| Spot trading only, no perps                    | Buying bStocks is a spot swap. Lending on Venus is not a derivative. No leverage beyond what collateral allows.                                                                                                                                 |
| BSC mainnet only                               | Venus Core Pool, bStocks, and all Binance Web3 APIs are on chainId 56.                                                                                                                                                                          |
| Public repo, demo video (4 min), deployed link | Section 12.                                                                                                                                                                                                                                     |
| Developer Experience Report (25%)              | Section 10: the report is planned as a deliverable, not an afterthought.                                                                                                                                                                        |
| Technical implementation (30%)                 | 7 Binance Web3 API modules + Venus contracts + a custom Wallet Skill for Venus borrow/repay + Agent Studio + Agentic Wallet. No custom contracts: every action is a real Venus or DEX transaction signed by the user's Agentic Wallet.          |
| Creativity (25%)                               | Not on the official idea list. Turns the risk the press says is unsolved into the product.                                                                                                                                                      |
| Product quality / UX (20%)                     | Three numbers, two modes, plain-language explanations.                                                                                                                                                                                          |
| Best Use of Agentic Wallet                     | Agentic Wallet IS the position. It holds the bStocks, the vTokens, the USDT buffer, and signs every supply, borrow, repay, and swap under a scoped session. We also ship a custom Wallet Skill (`fortion-venus-stocks`) for Venus borrow/repay. |
| Best Use of BNB Agent Studio                   | The keeper is a persistent Agent Studio agent with ERC-8004 identity, running the guard loop 24/7.                                                                                                                                              |

## 5. Product scope

### 5.1 P0 (must ship)

**F1. Get stocks (buy-side, thin)**
Catalog of bStocks accepted by Venus (NVDAB, TSLAB, SPCXB) with on-chain price, reference price, session badge, and halt status. One-tap buy with USDT via Trading API, executed through Agentic Wallet. Guarded by the same market-window and fair-price check as any order (spread > 1% blocks).

**F2. Activate pledge**
User selects a stock, an amount to pledge, a risk profile (F3), and a mode:

- **Cash mode:** borrow USDT up to the safe line, send to user wallet (or schedule monthly "salary" draws).
- **Accumulate mode:** borrow USDT, buy more of the same bStock, re-supply as collateral. Max 2 loops, resulting LTV never above target.

Under the hood: `approve` → Venus `vNVDAB.mint()` (supply) → `enterMarkets` → `vUSDT.borrow()`. Everything happens in and from the user's **Binance Agentic Wallet**. There is no Fortion contract and no custody: the vTokens, the debt, and the USDT buffer all sit in the user's own wallet. The keeper acts only through an Agentic Wallet scoped session (allowed contracts: Venus vTokens + Comptroller + Binance swap router; spend cap; expiry; revocable in one tap).

**F3. The Guard (agent loop)**
Persistent agent on BNB Agent Studio, every 60s and on every RWA status change.

**Risk profile (user's choice).** The user picks one of three profiles at setup and can change it any time. The app never shows LTV; each option is described as "cash up to X% of your stock value, shares sold only after a Y% drop".

| Threshold (for a stock with 70% LT)    | Steady (`conservative`) | Balanced (`balanced`, default) | Bold (`growth`) |
| -------------------------------------- | ----------------------- | ------------------------------ | --------------- |
| Normal target                          | 25%                     | 35%                            | 45%             |
| Overnight / weekend / spread > 2%      | 20%                     | 30%                            | 38%             |
| Halt / corporate action within 24h     | 15%                     | 25%                            | 30%             |
| Protect (repay from buffer)            | 40%                     | 50%                            | 55%             |
| Last resort (sell, buffer empty)       | 50%                     | 58%                            | 60%             |
| Sell down to                           | 30%                     | 40%                            | 45%             |
| Plain language: shares sold after a …  | 50% drop                | 40% drop                       | 25% drop        |

**Per-stock scaling.** All thresholds are multiplied by `LT / 70%` using the market's liquidation threshold read on-chain, so a riskier stock is held lower automatically (SPCXB, LT 65%: Balanced normal target 32.5%, last resort 53.9%). Invariants enforced by unit tests for every profile and every live market: normal target < collateral factor (so the borrow cannot revert), last resort at least 8 points below LT, and halt < overnight < normal < protect < last resort.

| Signal (source)                                                          | Effect on target LTV                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Regular session, spread ≤ 0.5% (RWA price + market status)               | Normal target                                                                                                                                                                                                                                                                        |
| Regular session, spread 0.5–2%                                           | Normal target, new borrows blocked                                                                                                                                                                                                                                                   |
| Outside the NY regular session (Mon–Fri 09:30–16:00 ET, from the clock: the API reports `TRADING` 24/5 with `marketStatus` null), or any unknown status | Overnight target |
| Friday 30 min before close, or any MARKET_CLOSED period                  | Overnight target                                                                                                                                                                                                                                                                     |
| Company-confirmed earnings within 24h (earnings calendar, see §6), or ASSET_PAUSED / ASSET_LIMITED (incl. `earnings`) from RWA status | Halt target, repay down before the halt starts, do nothing during halt. Estimated (algorithmic) dates are shown to the user but never acted on; companies confirm 2–4 weeks ahead and the calendar picks that up. |
| Spread on-chain vs reference > 2% either direction                       | Freeze new borrows, tighten to overnight target                                                                                                                                                                                                                                      |
| Stock rises, LTV drops below target minus 5 points                       | Raise credit line: borrow the delta (Cash mode: to user, Accumulate mode: buy + re-supply)                                                                                                                                                                                           |
| LTV ≥ protect line                                                       | Protecting: repay from the USDT buffer held in the user's Agentic Wallet                                                                                                                                                                                                             |
| LTV ≥ last-resort line and buffer empty                                  | Last resort (default ON, user can turn off at setup with a clear warning): sell just enough bStock via Trading API to bring LTV to the sell-down line, never more. Rationale: a Venus liquidation is also a sale, but with a 10% penalty at the oracle price. If turned off: notify only. |

Buffer rule: on every borrow, 15% of the drawn amount stays in the user's Agentic Wallet as USDT repayment buffer, tagged in the app as "Safety buffer". It is the user's money in the user's wallet; the app only asks them to keep it there while LTV is above the profile's normal target, and the keeper uses it for repay under the session.

Every action is written as one sentence: "Repaid 42 USDT at 14:03 WIB because Nvidia earnings are in 20 hours and the token will be paused."

**F4. Position screen**
Stock value (shares × reference price, via multiplier), Cash available (computed from the profile target, never from `getAccountLiquidity`, see §7), Status, risk profile, buffer balance, next scheduled event (earnings date, next market open), event log.

**F5. MCP server**
Same engine, exposed to Claude Desktop / Code and any MCP client:

| Tool                                 | Purpose                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| `get_position(address)`              | Stock value, borrowed, LTV, status, buffer, next event        |
| `explain_risk(address)`              | Plain-language risk narrative with the numbers behind it      |
| `available_cash(address)`            | How much more can be drawn safely right now, and why not more |
| `set_policy(address, mode, profile)` | Change mode / risk profile                                    |
| `draw_cash(address, usdt)`           | Borrow within safe line (requires session token)              |
| `repay(address, usdt)`               | Manual repay                                                  |
| `market_window(ticker)`              | Session status, next open/close, halt reason                  |

All tools free in P0; write tools need an Agentic Wallet session. b402 metering is P1 (Section 5.2).

**F6. Developer Experience Report**
See Section 10.

### 5.2 P1 (if time allows)

In order: (1) **b402 metering** of `explain_risk` and `available_cash` for third-party agents, started only after every P0 flow works end to end for free, so development and testing stay frictionless. (2) Monthly salary scheduler in Cash mode. (3) Telegram alerts. (4) Ondo tokens as collateral if any lending market lists them before deadline.

### 5.3 Out of scope

Perps, cross-chain, borrowing bStocks themselves (Venus borrow cap is 0), any custodial backend, any Fortion-owned smart contract or vault, yield farming with the borrowed USDT.

## 6. Component roles (who does what)

| Component                                        | Role in Fortion                         | Concrete use                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **bStocks (BTech / Binance)**                    | The collateral asset                    | NVDAB, TSLAB, SPCXB BEP-20 tokens. Multiplier read to display shares.                                                                                                                                                                                                                                                                                                                                                                                 |
| **Venus Protocol Core Pool**                     | The lending venue                       | `vNVDAB` / `vTSLAB` / `vSPCXB` supply, `vUSDT` borrow/repay. CF 60/60/50%, LT 70/70/65%, liq. incentive 10%, supply caps 1,500 NVDAB / 236 TSLAB / 2,000 SPCXB (live 25 Sep 2026; room ~256 / ~122 / ~621). bStock borrowing paused. CF/LT are read on-chain at runtime, never hardcoded.                                                                                                                                                                                                                                                                                           |
| **Binance Web3 API: RWA Data**                   | The market brain                        | Base `https://web3.binance.com/build`, HMAC `X-OC-*` auth. `GET /api/v1/dex/market/rwa/price` (`tokenPrice` on-chain vs `referencePrice`), `/tokens` (`platformId=bstock`, 46 bStocks), `/underlying-market` (`statusInfo.reasonCode`: TRADING, MARKET_CLOSED, MARKET_PAUSED, MARKET_MAINTENANCE, ASSET_PAUSED, ASSET_LIMITED, UNSUPPORTED; `reasonMsg` e.g. cash_dividend, stock_split, earnings), `/underlying-profile` (`tokenToShareRatio`, e.g. NVDAB 1.000778; `protections.collateralReport` as trust signal). Verified live 25 Sep: `marketStatus` is null and bStocks report `TRADING` around the clock on weekdays; no earnings date; the `tabId=3` "Upcoming Earnings" filter returns all bStocks; rate limit ~5 req/s per key across endpoints. |
| **Earnings calendar**                            | When to de-risk before a halt           | Binance RWA has no earnings date, so: Nasdaq `api.nasdaq.com/api/analyst/{ticker}/earnings-date` (keyless, unofficial, Zacks data; `expected*` = company-scheduled, `estimated` = algorithm), cached 6h, plus operator overrides in `CORPORATE_ACTIONS`. Unknown time → 09:30 ET (conservative). As of 25 Sep all three are estimates: TSLA 28 Oct, SPCX 3 Nov, NVDA 18 Nov. |
| **Binance Web3 API: DeFi Data**                  | Position mirror                         | `/defi/data/position/list` for Venus positions incl. health factor as a cross-check against direct contract reads; `/defi/data/protocol/detail` for Venus TVL/APY.                                                                                                                                                                                                                                                                                    |
| **Binance Web3 API: DeFi Transaction**           | Calldata for supply/redeem              | `POST /api/v1/defi/transaction/deposit` and `/redeem` support Venus (`venus`: deposit, redeem, claim). Borrow and repay are not covered (finding for DevEx report), so they are built directly against vToken ABI with viem. |
| **Binance Web3 API: Trading**                    | Buy-side and last-resort sell           | `GET /api/v1/dex/aggregator/quote` + `/swap`. bStocks settle via **RFQ**, not a plain swap tx: swap returns EIP-712 typed data → sign → `POST /aggregator/order/submit` → poll `GET /order/{id}`. The Agentic Wallet `market-order` command wraps this for the signer. |
| **Binance Web3 API: Transaction**                | Safety net before every on-chain action | `POST /api/v1/dex/pre-transaction/simulate` (`status`, `failReason`, `balanceChanges`, `allowanceChanges`; HTTP 200 can still carry a failed status); `/pre-transaction/broadcast-transaction` (`enableMevProtection`); `GET /post-transaction/orders` for tracking. Venus results are also decoded for error codes (§7). |
| **Binance Web3 API: Wallet / Address Portfolio** | Balances and P&L                        | USDT and bStock balances, portfolio value for the position screen.                                                                                                                                                                                                                                                                                                                                                                                    |
| **Binance Web3 API: General Market Data**        | Charts                                  | Candles for the stock card.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **b402 Payments**                                | Agent-to-agent metering (P1)            | Third-party agents pay per `explain_risk` / `available_cash` call. Added after P0 is fully working for free.                                                                                                                                                                                                                                                                                                                                          |
| **Binance Agentic Wallet + Wallet Skills**       | The position itself and the only signer | MPC keyless wallet driven by the `baw` CLI (`@binance/agentic-wallet`), sign-in by QR in the Binance App. Holds bStocks, vTokens, debt, and the USDT buffer. Venus supply/borrow/repay/redeem go through `baw contract-call` (Developer Mode, enabled by the user in the App) with calldata from our builders; swaps through `market-order`. Verified 25 Sep: **no per-contract session scope** (only per-category daily USD caps, token allowlist, Developer Mode expiry), **no delegation to an external agent** (session = local CLI login, ~48h max), no in-wallet automation runtime, risk engine may block or ask for App confirmation. No existing Venus borrow/repay skill: our `fortion-venus-stocks` skill (SKILL.md + references, PR to `binance/binance-skills-hub`) fills that gap. |
| **BNB Agent Studio**                             | The keeper's brain and identity         | `bag` CLI: ERC-8004 identity, LLM on Pieverse, deploy to AgentCore. Verified 25 Sep: its wallets are `evm-local`, `twak`, `altana`; it has **no integration with a Binance Agentic Wallet session** and no built-in scheduler (the 60s loop is our own code). How the keeper reaches the signer is the open decision in §14. |
| **Next.js app**                                  | The consumer surface                    | Three numbers, two modes, event log.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **MCP server (`@fortion/mcp`)**                  | The agent surface                       | Section 5.1 F5.                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## 7. Architecture

```
 User (Agentic Wallet)            Claude / any MCP client
        │                                  │
        ▼                                  ▼
   Next.js app  ◄──────────────►   MCP server (@fortion/mcp)
        │                                  │
        └──────────► @fortion/core ◄─────────┘
                        │  (policy engine, market brain, tx builder)
     ┌──────────────────┼──────────────────────┐
     ▼                  ▼                      ▼
 Binance Web3 API   User's Agentic Wallet     BNB Agent Studio keeper
 RWA / DeFi / Trading   holds NVDAB, vNVDAB,    runs Guard loop 24/7,
 Transaction / Wallet   USDT debt + buffer      executes via scoped session
                        │
                        ▼
                  Venus Core Pool (vNVDAB, vTSLAB, vSPCXB, vUSDT)
```

> **v3.1 note:** the per-contract scoped, delegated session described in this paragraph does not exist in the Agentic Wallet today (verified 25 Sep, see §6). The execution path is the open decision in §14; this paragraph will be rewritten once it is made.

**Trust boundary = Agentic Wallet session, not a contract.** The keeper never holds user funds. It receives a scoped session from the user's Agentic Wallet limited to: allowed contracts (Venus vNVDAB/vTSLAB/vSPCXB, vUSDT, Comptroller, Binance swap router), allowed tokens, daily spend cap, expiry, and one-tap revoke. Policy (`maxLtv`, `keeperCanSell`, `bufferBps`, mode) is stored off-chain in `@fortion/core` and enforced before every call, and every call is simulated first. This removes smart-contract risk from Fortion entirely and leans on Binance's own security model, which is also the strongest "Best Use of Agentic Wallet" story.

**Direct contract calls (viem, ABI-level):** `vToken.mint`, `comptroller.enterMarkets`, `vUSDT.borrow`, `vUSDT.repayBorrow`, `vToken.redeemUnderlying`, `comptroller.getAccountLiquidity`, `comptroller.markets` (CF, LT), oracle `getUnderlyingPrice`. Every call is simulated first (Transaction API, or `eth_simulateV1` for zero-fund dry runs).

Verified Venus behaviour (25 Sep 2026): borrow is gated by the **collateral factor** and reverts above it; `getAccountLiquidity` reports headroom against the **liquidation threshold**, so it is a distance-to-liquidation number, not "cash you can still borrow". Many vToken failures return a non-zero error code instead of reverting, so every simulated result is decoded, not just its status.

## 8. User flows

**Flow A. Pledge for cash (Dina holds 0.5 NVDAB, needs $50).**
Open app → "Get cash without selling" → picks Balanced → slider shows "Up to $57 today" (Balanced target 35% of ~$95 collateral) → pick $50 → Agentic Wallet confirms supply + borrow + keeper session in one approval → $50 USDT spendable, $7.50 tagged as Safety buffer, all in her own wallet → Status: Safe. Under two minutes, no DeFi vocabulary.

**Flow B. Guard through earnings (automatic).**
Nvidia earnings Wednesday after close. Tuesday 22:00 WIB the keeper sees the earnings date (operator calendar) is under 24h away → repays from buffer to bring LTV from 35% to 25% → posts "Protecting: earnings tomorrow, loan reduced by $12, no shares sold." Thursday token resumes, price +6% → keeper restores LTV to 35% → "Credit line raised by $18, available to draw." Dina never opened the app.

**Flow C. Accumulate (Rio, 2 NVDAB).**
Mode: Accumulate → keeper borrows $130 USDT, buys 0.68 NVDAB via Trading API (guarded), re-supplies → position now 2.68 NVDAB against $130 debt, LTV 25% → keeper holds. Stock +15% → borrows again within target, buys more. Stock -20% on a gap → repay from buffer; if still above 58%, sells 0.1 NVDAB to bring LTV to 40% (default on; Rio could have turned it off).

**Flow D. Claude via MCP.**
"How safe is my Nvidia loan this weekend?" → `explain_risk` → "LTV 31%, target for weekends is 30%, buffer covers a 22% drop before any share would be sold. Next risk event: market close in 3h."

## 9. Success criteria

| Judging weight | Evidence in submission                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Technical 30%  | Live mainnet Venus position inside an Agentic Wallet; custom Wallet Skill for Venus; simulated + broadcast txs through Binance API; Agent Studio keeper log; policy engine unit tests |
| Creativity 25% | A pain point no other team is likely to touch (stock-collateral liquidation), positioned as a consumer product                                                                        |
| DevEx 25%      | Section 10                                                                                                                                                                            |
| UX 20%         | Two-minute pledge flow, three-number dashboard, every agent action explained                                                                                                          |

## 10. Developer Experience Report plan

Kept as `DEVEX_REPORT.md` from day 1, filled into the official template at the end. Findings already expected:

1. DeFi Transaction API builds deposit/redeem but not borrow/repay for lending protocols; we had to go ABI-direct and only use the API for supply/withdraw and simulation.
2. Whether DeFi Data `position/list` reflects Venus bStocks markets and how its health factor compares to `getAccountLiquidity`.
3. How RWA `underlying-market` status codes lead the actual Venus oracle behaviour during halts (does the price freeze, does Dynamic Protection trigger).
4. Venus supply caps as a hard ceiling for a consumer product (live 25 Sep: 1,500 NVDAB, 236 TSLAB, 2,000 SPCXB; different from launch coverage). `getAccountLiquidity` measures against LT while borrow is gated by CF.
5. Agentic Wallet: whether existing DeFi skills cover Venus borrow/repay or a custom skill is required; session scope granularity (per-contract allowlist?), lifetime, and how an external Agent Studio keeper can hold a session.
6. Agent Studio: scheduling granularity, cost per day for a 60s loop, gas self-funding behaviour.

## 11. Timeline (17 days from 24 Sep)

| Days      | Deliverable                                                                                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 24–26 Sep | ✅ 25 Sep: supply open, caps have room, USDT borrow proven by mainnet dry run, Web3 API live. RWA monitor running from 25 Sep (all 46 bStocks + Venus oracle) to capture 26 Sep maintenance, the weekend and MUB earnings on 30 Sep. |
| 27–30 Sep | `@fortion/core`: RWA/market brain, policy engine, Venus tx builders (viem), simulate + broadcast wrappers. CLI test with $20 NVDAB.                                                                  |
| 1–3 Oct   | Custom Wallet Skill `fortion-venus-stocks` (supply/borrow/repay/redeem on Venus, simulate-first) + keeper session flow with Agentic Wallet. End-to-end pledge on mainnet from a real Agentic Wallet. |
| 4–6 Oct   | Agent Studio keeper: Guard loop, event log, alerts. Agentic Wallet onboarding + buy flow.                                                                                                            |
| 7–8 Oct   | Next.js app (three screens) + MCP server + npm publish.                                                                                                                                              |
| 9–10 Oct  | Demo video, DevEx report, README, deployed link. Submit 10 Oct with a one-day buffer.                                                                                                                |

## 12. Demo video storyboard (4 min)

0:00 Problem: a holder who needs $50 and the only button is Sell. 30s on why stock collateral liquidations are nastier (gap, halt, oracle).
0:40 Dina pledges 0.5 NVDAB, gets USDT in under two minutes, never sees a DeFi term.
1:40 Time-lapse of the keeper around an earnings halt (status sequence replayed from the real MUB halt captured by the RWA monitor, applied to Dina's NVDAB loan): repay before, restore after, every step explained. Show the Agent Studio agent identity and log.
2:40 Rio's Accumulate mode: credit line rising with the stock.
3:10 Claude asks the MCP how safe the loan is this weekend.
3:35 Architecture + top three DevEx findings.
3:55 Close.

## 13. Risks

| Risk                                                                                                              | Mitigation                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Venus supply caps already full                                                                                    | Checked 25 Sep: room on all three (tightest: TSLAB ~122). Re-check before demo. Fallback: demo on whichever bStock has room; ListaDAO as second venue if it lists bStocks.                                            |
| USDT borrow not enabled against bStocks collateral                                                                | Resolved 25 Sep: borrow works for NVDAB, TSLAB, SPCXB (`simulate:pledge`). No pivot needed.                                                                                                                              |
| One set of thresholds does not fit every stock (SPCXB LT 65% vs 70%)                                              | Thresholds scale with each market's on-chain LT; the user picks the risk profile. Invariants unit-tested.                                                                                                               |
| RWA API has no earnings / corporate-action date                                                                   | Nasdaq earnings calendar (confirmed dates only) + operator overrides drive the 24h pre-halt repay; RWA `ASSET_PAUSED` / `ASSET_LIMITED` still catches any halt the calendar misses. Nasdaq endpoint is unofficial: if it breaks, operator dates still work. |
| No NVDA / TSLA / SPCX earnings before the 11 Oct deadline (earliest: TSLA est. 28 Oct)                              | Flow B cannot be filmed live. Evidence of real halt behaviour comes from the RWA monitor (`monitor:rwa`) on other bStocks: Binance maintenance 26 Sep 10:50–14:00 UTC and Micron (MUB) earnings 30 Sep after close. The demo time-lapse replays that observed status sequence on NVDAB. |
| Oracle freezes during halt so LTV cannot be read                                                                  | Policy engine uses reference price from RWA API as shadow oracle and acts on the more conservative of the two.                                                                                                         |
| Agentic Wallet session cannot be delegated to an external Agent Studio keeper, or has no Venus borrow/repay skill | **Materialized 25 Sep** (see §6): no delegation, no per-contract scope, no in-wallet automation, ~48h sign-in. The custom skill is still needed and planned. Execution path decided in §14. |
| Scope                                                                                                             | P0 frozen. Accumulate mode limited to 2 loops.                                                                                                                                                                         |

## 14. Open questions

Decided 24 Sep: team name = Fortion; keeper last-resort sell = default ON (user can disable); b402 = P1, only after every P0 flow works for free. Decided 25 Sep: Guard thresholds are a user-chosen risk profile (Steady / Balanced / Bold), Balanced by default, scaled per stock by LT.

**Open (25 Sep): keeper execution path**, given the Agentic Wallet findings in §6:
1. *Hybrid:* the keeper runs `baw` on its host after the user signs in by QR, sends Venus calldata via `contract-call`; Agent Studio stays the identity + brain. Keeps "no Fortion contracts". Costs: re-sign-in every ~48h, limits are per-category daily caps, not per-contract.
2. *Delegate contract:* a small on-chain allowlist contract the Agent Studio key may call. Stronger scoping, but breaks the "no Fortion contracts" principle (§5.3) and adds contract risk.
