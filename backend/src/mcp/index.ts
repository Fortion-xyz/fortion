#!/usr/bin/env node
// MCP server (PRD §5.1 F5), stdio. Read tools only; draw_cash / repay / set_policy need the Agentic Wallet session.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TICKERS } from "../core/config.ts";
import { getMarketWindow } from "../core/market.ts";
import { getPosition, parseAddress, parseTicker, type Position } from "../core/position.ts";

const server = new McpServer({ name: "fortion", version: "0.1.0" });
const account = { address: z.string().describe("BSC wallet address"), ticker: z.enum(TICKERS).default("NVDAB") };
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const load = (a: { address: string; ticker: string }) => getPosition(parseAddress(a.address), parseTicker(a.ticker));

server.registerTool(
  "get_position",
  { description: "Stock value, borrowed, LTV, status, buffer and next event", inputSchema: account },
  async (a) => text(await load(a)),
);

server.registerTool(
  "explain_risk",
  { description: "Plain-language risk narrative with the numbers behind it", inputSchema: account },
  async (a) => text(explain(await load(a))),
);

server.registerTool(
  "available_cash",
  { description: "How much more USDT can be drawn safely right now, and why not more", inputSchema: account },
  async (a) => {
    const p = await load(a);
    return text(`${p.availableCash.toFixed(2)} USDT available. ${p.decision.reason}`);
  },
);

server.registerTool(
  "market_window",
  { description: "Session status, halt reason and spread for a bStock", inputSchema: { ticker: account.ticker } },
  async ({ ticker }) => text(await getMarketWindow(ticker)),
);

function explain({ snapshot: s, decision: d, market: m, policy }: Position): string {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  // Drop that pushes LTV to the last-resort line, after the buffer is spent on repay.
  const debtAfterBuffer = s.debtUsd - s.bufferUsd;
  const cushion = debtAfterBuffer <= 0 ? 1 : 1 - debtAfterBuffer / (d.thresholds.lastResort * s.collateralUsd);
  const next =
    s.hoursToCorporateAction !== null ? `corporate action in ${Math.round(s.hoursToCorporateAction)}h` :
    s.minutesToWeekendClose !== null ? `weekend close in ${s.minutesToWeekendClose} min` : `market is ${m.status}`;
  const earnings = m.nextEarnings
    ? ` Next earnings: ${m.nextEarnings.at.toISOString().slice(0, 10)} (${m.nextEarnings.confirmed ? "confirmed" : "estimate, not acted on yet"}).`
    : "";
  return `LTV ${pct(d.ltv)}, target ${pct(d.targetLtv)} (${policy.profile} profile), status ${d.status}. ` +
    `Buffer covers a ${pct(Math.max(0, cushion))} drop before any share would be sold. Next risk event: ${next}.${earnings}`;
}

await server.connect(new StdioServerTransport());
