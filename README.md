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
  scripts/           one-off on-chain checks
docs/                PRD, DevEx report
```

## Run

```sh
pnpm install
cp backend/.env.example backend/.env        # fill Binance Web3 API
cp frontend/.env.example frontend/.env.local
pnpm dev:api        # :4000
pnpm dev:web        # :3000
pnpm dev:keeper
pnpm test && pnpm typecheck
```

MCP (Claude Desktop / Code): `pnpm --filter backend mcp`.

## On-chain checks (no funds needed)

```sh
pnpm --filter backend check:venus                     # caps, CF/LT, paused actions, oracle prices
pnpm --filter backend simulate:pledge NVDAB 1 0.35    # dry-run pledge → repay → withdraw on live mainnet state
pnpm --filter backend check:rwa                       # raw Binance RWA responses (needs API key in backend/.env)
```
