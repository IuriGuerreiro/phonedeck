// Screens that stopped a job. Shared by the Alerts page, the dashboard and the sidebar badge.
import { useSyncExternalStore } from "react";

import { api, type Alert } from "@/api";

type State = { alerts: Alert[]; error: string | null; loading: boolean };
let state: State = { alerts: [], error: null, loading: true };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

export async function reloadAlerts() {
  try {
    state = { alerts: await api.listAlerts(), error: null, loading: false };
  } catch (e) {
    state = { ...state, error: String(e), loading: false };
  }
  listeners.forEach((l) => l());
}

export function useAlerts(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      if (listeners.size === 1) {
        void reloadAlerts();
        timer = setInterval(reloadAlerts, 5000);
      }
      return () => {
        listeners.delete(l);
        if (listeners.size === 0) clearInterval(timer);
      };
    },
    () => state,
  );
}
