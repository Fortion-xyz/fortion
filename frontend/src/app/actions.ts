"use server";

import { refresh } from "next/cache";
import { setProfile, type RiskProfile } from "@/lib/api";

export async function chooseProfile(formData: FormData) {
  await setProfile(String(formData.get("address")), String(formData.get("profile")) as RiskProfile);
  refresh();
}
