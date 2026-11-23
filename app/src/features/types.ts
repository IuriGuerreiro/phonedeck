import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

export type Feature = {
  /** Used in the URL hash, e.g. #accounts. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Sidebar section heading. */
  group: string;
  /** Not wired to real data yet: shows sample data and a "Preview" badge. */
  preview?: boolean;
  page: ComponentType;
  /** Preview pages only: put the sample data back to its start. Shown as a Reset button. */
  reset?: () => void;
  /** Hook returning a number to show next to the sidebar item (e.g. open alerts). 0 hides it. */
  useCount?: () => number;
  /** Use the full width instead of the centered column. */
  wide?: boolean;
};
