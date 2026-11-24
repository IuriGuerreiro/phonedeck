import { CircleHelp, MessageSquareX, ShieldAlert, TriangleAlert, UserX } from "lucide-react";

import type { Alert, AlertKind } from "@/api";

export const ALERT_KIND: Record<AlertKind, { label: string; icon: typeof CircleHelp; color: string }> = {
  captcha: { label: "Captcha", icon: ShieldAlert, color: "text-[#d9900a]" },
  logged_out: { label: "Logged out", icon: UserX, color: "text-[#d03b3b]" },
  account_warning: { label: "Account warning", icon: TriangleAlert, color: "text-[#d03b3b]" },
  popup: { label: "Popup", icon: MessageSquareX, color: "text-[#d9900a]" },
  unknown: { label: "Unknown screen", icon: CircleHelp, color: "text-[#d9900a]" },
};

export const alertTitle = (a: Alert) => `${ALERT_KIND[a.kind].label}${a.username ? ` on @${a.username}` : ""}`;
