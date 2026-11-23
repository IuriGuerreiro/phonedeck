import { Rocket } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";
import { reset } from "./mock";

export const feature: Feature = {
  id: "onboarding",
  label: "Setup",
  icon: Rocket,
  group: "Getting started",
  status: "shipped",
  page: lazy(() => import("./Page")),
  reset,
};
