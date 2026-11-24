import { Clapperboard } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";

export const feature: Feature = {
  id: "video-analytics",
  label: "Videos",
  icon: Clapperboard,
  group: "Analytics",
  page: lazy(() => import("./Page")),
};
