import { serve } from "@hono/node-server";
import { config } from "../core/config.ts";
import { createApp } from "./app.ts";

const app = createApp({ apiToken: config.apiToken, corsOrigins: config.corsOrigins });
serve({ fetch: app.fetch, port: config.port }, (i) => console.log(`api on http://localhost:${i.port}`));
