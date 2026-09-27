#!/usr/bin/env node
// Zero-dependency calldata for Venus Core Pool bStock lending on BNB Smart Chain (chain 56).
// Prints unsigned calls as JSON: [{ "to", "data", "label" }]. Sign each with
//   baw contract-call preview --binanceChainId 56 --from <wallet> --to <to> --inputData <data> --json
// then `baw contract-call execute --requestId <id> --json`, one at a time, waiting for each to be mined.
//
//   node calldata.mjs supply   <NVDAB|TSLAB|SPCXB> <amount>   approve + mint + enterMarkets
//   node calldata.mjs borrow   <usdt>                          borrow USDT
//   node calldata.mjs repay    <usdt>                          approve + repayBorrow
//   node calldata.mjs repay    all <approve-cap-usdt>          repay the whole debt (approve only the cap)
//   node calldata.mjs withdraw <ticker> <amount>               redeemUnderlying
//
// Addresses verified on-chain via Comptroller.getAllMarkets() on 25 Sep 2026.

const COMPTROLLER = "0xfD36E2c2a6789Db23113685031d7F16329158384";
const V_USDT = "0xfD5840Cd36d94D7229439859C0112a4185BC0255";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const MARKETS = {
  NVDAB: { token: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436", vToken: "0xEb8Ca841cBe1BC4832A10b15c7dAB1081eDaD371" },
  TSLAB: { token: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f", vToken: "0x97421799419Eb782628e73e7220d8E0A207469a3" },
  SPCXB: { token: "0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1", vToken: "0xC36dFaCc7a125859C106F29b9F2d874CCF29A55A" },
};

// 4-byte selectors (keccak256 of the signature).
const SEL = {
  approve: "095ea7b3", // approve(address,uint256)
  mint: "a0712d68", // mint(uint256)
  enterMarkets: "c2998238", // enterMarkets(address[])
  borrow: "c5ebeaec", // borrow(uint256)
  repayBorrow: "0e752702", // repayBorrow(uint256)
  redeemUnderlying: "852a12e3", // redeemUnderlying(uint256)
};
const MAX_UINT = (1n << 256n) - 1n;

const word = (n) => n.toString(16).padStart(64, "0");
const addr = (a) => a.slice(2).toLowerCase().padStart(64, "0");

/** "0.5" → 500000000000000000n (18 decimals), refusing anything that isn't a positive decimal. */
function units(s) {
  if (!/^\d+(\.\d{1,18})?$/.test(s ?? "")) throw new Error(`invalid amount "${s ?? ""}" (positive number, up to 18 decimals)`);
  const [int, frac = ""] = s.split(".");
  const v = BigInt(int) * 10n ** 18n + BigInt(frac.padEnd(18, "0"));
  if (v <= 0n) throw new Error(`invalid amount "${s}" (must be more than zero)`);
  return v;
}

function market(ticker) {
  const m = MARKETS[(ticker ?? "").toUpperCase()];
  if (!m) throw new Error(`unknown ticker "${ticker ?? ""}" (use ${Object.keys(MARKETS).join(", ")})`);
  return m;
}

const call = (to, label, sel, ...args) => ({ to, data: `0x${sel}${args.join("")}`, label });

export function build([action, a, b]) {
  switch (action) {
    case "supply": {
      const t = a.toUpperCase();
      const m = market(a);
      const amount = units(b);
      return [
        call(m.token, `approve ${t}`, SEL.approve, addr(m.vToken), word(amount)),
        call(m.vToken, `supply ${t}`, SEL.mint, word(amount)),
        // dynamic array: offset 0x20, length 1, element
        call(COMPTROLLER, `use ${t} as collateral`, SEL.enterMarkets, word(32n), word(1n), addr(m.vToken)),
      ];
    }
    case "borrow":
      return [call(V_USDT, "borrow USDT", SEL.borrow, word(units(a)))];
    case "repay": {
      if (a === "all") {
        if (b === undefined) throw new Error("repay all needs an approve cap in USDT (the debt plus a small margin); never approve unlimited");
        return [call(USDT, "approve USDT", SEL.approve, addr(V_USDT), word(units(b))), call(V_USDT, "repay USDT", SEL.repayBorrow, word(MAX_UINT))];
      }
      const amount = units(a);
      return [call(USDT, "approve USDT", SEL.approve, addr(V_USDT), word(amount)), call(V_USDT, "repay USDT", SEL.repayBorrow, word(amount))];
    }
    case "withdraw":
      return [call(market(a).vToken, `withdraw ${a.toUpperCase()}`, SEL.redeemUnderlying, word(units(b)))];
    default:
      throw new Error("usage: calldata.mjs supply|borrow|repay|withdraw … (see the header of this file)");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(build(process.argv.slice(2)), null, 2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
