import { Bell } from "lucide-react";
import { lazy } from "react";

import { useAlerts } from "@/data/alerts";
import type { Feature } from "@/features/types";

export const feature: Feature = {
  id: "alerts",
  label: "Alerts",
  icon: Bell,
  group: "Overview",
  page: lazy(() => import("./Page")),
  useCount: () => useAlerts().alerts.filter((a) => !a.resolvedAt).length,
};
