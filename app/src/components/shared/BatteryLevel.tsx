import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium } from "lucide-react";

import { cn } from "@/lib/utils";

/** Battery icon + percent. Green bolt icon = charging; low battery (≤ 15%, not charging) is red. */
export function BatteryLevel({ level, charging, className }: { level: number; charging: boolean; className?: string }) {
  const Icon = charging ? BatteryCharging : level > 80 ? BatteryFull : level > 25 ? BatteryMedium : BatteryLow;
  const low = !charging && level <= 15;
  return (
    <span
      title={charging ? "Charging" : "On battery"}
      className={cn("inline-flex items-center gap-1 whitespace-nowrap tabular-nums", low && "text-destructive", className)}
    >
      <Icon className={cn("size-3.5 shrink-0", charging && "text-[#0ca30c]")} />
      {level}%
    </span>
  );
}
