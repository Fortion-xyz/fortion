// `fortion` CLI: argument parsing and calldata, kept pure so they're testable.
import { parseUnits } from "viem";
import { TICKERS, type Ticker } from "../core/config.ts";
import { borrowUsdt, repayUsdt, supply, withdraw, type Call } from "../core/venus-tx.ts";

export const USAGE = `Usage:
  fortion status   <address> [ticker]
  fortion events   <address>
  fortion pledge   <address> <ticker> <amount> [--cash <usdt>] [--mode cash|accumulate] [--yes]
  fortion draw     <address> <ticker> [usdt] [--yes]
  fortion repay    <address> <ticker> <usdt|all> [--yes]
  fortion withdraw <address> <ticker> <amount> [--yes]
  fortion signin
  fortion calldata supply|borrow|repay|withdraw …   (unsigned calls as JSON, for the Wallet Skill)

Without --yes every write is only previewed and simulated. Tickers: ${TICKERS.join(", ")}.`;

export type Command =
  | { cmd: "status"; address: string; ticker: Ticker | undefined }
  | { cmd: "events"; address: string }
  | { cmd: "pledge"; address: string; ticker: Ticker; amount: string; cash: number | undefined; mode: "cash" | "accumulate"; yes: boolean }
  | { cmd: "draw"; address: string; ticker: Ticker; cash: number | undefined; yes: boolean }
  | { cmd: "repay"; address: string; ticker: Ticker; usdt: number | "all"; yes: boolean }
  | { cmd: "withdraw"; address: string; ticker: Ticker; amount: string; yes: boolean }
  | { cmd: "signin" }
  | { cmd: "calldata"; args: string[] };

const usage = (why?: string) => new Error(`${why ? `${why}\n\n` : ""}${USAGE}`);

function ticker(t: string | undefined): Ticker {
  const up = t?.toUpperCase();
  if (!TICKERS.includes(up as Ticker)) throw usage(`Unknown stock "${t ?? ""}".`);
  return up as Ticker;
}
function positive(x: string | undefined, what: string): number {
  const n = Number(x);
  if (!(n > 0)) throw usage(`"${x ?? ""}" is not a valid ${what}.`);
  return n;
}
function tokens(x: string | undefined): string {
  if (!/^\d+(\.\d{1,18})?$/.test(x ?? "") || !(Number(x) > 0)) throw usage(`"${x ?? ""}" is not a valid amount of stock.`);
  return x!;
}

export function parseCommand(argv: string[]): Command {
  const flags = new Map<string, string | true>();
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--yes") flags.set("yes", true);
    else if (a.startsWith("--")) flags.set(a.slice(2), argv[++i] ?? "");
    else pos.push(a);
  }
  const [cmd, address, t, value] = pos;
  const yes = flags.get("yes") === true;
  const need = (n: number) => {
    if (pos.length < n) throw usage();
  };
  switch (cmd) {
    case undefined:
      throw usage();
    case "status":
      need(2);
      return { cmd, address: address!, ticker: t ? ticker(t) : undefined };
    case "events":
      need(2);
      return { cmd, address: address! };
    case "pledge": {
      need(4);
      const mode = (flags.get("mode") as string | undefined) ?? "cash";
      if (mode !== "cash" && mode !== "accumulate") throw usage(`--mode must be cash or accumulate, not "${mode}".`);
      const cash = flags.has("cash") ? positive(flags.get("cash") as string, "cash amount") : undefined;
      return { cmd, address: address!, ticker: ticker(t), amount: tokens(value), cash, mode, yes };
    }
    case "draw":
      need(3);
      return { cmd, address: address!, ticker: ticker(t), cash: value === undefined ? undefined : positive(value, "cash amount"), yes };
    case "repay":
      need(4);
      return { cmd, address: address!, ticker: ticker(t), usdt: value === "all" ? "all" : positive(value, "USDT amount"), yes };
    case "withdraw":
      need(4);
      return { cmd, address: address!, ticker: ticker(t), amount: tokens(value), yes };
    case "signin":
      return { cmd };
    case "calldata":
      return { cmd, args: pos.slice(1) };
    default:
      throw usage(`Unknown command "${cmd}".`);
  }
}

/** Unsigned Venus calls for the Wallet Skill: `fortion calldata supply NVDAB 0.5`, `borrow 12.5`, … */
export function calldata(args: string[]): Call[] {
  const [action, a, b] = args;
  const usdt = (x: string | undefined) => parseUnits(String(positive(x, "USDT amount")), 18);
  switch (action) {
    case "supply":
      return supply(ticker(a), parseUnits(tokens(b), 18));
    case "withdraw":
      return [withdraw(ticker(a), parseUnits(tokens(b), 18))];
    case "borrow":
      if (a === undefined) throw usage("borrow needs a USDT amount.");
      return [borrowUsdt(usdt(a))];
    case "repay":
      if (a === undefined) throw usage("repay needs a USDT amount.");
      return repayUsdt(usdt(a));
    default:
      throw usage(`calldata action must be supply, borrow, repay or withdraw.`);
  }
}
