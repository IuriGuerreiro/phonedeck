import { Users } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";

export const feature: Feature = {
  id: "accounts",
  label: "Accounts",
  icon: Users,
  group: "Manage",
  page: lazy(() => import("./Page")),
};
