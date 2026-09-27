# Backend + Agent Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything behind the app works for real: the Guard reads a true stock reference price, remembers settings and events, previews and **executes** Venus + swap actions through the user's Binance Agentic Wallet (`baw`), and is usable from the HTTP API, a CLI, MCP, and a Wallet Skill.

**Architecture:** `backend/src/core` stays the only place with business logic. A new `Signer` boundary (`core/wallet.ts`) hides *how* a call gets signed: `DryRunSigner` (simulate only) and `BawSigner` (Agentic Wallet CLI: `contract-call preview → execute`, `market-order swap`). An `Executor` runs a `Plan` step by step, waiting for each receipt, and writes every outcome to a small JSON store that the API serves as the activity feed. Execution path = PRD §14 option 1 (hybrid), decided 27 Sep.

**Tech Stack:** Node 25 + TypeScript (tsx), viem, Hono, @modelcontextprotocol/sdk, zod, `node:test`; `baw` CLI (`@binance/agentic-wallet` ≥ 1.10.0) at runtime.

**Spec:** `docs/prd.md` (v3.2), issues #16–#19, `docs/DEVEX_REPORT.md`.

## Global Constraints

- No Fortion smart contracts, no custody (PRD §5.3). Every write is simulated first (PRD §7).
- Users never see LTV / health factor / vToken in user-facing text (PRD §3).
- Buffer: 15% of each borrow stays in the wallet (`bufferBps` 1500).
- Accumulate mode: max 2 loops; last-resort sell brings LTV to the profile's sell-down line, never more.
- Binance Web3 API: ≤ 4 req/s per process (key limit ~5 req/s).
- `backend/.env` and any key material never committed.
- Checks before every PR: `pnpm test && pnpm typecheck`.

## Review Focus

1. **A step of a multi-tx plan fails halfway** (e.g. `mint` mined, `borrow` rejected) → executor stops, records what landed, never retries blindly; next tick re-plans from real on-chain state. Test in Task 6.
2. **`baw` needs App confirmation** (`requireConfirmation: true` / `PENDING_CONFIRMATION`) → event recorded as *waiting for you in the Binance App*, keeper does not stack more actions for that account. Test in Task 6.
3. **The Guard would repeat the same action every 60s** while a tx is pending or the chain lags → per-account cooldown + in-flight lock. Test in Task 7.
4. **Weekend / holiday: stock closed, token still trading** → spread uses the last real close, not RWA `referencePrice` (which is derived from the token price). Test in Task 1.
5. **Nasdaq or `baw` unavailable** → Guard keeps deciding with what it has, marks the gap in the event log, never signs on stale data older than 15 min. Test in Tasks 1 and 7.

---

### Task 1: True reference price (Nasdaq last sale) for spread + shadow oracle

**Why:** Monitor data (25–27 Sep) shows RWA `referencePrice` = `tokenPrice / tokenToShareRatio` exactly, and status stays `TRADING` on weekends and during broker maintenance. The F3 spread rule and the §13 shadow oracle need the real stock price.

**Files:** Create `backend/src/core/quote.ts`, `backend/src/core/quote.test.ts`; modify `backend/src/core/market.ts`, `backend/src/core/calendar.ts` (share `UNDERLYING`), `docs/prd.md`, `docs/DEVEX_REPORT.md`.

**Interfaces:**
- Produces: `parseNasdaqQuote(json): { priceUsd: number; asOf: string; marketOpen: boolean } | null`, `lastStockPrice(ticker): Promise<{ priceUsd; asOf; marketOpen } | null>` (60s cache, stale-on-error).
- `MarketWindow` gains `stockUsd: number | null`; `spread` = |tokenPrice − stockUsd × tokenToShareRatio| / (stockUsd × ratio); falls back to RWA reference when Nasdaq is down.

- [ ] Test: real sample `{"primaryData":{"lastSalePrice":"$225.07",…},"marketStatus":"Closed"}` → `{ priceUsd: 225.07, marketOpen: false }`
- [ ] Test: spread on a Saturday with token 224.44 vs close 225.07 ≈ 0.28%
- [ ] Implement, run tests, update PRD F3/§6/§13 and DevEx (monitor findings), commit.

### Task 2: Plain-language Guard reasons (#19)

**Files:** Modify `backend/src/core/policy.ts`, `backend/src/core/policy.test.ts`.
- [ ] Test: no reason string matches `/\d+%/` or `LTV`; each action kind has a user sentence.
- [ ] Implement sentences keyed by action + cause; keep numbers in fields. Commit.

### Task 3: JSON store for policies and events + `GET /events/:address` (#17)

