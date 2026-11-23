import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { Flame } from "lucide-react";

import { WarmupSection } from "./warmup/WarmupSection";
import { setWarmup, WARMUP_DEFAULTS } from "./warmup/store";

export type SettingsSectionDef = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Heading above this item in the modal's left nav. Omit for the top block. */
  group?: string;
  component: ComponentType;
  /** Shows "Restore defaults" in the header when set. */
  restoreDefaults?: () => void;
};

/** Every section in the settings modal, in order. Add new ones here. */
export const settingsSections: SettingsSectionDef[] = [
  {
    id: "warmup",
    label: "Warm-up",
    icon: Flame,
    group: "Automation",
    component: WarmupSection,
    restoreDefaults: () => setWarmup(WARMUP_DEFAULTS),
  },
];
