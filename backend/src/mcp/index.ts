#!/usr/bin/env node
// MCP server entry (stdio) for Claude Desktop / Code and any MCP client.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execute } from "../core/executor.ts";
import { getMarketWindow } from "../core/market.ts";
import { getPosition, setPolicy } from "../core/position.ts";
import { previewDraw, previewRepay } from "../core/preview.ts";
import { simulate } from "../core/simulate.ts";
import { resolveSigner } from "../core/wallet.ts";
import { createServer } from "./server.ts";

const server = createServer({
  position: getPosition,
  market: getMarketWindow,
  setPolicy,
  previewDraw,
  previewRepay,
  async sign(account, calls) {
    const { signer, why } = await resolveSigner(account);
    if (!signer) return `Not signed: ${why}`;
    const r = await execute(account, calls.map((call) => ({ kind: "call", call })), { signer, simulate });
    return [`${r.outcome}${r.error ? `: ${r.error}` : ""}`, ...r.txHashes.map((h) => `https://bscscan.com/tx/${h}`)].join("\n");
  },
});
await server.connect(new StdioServerTransport());