**Files:** Create `backend/src/core/store.ts`, `store.test.ts`; modify `position.ts` (policies), `api/server.ts`.
**Interfaces:** `loadStore(path)`, `store.getPolicy(a)`, `store.setPolicy(a, p)`, `store.addEvent(e: GuardEvent)`, `store.events(a, limit)`; `GuardEvent = { at, account, ticker, kind, usd, status, reason, simulated, txHashes: string[], outcome: "done" | "pending-app" | "failed" | "blocked" | "dry-run", error? }`. Atomic write (tmp + rename). Path `FORTION_DATA_DIR` (default `backend/data`).
- [ ] Tests: round-trip, survives reload, atomic write leaves valid JSON, events newest-first and capped per account (500).
- [ ] Wire API, commit.

### Task 4: `GET /stocks` (#16)

**Files:** Modify `market.ts` (export batch), `api/server.ts`; create `core/stocks.ts`.
- [ ] One RWA `/tokens` call for names/logos, `getMarketWindow` per ticker (cached), Venus supply room via `riskParams`-style reads.
- [ ] Smoke-test live, commit.

### Task 5: Previews (#18)

**Files:** Create `core/preview.ts`, `preview.test.ts`; modify `api/server.ts`.
**Interfaces:** `previewPledge({ account, ticker, amount, mode })`, `previewDraw({ account, ticker, usdt })`, `previewRepay({ account, ticker, usdt })` → `{ collateralUsd, maxCashToday, cash, safetyBuffer, steps: string[], simulation: Simulation }`.
- [ ] Test (pure part): max cash = profile target × collateral − debt; buffer = 15%.
- [ ] Live simulation with the real wallet state, commit.

### Task 6: Signer + Executor (`baw`)

**Files:** Create `core/wallet.ts`, `core/executor.ts`, `executor.test.ts`.
**Interfaces:**
- `interface Signer { kind: "dry-run" | "baw"; send(call: Call): Promise<SendResult>; swap(s: Swap): Promise<SendResult> }`, `SendResult = { status: "mined"; txHash } | { status: "pending-app"; orderId } | { status: "failed"; error }`.
- `BawSigner(from, run = execFile)` → `baw contract-call preview --binanceChainId 56 --from --to --inputData --json`, abort on `success:false` or non-empty `risks.riskDetails` of type `RISK`, then `execute --requestId`, then `client.waitForTransactionReceipt`.
- `execute(account, steps, signer): Promise<GuardEvent-outcome + txHashes>`: sequential, stops at first non-mined result.
- [ ] Tests with a fake `run`: happy path 2 calls → 2 hashes; preview blocked → failed, 2nd call never sent; `PENDING_CONFIRMATION` → pending-app and stop.
- [ ] Commit.

### Task 7: Keeper executes (sell + accumulate via `market-order swap`)

**Files:** Modify `core/plan.ts` (+ swap steps), `keeper/index.ts`; tests in `plan.test.ts`, new `keeper/guard.test.ts` for cooldown.
- [ ] `EXECUTE=1` enables `BawSigner`; otherwise dry run. Cooldown 10 min per account+ticker after any non-hold action, skip while an event is `pending-app`.
- [ ] Sell: `swap bStock → USDT` then repay. Accumulate borrow: borrow → swap USDT → bStock → supply (loop count ≤ 2 tracked in store).
- [ ] Commit, PR.

### Task 8: `fortion` CLI for users/operators

**Files:** Create `backend/src/cli/index.ts`; `package.json` bin `fortion`.
Commands: `status <addr>`, `pledge <ticker> <amount> [--cash <usdt>] [--mode cash|accumulate]`, `draw <ticker> <usdt>`, `repay <ticker> <usdt|all>`, `withdraw <ticker> <amount>`, `calldata <action> …` (prints `{to,data}` for the Wallet Skill), `signin` (wraps `baw auth signin/verify`).
- [ ] Every write: preview (simulate) → print plain summary → `--yes` required to execute.

### Task 9: MCP write tools

**Files:** Modify `backend/src/mcp/index.ts`: `set_policy`, `draw_cash`, `repay` (require `EXECUTE=1` + connected `baw`; otherwise return the preview).

### Task 10: Wallet Skill `fortion-venus-stocks`

**Files:** Create `skills/fortion-venus-stocks/SKILL.md` + `references/{supply,borrow,repay,withdraw,safety}.md`, following the Skills Hub format (frontmatter `name`, `description`, `metadata.version`, `metadata.author`, `metadata.openclaw.requires.bins: [baw, npx]`). Uses `fortion calldata …` + `baw contract-call preview/execute`.

### Task 11: BNB Agent Studio keeper identity

Load the `bnbagent-studio` skill; register the keeper with an ERC-8004 identity and expose `explain_risk` as its service; document the runtime split (Studio = identity + brain, `baw` host = signer).

### Task 12: Operator docs + deploy

`README` operator guide (sign-in, EXECUTE, WATCH_ADDRESSES, data dir), Dockerfile for API + keeper, `.env.example` complete.
