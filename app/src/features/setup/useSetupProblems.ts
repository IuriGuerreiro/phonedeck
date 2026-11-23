// Number of required PC tools that are missing. Shown as the Setup badge.
import { useEffect, useState } from "react";

import { setupApi } from "@/setup/api";

export function useSetupProblems() {
  const [n, setN] = useState(0);
  useEffect(() => {
    setupApi
      .status()
      .then((s) => setN(s.tools.filter((t) => !t.ok && !t.optional).length))
      .catch(() => {});
  }, []);
  return n;
}
