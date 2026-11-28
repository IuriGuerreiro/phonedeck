import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

export type Feature = {
  /** Used in the URL hash, e.g. #accounts. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Sidebar section heading. */
  group: string;
  page: ComponentType;
  /** Hook returning a number to show next to the sidebar item (e.g. open alerts). 0 hides it. */
  useCount?: () => number;
  /** Use the full width instead of the centered column. */
  wide?: boolean;
};
