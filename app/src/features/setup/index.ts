import { Wrench } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";
import { useSetupProblems } from "./useSetupProblems";

export const feature: Feature = {
  id: "setup",
  label: "Setup",
  icon: Wrench,
  group: "Getting started",
  page: lazy(() => import("./Page")),
  useCount: useSetupProblems,
};
