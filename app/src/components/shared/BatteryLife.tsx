import { cn } from "@/lib/utils";
import type { DeviceStats } from "@/api";

/** mAh when new, by adb model. Phones don't report it; add yours here. */
const ORIGINAL_MAH: Record<string, number> = {
  M2101K6G: 5020, // Redmi Note 10 Pro
};

const HEALTH: Record<NonNullable<DeviceStats["batteryHealth"]>, string> = {
  good: "Good",
  overheating: "Overheating",
  dead: "Dead",
  over_voltage: "Over voltage",
  failing: "Failing",
  cold: "Too cold",
};

/** How worn the battery is: "86% · 4334 of 5020 mAh". Null when the phone reports nothing. */
export function BatteryLife({ stats, model }: { stats: DeviceStats; model: string | null }) {
  const { batteryHealth: health, batteryCapacityMah: mah } = stats;
  if (!health && mah == null) return null;
  const original = model ? ORIGINAL_MAH[model.replace(/ /g, "_")] : undefined;
  const pct = mah != null && original ? Math.min(100, Math.round((mah / original) * 100)) : null;
  const bad = health && health !== "good";
  const parts = [
    bad ? HEALTH[health] : null,
    pct != null ? `${pct}%` : null,
    mah != null ? (original ? `${mah} of ${original} mAh` : `~${mah} mAh`) : null,
  ].filter(Boolean);
  return (
    <span
      title={`How much charge the battery still holds. Estimated by the phone; can be off by a few percent.${health ? ` Condition: ${HEALTH[health]}.` : ""}`}
      className={cn("tabular-nums", (bad || (pct != null && pct < 60)) && "text-destructive", !bad && pct != null && pct >= 60 && pct < 80 && "text-[#d9900a]")}
    >
      {parts.length ? parts.join(" · ") : HEALTH[health!]}
    </span>
  );
}
