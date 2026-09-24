// Backend contract (backend/src/core/position.ts). Only the fields the UI reads.
export interface Position {
  ticker: string;
  snapshot: { collateralUsd: number; debtUsd: number; bufferUsd: number };
  decision: { ltv: number; targetLtv: number; status: "Safe" | "Careful" | "Protecting"; reason: string };
  availableCash: number;
}

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export async function getPosition(address: string, ticker = "NVDAB"): Promise<Position> {
  const res = await fetch(`${API_URL}/position/${address}?ticker=${ticker}`, { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `API ${res.status}`);
  return body;
}
