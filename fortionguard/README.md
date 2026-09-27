# Fortion Guard: BNB Agent Studio agent

The Fortion keeper's **on-chain identity and public face** (PRD §6 "BNB Agent Studio"), scaffolded
with `bag` 0.0.14. It sells one thing: a **plain-language risk report** for a USDT loan against
tokenized stocks on Venus.

- **Service:** send a BSC wallet address (+ optionally NVDAB / TSLAB / SPCXB) → LTV vs target, how big
  a drop the safety buffer covers before any share is sold, the next risk event. Code:
  [`app/agent/src/fortion.ts`](app/agent/src/fortion.ts), tests in `app/agent/test/`.
- **Deterministic, no LLM:** the report comes from the Fortion backend (`GET /explain/:address`), the
  same engine the app, keeper and MCP server use. Set `FORTION_API_URL` (default `http://localhost:4000`).
- **Faces:** A2A (ERC-8183 jobs) + x402, **FREE** (`[payments.seller].price_usd = "0"`, so x402 is an
  anonymous passthrough). Raising the price turns on B402 metering (PRD P1).
- **Custody split:** this Agent's own wallet (`.studio/wallets/`, gitignored) signs only its identity
  and commerce messages. **Users' loans are signed by their own Agentic Wallet on the keeper host
  (`baw`), never by this Agent.**

```sh
cd fortionguard && pnpm install
(cd app/agent && pnpm test)                                    # service tests
(cd app/agent && FORTION_API_URL=http://localhost:4000 bag dev --port 9100)
curl -s -XPOST localhost:9100/x402 -H 'content-type: application/json' \
  -d '{"prompt":"How safe is my Nvidia loan this weekend? 0x…"}'
```

Still needs the owner: fund the agent wallet with ~0.02 BNB and run `bag erc8004 register`
(ERC-8004 identity on BSC mainnet), then `bag deploy --provider aws` (AWS credentials + Docker).

---

# fortionguard

A BNB Chain seller agent workspace scaffolded by `bag init` (bnbagent-studio).

- `app/agent/` — the valuable Agent + SOLE on-chain signer (TypeScript, `src/`).
- `.studio/` — secrets (encrypted keystore + .env.local); NEVER commit it.
- `bag dev` — run the agent locally; `bag doctor` — readiness checks.
- `bag deploy --provider aws` — deploy to AWS Bedrock AgentCore (uses the self-rendered `agentcore/` descriptor).

In Claude Code / Cursor, type `/bnbagent-studio` — the skill drives every step.
