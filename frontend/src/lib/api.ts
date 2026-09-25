// Backend contract (backend/src/core/{position,policy}.ts). Only the fields the UI reads.
export type RiskProfile = "conservative" | "balanced" | "growth";

export interface Thresholds {
  normal: number;
  lastResort: number;
}

export interface Policy {
  profile: RiskProfile;
}

export interface Position {
  ticker: string;
  snapshot: { collateralUsd: number; debtUsd: number; bufferUsd: number };
  decision: { ltv: number; targetLtv: number; status: "Safe" | "Careful" | "Protecting"; reason: string };
  availableCash: number;
  market: { nextEarnings: { at: string; confirmed: boolean } | null };
}

const API_URL = process.env.API_URL ?? "http://localhost:4000";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store", ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `API ${res.status}`);
  return body;
}

export const getPosition = (address: string, ticker = "NVDAB") => api<Position>(`/position/${address}?ticker=${ticker}`);
export const getProfiles = () => api<Record<RiskProfile, Thresholds>>("/profiles");
export const getPolicy = (address: string) => api<Policy>(`/policy/${address}`);
export const setProfile = (address: string, profile: RiskProfile) =>
  api<Policy>(`/policy/${address}`, { method: "PUT", body: JSON.stringify({ profile }) });
