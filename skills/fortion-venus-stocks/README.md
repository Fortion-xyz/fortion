# fortion-venus-stocks

A Binance Wallet Skill for borrowing USDT against tokenized stocks (bStocks) on Venus Core Pool,
signed with a Binance Agentic Wallet through `baw contract-call`. See [SKILL.md](SKILL.md).

- `scripts/calldata.mjs`: zero-dependency encoder for supply / borrow / repay / withdraw calls
  (Node ≥ 18). Its output is tested against viem in the Fortion repo (`backend/src/cli/skill.test.ts`).
- `references/`: per-action notes and the stock-specific safety rules.

Part of [Fortion](https://github.com/Fortion-xyz/fortion). Intended for contribution to
[binance/binance-skills-hub](https://github.com/binance/binance-skills-hub).
