// Alerts inbox data. Shared by the alerts page, the dashboard and the sidebar badge.
import { useSyncExternalStore } from "react";

export type AlertKind = "captcha" | "offline" | "logged_out" | "job_failed" | "limit_reached";

export type Alert = {
  id: number;
  kind: AlertKind;
  title: string;
  detail: string;
  /** Phone serial, if the alert is about a phone. */
  serial?: string;
  /** Account id, if the alert is about an account. */
  accountId?: number;
  at: string;
  solvedAt: string | null;
};

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const seed = (): Alert[] => [
  {
    id: 1,
    kind: "captcha",
    title: "Captcha on @daily.stretch",
    detail: "TikTok showed a captcha after switching accounts. Solve it on the phone, then mark this solved.",
    serial: "R58N12ABCDE",
    accountId: 3,
    at: minsAgo(40),
    solvedAt: null,
  },
  {
    id: 2,
    kind: "offline",
    title: "Old Pixel is not allowed",
    detail: "The phone is connected but USB debugging was not accepted. Unlock it and tap Allow.",
    serial: "ZY22H7KLMN",
    at: minsAgo(3),
    solvedAt: null,
  },
  {
    id: 3,
    kind: "logged_out",
    title: "@lift.log was logged out",
    detail: "The account is no longer in TikTok's account list. Log in again on the phone.",
    serial: "1A2B3C4D5E",
    accountId: 5,
    at: minsAgo(190),
    solvedAt: null,
  },
  {
    id: 4,
    kind: "limit_reached",
    title: "Daily like limit reached for @fit.with.ana",
    detail: "Likes are paused for this account until tomorrow. Change it in Settings → Safety limits.",
    accountId: 1,
    at: minsAgo(15),
    solvedAt: null,
  },
  {
    id: 5,
    kind: "job_failed",
    title: "Warm-up failed for @mealprep_mike",
    detail: "TikTok did not open in time. It worked on the next try.",
    serial: "R58N12ABCDE",
    accountId: 2,
    at: minsAgo(600),
    solvedAt: minsAgo(560),
  },
];

let alerts = seed();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useAlerts() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => alerts,
  );
}

export const alertsApi = {
  solve(id: number) {
    alerts = alerts.map((a) => (a.id === id ? { ...a, solvedAt: new Date().toISOString() } : a));
    emit();
  },
  reopen(id: number) {
    alerts = alerts.map((a) => (a.id === id ? { ...a, solvedAt: null } : a));
    emit();
  },
  solveAll() {
    const now = new Date().toISOString();
    alerts = alerts.map((a) => (a.solvedAt ? a : { ...a, solvedAt: now }));
    emit();
  },
  reset() {
    alerts = seed();
    emit();
  },
};
