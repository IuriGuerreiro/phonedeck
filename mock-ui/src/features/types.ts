import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

export type FeatureStatus = "draft" | "ready" | "shipped";

export type Feature = {
  /** Used in the URL hash, e.g. #tiktok-accounts. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Sidebar section heading. */
  group: string;
  /** draft = being explored, ready = worth building, shipped = already in app/. */
  status: FeatureStatus;
  page: ComponentType;
  /** Put the feature's fake data back to its start. Shown as a Reset button. */
  reset?: () => void;
  /** Hook returning a number to show next to the sidebar item (e.g. open alerts). 0 hides it. */
  useCount?: () => number;
  /** Use the full width instead of the centered column. */
  wide?: boolean;
};
