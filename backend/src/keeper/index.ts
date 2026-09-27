// Guard loop (PRD §5.1 F3): every 60s, for every watched wallet and stock, run one guard pass.
// Signing needs all three: EXECUTE=1, this host signed in to the Agentic Wallet (`fortion signin`),
// and the watched address being that wallet. Anything else runs as a dry run (simulated, logged).
import { parseAbi, type Address } from "viem";
import { BSTOCKS, config, TICKERS, USDT } from "../core/config.ts";
import { db, getPosition, parseAddress } from "../core/position.ts";
import { simulate } from "../core/simulate.ts";
import { client } from "../core/venus.ts";
import { resolveSigner, type Signer } from "../core/wallet.ts";
import { guardOnce } from "./guard.ts";

const INTERVAL_MS = 60_000;
const accounts = config.watch.map(parseAddress);
const EXECUTE = process.env.EXECUTE === "1";
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const balanceOf = (account: Address) => (token: Address) => client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [account] });

// Resolved once per tick: is this host allowed to sign for `account`?
async function signers(): Promise<(a: Address) => Promise<Signer | null>> {
  const cache = new Map<string, Signer | null>();
  let warned = false;
  return async (a) => {
    if (!cache.has(a)) {
      const { signer, why } = await resolveSigner(a, EXECUTE);
      if (!signer && EXECUTE && !warned) (warned = true), log("dry run:", why);
      cache.set(a, signer);
    }
    return cache.get(a)!;
  };
}

async function tick() {
  const signerFor = await signers();
  for (const account of accounts)
    for (const ticker of TICKERS) {
      try {
        const e = await guardOnce(account, ticker, {
          position: getPosition,
          store: db,
          signerFor,
          simulate,
          balances: async (a, t) => {
            const [stock, usdt] = await Promise.all([balanceOf(a)(BSTOCKS[t]), balanceOf(a)(USDT)]);
            return { stock, usdt };
          },
          balanceOf,
          now: () => new Date(),
        });
        if (e) log(account, ticker, `[${e.outcome}${e.simulated ? ", simulated" : ""}]`, e.reason, e.error ? `— ${e.error}` : "", e.txHashes.join(" "));
      } catch (err) {
        console.error(new Date().toISOString(), account, ticker, (err as Error).message);
      }
    }
}

if (!accounts.length) console.warn("WATCH_ADDRESSES is empty, nothing to guard");
log(`keeper: ${accounts.length} wallet(s), ${EXECUTE ? "EXECUTE on (signs via baw when signed in)" : "dry run"}`);
await tick();
setInterval(tick, INTERVAL_MS);
