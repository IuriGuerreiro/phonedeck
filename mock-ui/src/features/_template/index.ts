// Copy this folder to start a feature, then add it to src/features/index.ts.
import { Sparkles } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";
import { reset } from "./mock";

export const feature: Feature = {
  id: "my-feature",
  label: "My feature",
  icon: Sparkles,
  group: "Ideas",
  status: "draft",
  page: lazy(() => import("./Page")),
  reset,
};
