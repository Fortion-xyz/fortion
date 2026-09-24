// Guard loop (PRD §5.1 F3): decide → plan → simulate every 60s.
// Dry run: signing lands with the Agentic Wallet session + fortion-venus-stocks skill (PRD §11, 1–3 Oct).
import { config, TICKERS } from "../core/config.ts";
import { plan } from "../core/plan.ts";
import { getPosition, parseAddress } from "../core/position.ts";
import { simulate } from "../core/simulate.ts";

const INTERVAL_MS = 60_000;
const accounts = config.watch.map(parseAddress);
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function tick() {
  for (const account of accounts)
    for (const ticker of TICKERS) {
      try {
        const { decision, policy } = await getPosition(account, ticker);
        if (decision.action.kind === "hold") continue;
        log(account, ticker, decision.status, decision.reason);
        const p = plan(decision, policy);
        if ("blocked" in p) {
          log("  blocked:", p.blocked);
          continue;
        }
        if (!p.calls.length) continue;
        const sim = await simulate(account, p.calls);
        for (const s of sim.steps) log(`  ${s.error ? "✖" : "✔"} ${s.error ?? s.label}`);
        log(sim.ok ? "  simulated OK, would sign (dry run)" : "  simulation failed, not signing");
      } catch (err) {
        console.error(account, ticker, err);
      }
    }
}

if (!accounts.length) console.warn("WATCH_ADDRESSES is empty, nothing to guard");
await tick();
setInterval(tick, INTERVAL_MS);
