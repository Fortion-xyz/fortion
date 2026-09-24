# Fortion

- Spec is `docs/prd.md`. P0 is frozen; don't build P1 unless asked.
- `frontend/` and `backend/` are separate pnpm packages. Frontend never imports backend code; it calls the HTTP API.
- Business logic lives in `backend/src/core/`. `api/`, `keeper/`, `mcp/` are thin adapters over `core/position.ts`.
- `core/policy.ts` stays pure (no I/O) and every rule change gets a case in `policy.test.ts`. Thresholds come from the user's risk profile scaled by on-chain LT; never hardcode a single LTV.
- No Fortion smart contracts, no custody. Every write is simulated first, then signed by the user's Agentic Wallet.
- Log DevEx findings in `docs/DEVEX_REPORT.md` as they happen. If a finding contradicts `docs/prd.md`, fix the PRD in the same PR.
- Checks: `pnpm test && pnpm typecheck` from root.
