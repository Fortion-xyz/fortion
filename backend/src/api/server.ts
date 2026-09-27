import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { config } from "../core/config.ts";
import { PROFILES, type RiskProfile } from "../core/policy.ts";
import { getMarketWindow } from "../core/market.ts";
import { previewDraw, previewPledge, previewRepay } from "../core/preview.ts";
import { listStocks } from "../core/stocks.ts";
import { explain } from "../core/explain.ts";
import { db, getPolicy, getPosition, InputError, parseAddress, parseTicker, setPolicy } from "../core/position.ts";

const policyBody = z.object({
  mode: z.enum(["cash", "accumulate"]).optional(),
  profile: z.enum(Object.keys(PROFILES) as [RiskProfile, ...RiskProfile[]]).optional(),
  keeperCanSell: z.boolean().optional(),
});

const account = { address: z.string(), ticker: z.string().optional() };
const pledgeBody = z.object({ ...account, amount: z.string().regex(/^\d+(\.\d{1,18})?$/, "amount of stock, e.g. \"0.5\""), cash: z.number().positive().optional() });
const drawBody = z.object({ ...account, cash: z.number().positive().optional() });
const repayBody = z.object({ ...account, usdt: z.union([z.number().positive(), z.literal("all")]) });

async function body<T extends z.ZodType>(c: { req: { json(): Promise<unknown> } }, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new InputError(z.prettifyError(parsed.error));
  return parsed.data;
}

const app = new Hono()
  .use(cors())
  .get("/health", (c) => c.json({ ok: true }))
  .get("/position/:address", async (c) =>
    c.json(await getPosition(parseAddress(c.req.param("address")), parseTicker(c.req.query("ticker")))),
  )
  .post("/preview/pledge", async (c) => {
    const b = await body(c, pledgeBody);
    return c.json(await previewPledge(parseAddress(b.address), parseTicker(b.ticker), b.amount, b.cash));
  })
  .post("/preview/draw", async (c) => {
    const b = await body(c, drawBody);
    return c.json(await previewDraw(parseAddress(b.address), parseTicker(b.ticker), b.cash));
  })
  .post("/preview/repay", async (c) => {
    const b = await body(c, repayBody);
    return c.json(await previewRepay(parseAddress(b.address), parseTicker(b.ticker), b.usdt));
  })
  .get("/stocks", async (c) => c.json(await listStocks()))
  .get("/profiles", (c) => c.json(PROFILES))
  .get("/policy/:address", (c) => c.json(getPolicy(parseAddress(c.req.param("address")))))
  .get("/events/:address", (c) => {
    const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
    return c.json(db.events(parseAddress(c.req.param("address")), limit));
  })
  .get("/explain/:address", async (c) =>
    c.text(explain(await getPosition(parseAddress(c.req.param("address")), parseTicker(c.req.query("ticker"))))),
  )
  .get("/market/:ticker", async (c) => c.json(await getMarketWindow(parseTicker(c.req.param("ticker")))))
  .put("/policy/:address", async (c) => {
    const body = policyBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new InputError(z.prettifyError(body.error));
    return c.json(setPolicy(parseAddress(c.req.param("address")), body.data));
  })
  .onError((err, c) => {
    if (err instanceof InputError) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: err.message }, 502); // upstream (RPC / Binance) failures
  });

serve({ fetch: app.fetch, port: config.port }, (i) => console.log(`api on http://localhost:${i.port}`));
