import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Health } from "./health";

// Status colors, always paired with an icon and a word so color isn't the only cue.
const LEVEL = {
  good: { label: "Good", icon: CircleCheck, color: "text-[#0ca30c]" },
  fair: { label: "Fair", icon: TriangleAlert, color: "text-[#d9900a]" },
  poor: { label: "Poor", icon: CircleAlert, color: "text-[#d03b3b]" },
} as const;

export function HealthBadge({ health, className }: { health: Health; className?: string }) {
  const l = LEVEL[health.level];
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-sm whitespace-nowrap", className)}
      title={health.reasons.map((r) => `${r.text} (${r.points})`).join("\n") || "Healthy"}
    >
      <l.icon className={cn("size-4", l.color)} />
      <span className="font-medium tabular-nums">{health.score}</span>
      <span className="text-muted-foreground">{l.label}</span>
    </span>
  );
}
