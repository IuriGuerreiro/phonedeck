import { Bell } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";
import { alertsApi, useAlerts } from "@/mocks/alerts";

export const feature: Feature = {
  id: "alerts",
  label: "Alerts",
  icon: Bell,
  group: "Overview",
  preview: true,
  page: lazy(() => import("./Page")),
  reset: alertsApi.reset,
  useCount: () => useAlerts().filter((a) => !a.solvedAt).length,
};
