import { History } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";

export const feature: Feature = {
  id: "activity",
  label: "Activity",
  icon: History,
  group: "Overview",
  page: lazy(() => import("./Page")),
};
