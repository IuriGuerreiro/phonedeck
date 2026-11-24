import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Group } from "@/api";

export type { Group };

/** Refresh periodically so desktop and web clients see each other's edits. */
export function useGroups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await api.listGroups();
      if (current === generation.current) { setGroups(next); setError(null); }
    } catch (e) {
      if (current === generation.current) setError(String(e));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 5000);
    return () => { clearInterval(timer); generation.current++; };
  }, [reload]);
  return { groups, error, loading, reload };
}
