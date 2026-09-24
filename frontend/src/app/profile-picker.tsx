import { chooseProfile } from "./actions";
import type { RiskProfile, Thresholds } from "@/lib/api";

const COPY: Record<RiskProfile, { name: string; line: string }> = {
  conservative: { name: "Steady", line: "Less cash, most room for bad days." },
  balanced: { name: "Balanced", line: "The default. Cash today, guarded through earnings and weekends." },
  growth: { name: "Bold", line: "More cash now. The agent has less room before it must sell." },
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function ProfilePicker({ address, current, profiles }: {
  address: string;
  current: RiskProfile;
  profiles: Record<RiskProfile, Thresholds>;
}) {
  return (
    <form action={chooseProfile} className="flex flex-col gap-3">
      <input type="hidden" name="address" value={address} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium">How careful should the agent be?</legend>
        {(Object.keys(COPY) as RiskProfile[]).map((id) => {
          const t = profiles[id];
          return (
            <label key={id} className="flex cursor-pointer gap-3 rounded-xl border p-4 has-[:checked]:border-black dark:has-[:checked]:border-white">
              <input type="radio" name="profile" value={id} defaultChecked={id === current} className="mt-1" />
              <span className="flex flex-col gap-1">
                <span className="font-semibold">{COPY[id].name}</span>
                <span className="text-sm text-zinc-500">{COPY[id].line}</span>
                <span className="text-sm">
                  Cash up to {pct(t.normal)} of your stock value · shares sold only after a {pct(1 - t.normal / t.lastResort)} drop
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <button className="self-start rounded-lg bg-black px-4 py-2 text-white dark:bg-white dark:text-black">Save</button>
    </form>
  );
}
