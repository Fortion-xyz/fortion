// Binance Web3 API client (https://web3.binance.com/en/dev-docs/authentication).
// Signature: Base64(HMAC-SHA256(timestamp + METHOD + requestPath + body, secret)); requestPath includes /build.
import { createHmac } from "node:crypto";
import { config } from "./config.ts";

export function sign(timestamp: string, method: "GET" | "POST", requestPath: string, body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}${method}${requestPath}${body}`).digest("base64");
}

interface Envelope<T> {
  code: number;
  msg: string;
  data: T;
}

// ponytail: one in-process queue, 4 req/s. Measured 25 Sep: ~5 req/s per API key across all endpoints,
// then 429. The limit is per key, so the API and the keeper running on one key can still exceed it
// together; give the keeper its own key (or a shared limiter) once both run 24/7.
const MIN_GAP_MS = 250;
let slot = Promise.resolve();
function throttle(): Promise<void> {
  const mine = slot.then(() => new Promise<void>((r) => setTimeout(r, MIN_GAP_MS)));
  const turn = slot;
  slot = mine;
  return turn;
}

async function request<T>(method: "GET" | "POST", path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
  const { url: base, key, secret } = config.binance;
  if (!key || !secret) throw new Error("BINANCE_WEB3_API_KEY / BINANCE_WEB3_API_SECRET are not configured");
  await throttle();
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-OC-APIKEY": key,
      "X-OC-TIMESTAMP": timestamp,
      "X-OC-SIGN": sign(timestamp, method, url.pathname + url.search, bodyText, secret),
      "X-OC-RECV-WINDOW": "60000",
    },
    body: bodyText || undefined,
  });
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !json || json.code !== 0) throw new Error(`Binance ${path} → ${res.status} ${json?.code ?? ""} ${json?.msg ?? ""}`.trim());
  return json.data;
}

export const binanceGet = <T>(path: string, query: Record<string, string>) => request<T>("GET", path, query);
export const binancePost = <T>(path: string, body: unknown) => request<T>("POST", path, {}, body);
