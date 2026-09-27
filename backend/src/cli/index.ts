#!/usr/bin/env node
// `fortion`: the whole product from a terminal. Every write is previewed + simulated first; it is
// signed only with --yes, EXECUTE=1 and this host signed in to the user's Agentic Wallet.
import { parseAbi, parseUnits, type Address } from "viem";
import { BSTOCKS, TICKERS, USDT, type Ticker } from "../core/config.ts";
import { execute, type Step } from "../core/executor.ts";
import { plan } from "../core/plan.ts";
import { db, getPosition, parseAddress } from "../core/position.ts";
import { previewDraw, previewPledge, previewRepay } from "../core/preview.ts";
import { simulate } from "../core/simulate.ts";
import { client } from "../core/venus.ts";
import { withdraw, type Call } from "../core/venus-tx.ts";
import { parseBaw, resolveSigner, runBaw } from "../core/wallet.ts";
import { calldata, parseCommand } from "./commands.ts";

const usd = (x: number) => `${x.toFixed(2)} USDT`;
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const balanceOf = (a: Address) => (token: Address) => client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [a] });

async function status(account: Address, only?: Ticker) {
  for (const t of only ? [only] : TICKERS) {
    const p = await getPosition(account, t);
    if (!only && p.snapshot.collateralUsd === 0 && p.snapshot.debtUsd === 0) continue;
    console.log(`\n${t}  ${p.decision.status}`);
    console.log(`  Stock value     ${usd(p.snapshot.collateralUsd)}`);
    console.log(`  Borrowed        ${usd(p.snapshot.debtUsd)}`);
    console.log(`  Cash available  ${usd(p.availableCash)}`);
    console.log(`  Safety buffer   ${usd(p.snapshot.bufferUsd)}`);
    console.log(`  Profile         ${p.policy.profile}, ${p.policy.mode} mode`);
    if (p.market.nextEarnings) console.log(`  Next earnings   ${p.market.nextEarnings.at.toISOString().slice(0, 10)}${p.market.nextEarnings.confirmed ? "" : " (estimated)"}`);
    console.log(`  ${p.decision.reason}`);
  }
}

/** Preview printout + sign when asked. Returns false if the simulation failed. */
async function run(account: Address, summary: string[], calls: Call[], sim: { ok: boolean; steps: { label: string; error: string | null }[] }, yes: boolean) {
  summary.forEach((l) => console.log(l));
  console.log("\nSteps (each is its own wallet transaction):");
  sim.steps.forEach((s, i) => console.log(`  ${s.error ? "✖" : "✔"} ${i + 1}. ${s.error ?? s.label}`));
  if (!sim.ok) return console.log("\nSimulation failed: nothing will be signed."), false;
  if (!yes) return console.log("\nPreview only. Add --yes to sign with your Agentic Wallet."), true;
  return sign(account, calls.map((call) => ({ kind: "call", call })));
}

async function sign(account: Address, steps: Step[]) {
  const { signer, why } = await resolveSigner(account);
  if (!signer) return console.log(`\nNot signing: ${why}`), false;
  const r = await execute(account, steps, { signer, simulate });
  console.log(`\n${r.outcome}${r.error ? `: ${r.error}` : ""}`);
  r.txHashes.forEach((h) => console.log(`  https://bscscan.com/tx/${h}`));
  return r.outcome === "done";
}

/** Accumulate activation (PRD F2): up to 2 loops of borrow → buy → re-supply, each within the target. */
async function accumulate(account: Address, ticker: Ticker) {
  for (let loop = 1; loop <= 2; loop++) {
    const p = await getPosition(account, ticker);
    if (p.availableCash < 1) break;
    const [stock, usdt] = await Promise.all([balanceOf(account)(BSTOCKS[ticker]), balanceOf(account)(USDT)]);
    const pl = plan({ ...p.decision, action: { kind: "borrow", usd: p.availableCash } }, { ...p.policy, mode: "accumulate" }, {
      ticker, priceUsd: p.market.onchainUsd, collateralUsd: p.snapshot.collateralUsd, debtUsd: p.snapshot.debtUsd,
      collateralFactor: p.collateralFactor, startBalance: { stock, usdt }, balanceOf: balanceOf(account),
    });
    if ("blocked" in pl) return console.log(pl.blocked);
    console.log(`\nAccumulate loop ${loop}: borrow ${usd(p.availableCash)} and buy more ${ticker}`);
    if (!(await sign(account, pl.steps))) return;
  }
}

