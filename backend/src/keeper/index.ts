// Guard loop (PRD §5.1 F3). Decides every 60s; execution lands once the Agentic Wallet
// session + fortion-venus-stocks skill exist (PRD §11, 1–3 Oct).
import { config, TICKERS } from "../core/config.ts";
import { getPosition, parseAddress } from "../core/position.ts";

const INTERVAL_MS = 60_000;
const accounts = config.watch.map(parseAddress);

async function tick() {
  for (const account of accounts)
    for (const ticker of TICKERS) {
      try {
        const { decision } = await getPosition(account, ticker);
        if (decision.action.kind !== "hold") console.log(new Date().toISOString(), account, ticker, decision.reason);
        // TODO(execute): simulate via Transaction API, then sign through the Agentic Wallet session.
      } catch (err) {
        console.error(account, ticker, err);
      }
    }
}

if (!accounts.length) console.warn("WATCH_ADDRESSES is empty, nothing to guard");
await tick();
setInterval(tick, INTERVAL_MS);
