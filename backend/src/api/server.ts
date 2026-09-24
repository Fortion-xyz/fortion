import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { config } from "../core/config.ts";
import { PROFILES, type RiskProfile } from "../core/policy.ts";
import { getMarketWindow } from "../core/market.ts";
import { getPolicy, getPosition, InputError, parseAddress, parseTicker, setPolicy } from "../core/position.ts";

const policyBody = z.object({
  mode: z.enum(["cash", "accumulate"]).optional(),
  profile: z.enum(Object.keys(PROFILES) as [RiskProfile, ...RiskProfile[]]).optional(),
  keeperCanSell: z.boolean().optional(),
});

const app = new Hono()
  .use(cors())
  .get("/health", (c) => c.json({ ok: true }))
  .get("/position/:address", async (c) =>
    c.json(await getPosition(parseAddress(c.req.param("address")), parseTicker(c.req.query("ticker")))),
  )
  .get("/profiles", (c) => c.json(PROFILES))
  .get("/policy/:address", (c) => c.json(getPolicy(parseAddress(c.req.param("address")))))
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