async function signin() {
  const s = parseBaw<{ pairingCode: string; urlForWeb: string; qrCodeId: string }>(await runBaw(["auth", "signin", "--json"]));
  if (!s.success || !s.data) throw new Error(`baw auth signin failed: ${JSON.stringify(s.error)}`);
  console.log(`Pairing code: ${s.data.pairingCode}\nOpen and scan with the Binance App: ${s.data.urlForWeb}\nWaiting up to 5 minutes for you to confirm…`);
  const v = parseBaw(await runBaw(["auth", "verify", "--qrCodeId", s.data.qrCodeId, "--json"], 330_000));
  console.log(v.success ? "Signed in. Enable Developer Mode in the Binance App so Fortion can send Venus calls." : `Not signed in: ${JSON.stringify(v.error)}`);
}

async function main() {
  const c = parseCommand(process.argv.slice(2));
  switch (c.cmd) {
    case "status":
      return status(parseAddress(c.address), c.ticker);
    case "events":
      for (const e of db.events(parseAddress(c.address), 20)) console.log(`${e.at.slice(0, 16)}  ${e.ticker}  [${e.outcome}]  ${e.reason}${e.error ? ` (${e.error})` : ""}`);
      return;
    case "pledge": {
      const a = parseAddress(c.address);
      const p = await previewPledge(a, c.ticker, c.amount, c.mode === "accumulate" ? undefined : c.cash);
      // Accumulate: supply first (the preview's first 3 calls), then the loops below borrow and buy.
      const calls = c.mode === "cash" ? p.calls : p.calls.slice(0, 3);
      const sim = c.mode === "cash" ? p.simulation : await simulate(a, calls);
      const ok = await run(a, [
        `Pledge ${c.amount} ${c.ticker}: stock value after ${usd(p.stockValueAfter)}`,
        c.mode === "cash" ? `Cash to you ${usd(p.cash)} + safety buffer ${usd(p.safetyBuffer)} (borrowing ${usd(p.borrow)}), up to ${usd(p.maxCash)} today` : "Accumulate: the loan will buy more of the same stock, max 2 loops",
      ], calls, sim, c.yes);
      if (ok && c.yes && c.mode === "accumulate") await accumulate(a, c.ticker);
      return;
    }
    case "draw": {
      const a = parseAddress(c.address);
      const p = await previewDraw(a, c.ticker, c.cash);
      return void (await run(a, [`Draw ${usd(p.cash)} to your wallet + ${usd(p.safetyBuffer)} safety buffer (borrowing ${usd(p.borrow)}), up to ${usd(p.maxCash)} today`], p.calls, p.simulation, c.yes));
    }
    case "repay": {
      const a = parseAddress(c.address);
      const p = await previewRepay(a, c.ticker, c.usdt);
      return void (await run(a, [`Repay ${usd(p.repay)}; loan after ${usd(p.debtAfter)}`], p.calls, p.simulation, c.yes));
    }
    case "withdraw": {
      const a = parseAddress(c.address);
      const calls = [withdraw(c.ticker, parseUnits(c.amount, 18))];
      return void (await run(a, [`Withdraw ${c.amount} ${c.ticker} back to your wallet (Venus refuses if the loan would be unsafe)`], calls, await simulate(a, calls), c.yes));
    }
    case "signin":
      return signin();
    case "calldata":
      return console.log(JSON.stringify(calldata(c.args), (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  }
}

main().then(
  () => process.exit(0),
  (err: Error) => {
    console.error(err.message);
    process.exit(1);
  },
);
