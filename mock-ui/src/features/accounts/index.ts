import { Users } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";
import { reset } from "./mock";

export const feature: Feature = {
  id: "accounts",
  label: "Accounts",
  icon: Users,
  group: "Manage",
  status: "shipped",
  page: lazy(() => import("./Page")),
  reset,
};
