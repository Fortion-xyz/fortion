import { getPolicy, getPosition, getProfiles, type Position } from "@/lib/api";
import { ProfilePicker } from "./profile-picker";

const usd = (n: number) => `$${n.toFixed(2)}`;

export default async function Home({ searchParams }: PageProps<"/">) {
  const { address } = await searchParams;
  const addr = typeof address === "string" ? address : "";
  let position: Position | null = null;
  let error: string | null = null;
  // Picker only needs the backend, so it still works while the position read fails (e.g. no Binance key yet).
  const [picker, pos] = addr
    ? await Promise.allSettled([Promise.all([getPolicy(addr), getProfiles()]), getPosition(addr)])
    : [];
  if (pos?.status === "fulfilled") position = pos.value;
  else if (pos) error = (pos.reason as Error).message;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-16">
      <header>
        <h1 className="text-3xl font-semibold">Fortion</h1>
        <p className="text-zinc-500">Hold the fortress. Draw the fortune.</p>
      </header>

      <form className="flex gap-2">
        <label htmlFor="address" className="sr-only">Wallet address</label>
        <input id="address" name="address" defaultValue={addr} placeholder="0x… your Agentic Wallet" required
          pattern="0x[0-9a-fA-F]{40}" className="flex-1 rounded-lg border px-3 py-2 font-mono text-sm" />
        <button className="rounded-lg bg-black px-4 py-2 text-white dark:bg-white dark:text-black">Check</button>
      </form>

      {error && <p role="alert" className="text-red-600">{error}</p>}

      {position && (
        <section className="grid grid-cols-3 gap-4">
          <Stat label="Stock value" value={usd(position.snapshot.collateralUsd)} />
          <Stat label="Cash available" value={usd(position.availableCash)} />
          <Stat label="Status" value={position.decision.status} />
          <p className="col-span-3 text-sm text-zinc-500">{position.decision.reason}</p>
          {position.market.nextEarnings && (
            <p className="col-span-3 text-sm">
              Next earnings: {new Date(position.market.nextEarnings.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              {position.market.nextEarnings.confirmed ? "" : " (estimated)"}. The agent lowers the loan the day before.
            </p>
          )}
        </section>
      )}

      {picker?.status === "fulfilled" && (
        <ProfilePicker address={addr} current={picker.value[0].profile} profiles={picker.value[1]} />
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
