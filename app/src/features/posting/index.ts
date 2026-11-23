import { Send } from "lucide-react";
import { lazy } from "react";

import type { Feature } from "@/features/types";
import { postsApi } from "@/mocks/posts";

export const feature: Feature = {
  id: "posting",
  label: "Posting",
  icon: Send,
  group: "Content",
  preview: true,
  page: lazy(() => import("./Page")),
  reset: postsApi.reset,
};
