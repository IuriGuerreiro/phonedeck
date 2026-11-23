import { ChartLine } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";

export const feature: Feature = {
  id: "account-analytics",
  label: "Accounts",
  icon: ChartLine,
  group: "Analytics",
  preview: true,
  page: lazy(() => import("./Page")),
  wide: true,
};
