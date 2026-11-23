import { ChartLine } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";

export const feature: Feature = {
  id: "account-analytics",
  label: "Account analytics",
  icon: ChartLine,
  group: "Analytics",
  status: "draft",
  page: lazy(() => import("./Page")),
  wide: true,
};
