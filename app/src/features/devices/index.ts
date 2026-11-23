import { Smartphone } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";

export const feature: Feature = {
  id: "devices",
  label: "Devices",
  icon: Smartphone,
  group: "Manage",
  wide: true,
  page: lazy(() => import("./Page")),
};
