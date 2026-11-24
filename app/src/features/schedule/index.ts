import { CalendarClock } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";

export const feature: Feature = {
  id: "schedule",
  label: "Schedule",
  icon: CalendarClock,
  group: "Manage",
  page: lazy(() => import("./Page")),
};
