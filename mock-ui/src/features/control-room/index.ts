import { LayoutGrid } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";

export const feature: Feature = {
  id: "control-room",
  label: "Control room",
  icon: LayoutGrid,
  group: "Phones",
  status: "draft",
  page: lazy(() => import("./Page")),
  wide: true,
};
