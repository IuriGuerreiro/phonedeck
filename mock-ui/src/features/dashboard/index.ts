import { LayoutDashboard } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";

export const feature: Feature = {
  id: "dashboard",
  label: "Dashboard",
  icon: LayoutDashboard,
  group: "Overview",
  status: "draft",
  page: lazy(() => import("./Page")),
};
