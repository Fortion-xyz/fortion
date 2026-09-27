// Signer boundary: how a planned step gets signed by the user's Binance Agentic Wallet.
// Execution path = PRD §14 option 1 (hybrid): this process runs the `baw` CLI after the user's QR sign-in.
// Docs: binance/binance-skills-hub skills/binance-web3/binance-agentic-wallet/references/{external-sign,market-order}.md
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { Address, Hex } from "viem";
import { client } from "./venus.ts";
import type { Call } from "./venus-tx.ts";

export interface Swap {
  fromToken: Address;
  toToken: Address;
  qty: string; // human-readable units, as `baw market-order swap --fromTokenQty` expects
  label: string;
}

export type SendResult =
  | { status: "mined"; txHash: Hex }
  | { status: "pending"; note: string } // needs the user in the Binance App, or a swap still processing
  | { status: "failed"; error: string; txHash?: Hex };

export interface Signer {
  kind: "baw";
  from: Address;
  send(call: Call): Promise<SendResult>;
  swap(s: Swap): Promise<SendResult>;
}

/** Runs `baw <args>` and returns stdout. Injected in tests. */
export type Run = (args: string[]) => Promise<string>;

// Prefer the pinned local CLI (backend dependency @binance/agentic-wallet), fall back to a global `baw`.
const LOCAL_BAW = new URL("../../node_modules/.bin/baw", import.meta.url).pathname;
const BAW = existsSync(LOCAL_BAW) ? LOCAL_BAW : "baw";

export const runBaw: Run = (args) =>
  new Promise((resolve, reject) =>
    execFile(BAW, args, { timeout: 120_000, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT")
        return reject(new Error("baw CLI not found: npm install -g @binance/agentic-wallet@1.10.0"));
      // baw prints its JSON result on stdout even when it exits non-zero.
      if (stdout.trim()) return resolve(stdout);
      reject(new Error(stderr.trim() || (err as Error)?.message || "baw returned nothing"));
    }),
  );

interface BawResult<T> {
  success: boolean;
  data?: T;
  error?: { code?: number; name?: string; message?: string };
}

export function parseBaw<T>(stdout: string): BawResult<T> {
  const start = stdout.indexOf("{");
  if (start < 0) return { success: false, error: { message: `unexpected baw output: ${stdout.slice(0, 200)}` } };
  try {
    return JSON.parse(stdout.slice(start)) as BawResult<T>;
  } catch {
    return { success: false, error: { message: `unparseable baw output: ${stdout.slice(0, 200)}` } };
  }
}

const errorText = (r: BawResult<unknown>) => [r.error?.message, r.error?.name, r.error?.code].filter(Boolean).join(" · ") || "baw failed";

interface Preview {
  requestId: string;
  simulationResult?: { simulationErrorDetail?: string | null };
  risks?: { riskDetails?: { title: string; description: string; riskType: string }[] };
}
interface Executed { orderId: string; status: "BROADCASTED" | "PENDING_CONFIRMATION"; txHash: Hex | null }
interface Order { orderId: string; status: "PENDING" | "FINISHED" | "FAILED"; txHash: Hex | null }

export function bawSigner(
  from: Address,
  deps: { run?: Run; waitReceipt?: (h: Hex) => Promise<{ status: "success" | "reverted" }>; pollMs?: number; pollTries?: number } = {},
): Signer {
  const run = deps.run ?? runBaw;
  const waitReceipt = deps.waitReceipt ?? ((hash: Hex) => client.waitForTransactionReceipt({ hash, timeout: 120_000 }));
  const pollMs = deps.pollMs ?? 3_000;
  const pollTries = deps.pollTries ?? 40;

  const mined = async (txHash: Hex): Promise<SendResult> =>
    (await waitReceipt(txHash)).status === "success" ? { status: "mined", txHash } : { status: "failed", error: "transaction reverted on chain", txHash };

  return {
    kind: "baw",
    from,
    async send(call) {
      const p = parseBaw<Preview>(await run(["contract-call", "preview", "--binanceChainId", "56", "--from", from, "--to", call.to, "--inputData", call.data, "--json"]));
      if (!p.success || !p.data?.requestId) return { status: "failed", error: `${call.label}: ${errorText(p)}` };
      const sim = p.data.simulationResult?.simulationErrorDetail;
      if (sim) return { status: "failed", error: `${call.label}: Binance simulation failed: ${sim}` };
      // Binance's own safety rule: never execute a preview carrying a RISK item.
      const risk = p.data.risks?.riskDetails?.find((r) => r.riskType === "RISK");
      if (risk) return { status: "failed", error: `${call.label}: Binance flagged "${risk.title}": ${risk.description}` };

      const e = parseBaw<Executed>(await run(["contract-call", "execute", "--requestId", p.data.requestId, "--json"]));
      if (!e.success || !e.data) return { status: "failed", error: `${call.label}: ${errorText(e)}` };
      if (e.data.status === "PENDING_CONFIRMATION") return { status: "pending", note: `Waiting for you to confirm in the Binance App (order ${e.data.orderId}).` };
      if (!e.data.txHash) return { status: "failed", error: `${call.label}: broadcast returned no transaction hash` };
      return mined(e.data.txHash);
    },
    async swap(s) {
      const sub = parseBaw<{ orderId: string }>(
        await run(["market-order", "swap", "--fromTokenQty", s.qty, "--fromToken", s.fromToken, "--toToken", s.toToken, "--binanceChainId", "56", "--slippage", "1", "--json"]),
      );
      if (!sub.success || !sub.data?.orderId) return { status: "failed", error: `${s.label}: ${errorText(sub)}` };
      // An orderId is only a submission; poll to FINISHED / FAILED (market-order.md, "Mandatory").
      for (let i = 0; i < pollTries; i++) {
        const l = parseBaw<{ list: Order[] }>(await run(["market-order", "list", "--orderId", sub.data.orderId, "--json"]));
        const o = l.data?.list?.find((x) => x.orderId === sub.data!.orderId);
        if (o?.status === "FINISHED" && o.txHash) return { status: "mined", txHash: o.txHash };
        if (o?.status === "FAILED") return { status: "failed", error: `${s.label}: swap failed${o.txHash ? ` (${o.txHash})` : ""}` };
        await new Promise((r) => setTimeout(r, pollMs));
      }
      return { status: "pending", note: `${s.label}: swap order ${sub.data.orderId} is still processing.` };
    },
  };
}

/** Is this host signed in to the Agentic Wallet? (the keeper checks before signing anything) */
export async function walletStatus(run: Run = runBaw): Promise<{ connected: boolean; detail?: string }> {
  const r = parseBaw<{ status: string }>(await run(["wallet", "status", "--json"]).catch((e: Error) => JSON.stringify({ success: false, error: { message: e.message } })));
  if (r.success && r.data?.status === "CONNECTED") return { connected: true };
  // baw 1.10.0 answers `SERVICE_ERROR: illegal parameter` (not UNCONNECTED) when never signed in.
  return { connected: false, detail: `Not signed in (${r.data?.status ?? errorText(r)}). Run \`fortion signin\` or \`baw auth signin\` and confirm in the Binance App.` };
}

/** EVM addresses of the signed-in Agentic Wallet, lowercased. Parsed loosely: the exact shape isn't documented per chain. */
export async function walletAddresses(run: Run = runBaw): Promise<string[]> {
  const out = await run(["wallet", "address", "--json"]).catch(() => "");
  if (!parseBaw(out).success) return [];
  return [...new Set((out.match(/0x[0-9a-fA-F]{40}/g) ?? []).map((a) => a.toLowerCase()))];
}
