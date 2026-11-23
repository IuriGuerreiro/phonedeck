import { Smartphone } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";
import { devicesApi } from "@/mocks/devices";

export const feature: Feature = {
  id: "devices",
  label: "Devices",
  icon: Smartphone,
  group: "Phones",
  status: "draft",
  page: lazy(() => import("./Page")),
  reset: devicesApi.reset,
};
