import { Smartphone } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";
import { devicesApi } from "@/mocks/devices";

export const feature: Feature = {
  id: "devices",
  label: "Devices",
  icon: Smartphone,
  group: "Manage",
  status: "draft",
  wide: true,
  page: lazy(() => import("./Page")),
  reset: devicesApi.reset,
};
