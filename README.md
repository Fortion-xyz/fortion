# Fortion

Pledge tokenized stocks (bStocks) on Venus instead of selling them; an agent guards the loan. Spec: [docs/prd.md](docs/prd.md).

## Layout

```
frontend/            Next.js app (consumer UI). Talks to backend over HTTP only.
backend/
  src/core/          policy engine, market brain, Venus reads — no I/O framework code
  src/api/           HTTP API (Hono) for the frontend
  src/keeper/        Guard loop (runs on BNB Agent Studio)
  src/mcp/           MCP server for Claude / any MCP client
  src/cli/           `fortion` CLI (status, pledge, draw, repay, withdraw, signin, calldata)
  scripts/           one-off on-chain checks + RWA monitor
skills/
  fortion-venus-stocks/  Binance Wallet Skill (Venus borrow/repay for bStocks), zero-dependency
fortionguard/        BNB Agent Studio agent (ERC-8004 identity, A2A + x402 risk-report service)
docs/                PRD, DevEx report, plans
```

## Run (development)

```sh
pnpm install
cp backend/.env.example backend/.env         # add your Binance Web3 API key + secret
cp frontend/.env.example frontend/.env.local
pnpm dev:api        # HTTP API on :4000
pnpm dev:web        # app on :3000
pnpm dev:keeper     # Guard loop (dry run unless EXECUTE=1)
pnpm test && pnpm typecheck
```

## Go live with a real Agentic Wallet (operator guide)

1. **Sign in** the keeper host to the user's Binance Agentic Wallet, and enable **Developer Mode** in
   the Binance App (required for Venus calls):
   ```sh
   pnpm fortion signin          # shows a pairing code + QR link, waits for the App confirmation
   ```
2. **Pledge** (preview first, then sign). Every write prints each wallet step with its simulation:
   ```sh
   pnpm fortion pledge <wallet> NVDAB 0.5 --cash 30             # preview only
   EXECUTE=1 pnpm fortion pledge <wallet> NVDAB 0.5 --cash 30 --yes
   ```
3. **Start the Guard** for that wallet:
   ```sh
   WATCH_ADDRESSES=<wallet> EXECUTE=1 pnpm dev:keeper
   pnpm fortion events <wallet>        # what it did and why, one sentence each
   ```
4. **Revoke** anytime: `baw auth signout` (or sign out in the Binance App). The keeper falls back to a
   dry run.

Signing needs all three: `EXECUTE=1`, a signed-in host, and the address being the signed-in wallet.
Binance's own limits (daily caps, Developer Mode expiry, App confirmations) stay in force.

### Other surfaces

- **MCP** (Claude Desktop / Code): add to the MCP config
  ```json
  { "mcpServers": { "fortion": { "command": "pnpm", "args": ["--dir", "<repo>/backend", "--silent", "mcp"] } } }
  ```
  Tools: `get_position`, `explain_risk`, `available_cash`, `market_window`, `set_policy`, `draw_cash`, `repay`.
  Write tools only preview unless called with `confirm: true`.
- **Wallet Skill**: `skills/fortion-venus-stocks/` (for any agent using `baw`)
- **Agent Studio agent**: `fortionguard/` (see its README)

### HTTP API (for the frontend)

| Endpoint | Returns |
| --- | --- |
| `GET /position/:address?ticker=` | position, market, Guard decision, cash available |
| `GET /stocks` | catalog cards: prices, real stock price, session, supply room, buyAllowed |
| `GET /market/:ticker` | session, pause, real stock price, spread, next earnings |
| `GET /events/:address?limit=` | the Guard's activity log |
| `GET /explain/:address?ticker=` | risk narrative (text) |
| `GET /profiles`, `GET/PUT /policy/:address` | risk profiles, user settings |
| `POST /preview/pledge` `{address, ticker, amount, cash?}` | numbers + steps + calls + simulation |
| `POST /preview/draw` `{address, ticker, cash?}` · `POST /preview/repay` `{address, ticker, usdt\|"all"}` | same |

## On-chain checks (no funds needed)

```sh
pnpm --filter backend check:venus                     # caps, CF/LT, paused actions, oracle prices
pnpm --filter backend simulate:pledge NVDAB 1 0.35    # dry-run pledge → repay → withdraw on live mainnet state
pnpm --filter backend check:rwa                       # raw Binance RWA responses (needs API key in backend/.env)
```
