import { Send } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";

export const feature: Feature = {
  id: "posting",
  label: "Posting",
  icon: Send,
  group: "Content",
  page: lazy(() => import("./Page")),
};
