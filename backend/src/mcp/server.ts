// MCP server (PRD §5.1 F5). Read tools + write tools; writes preview by default and sign only with
// `confirm: true`, EXECUTE=1 and this host signed in to the user's Agentic Wallet.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Address } from "viem";
import { TICKERS, type Ticker } from "../core/config.ts";
import type { MarketWindow } from "../core/market.ts";
import { PROFILES, type Policy, type RiskProfile } from "../core/policy.ts";
import { parseAddress, parseTicker, type Position } from "../core/position.ts";
import type { previewDraw, previewRepay } from "../core/preview.ts";
import type { Call } from "../core/venus-tx.ts";

export interface McpDeps {
  position: (a: Address, t: Ticker) => Promise<Position>;
  market: (t: Ticker) => Promise<MarketWindow>;
  setPolicy: (a: Address, p: Partial<Policy>) => Policy;
  previewDraw: typeof previewDraw;
  previewRepay: typeof previewRepay;
  /** Signs the calls through the Agentic Wallet; returns a one-line outcome. */
  sign: (a: Address, calls: Call[]) => Promise<string>;
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const usd = (x: number) => `${x.toFixed(2)} USDT`;

export function createServer(deps: McpDeps) {
  const server = new McpServer({ name: "fortion", version: "0.2.0" });
  const account = { address: z.string().describe("BSC wallet address"), ticker: z.enum(TICKERS).default("NVDAB") };
  const confirm = z.boolean().default(false).describe("Sign with the Agentic Wallet. Without it the call is only previewed and simulated.");
  const load = (a: { address: string; ticker: string }) => deps.position(parseAddress(a.address), parseTicker(a.ticker));

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
    { description: "Session status, halt reason, real stock price and spread for a bStock", inputSchema: { ticker: account.ticker } },
    async ({ ticker }) => text(await deps.market(ticker)),
  );
  server.registerTool(
    "set_policy",
    {
      description: "Change the Guard's risk profile (conservative | balanced | growth), mode (cash | accumulate) or last-resort selling",
      inputSchema: {
        address: account.address,
        profile: z.enum(Object.keys(PROFILES) as [RiskProfile, ...RiskProfile[]]).optional(),
        mode: z.enum(["cash", "accumulate"]).optional(),
        keeperCanSell: z.boolean().optional(),
      },
    },
    async ({ address, ...p }) => text(deps.setPolicy(parseAddress(address), Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)))),
  );

  const writeResult = async (a: Address, summary: string, q: { calls: Call[]; simulation: { ok: boolean; steps: { error: string | null }[] } }, yes: boolean) => {
    if (!q.simulation.ok) return text(`${summary}\nSimulation failed, nothing signed: ${q.simulation.steps.find((s) => s.error)?.error}`);
    if (!yes) return text(`${summary}\nPreview only (simulated OK). Call again with confirm: true to sign.`);
    return text(`${summary}\n${await deps.sign(a, q.calls)}`);
  };
  server.registerTool(
    "draw_cash",
    { description: "Borrow USDT within the safe line (15% stays as safety buffer)", inputSchema: { ...account, usdt: z.number().positive().optional().describe("spendable USDT; omit for the maximum"), confirm } },
    async (a) => {
      const addr = parseAddress(a.address);
      const q = await deps.previewDraw(addr, parseTicker(a.ticker), a.usdt);
      if (q.maxCash <= 0) return text("Nothing to draw right now: no stock pledged, the loan is already at its limit, or the stock is paused.");
      return writeResult(addr, `Draw ${usd(q.cash)} + ${usd(q.safetyBuffer)} safety buffer (borrow ${usd(q.borrow)}); up to ${usd(q.maxCash)} today.`, q, a.confirm);
    },
  );
  server.registerTool(
    "repay",
    { description: "Repay USDT on a stock's loan", inputSchema: { ...account, usdt: z.union([z.number().positive(), z.literal("all")]), confirm } },
    async (a) => {
      const addr = parseAddress(a.address);
      const q = await deps.previewRepay(addr, parseTicker(a.ticker), a.usdt);
      return writeResult(addr, `Repay ${usd(q.repay)}; loan after ${usd(q.debtAfter)}.`, q, a.confirm);
    },
  );
  return server;
}

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

