// Account health: a 0–100 score with the reasons behind it.
import { parseTime } from "@/lib/time";

/** What the score needs. */
type HealthInput = {
  status: "ok" | "needs_attention";
  lastWarmupAt: string | null;
  captchas7d: number;
  errors7d: number;
};

export type HealthLevel = "good" | "fair" | "poor";
export type Health = { score: number; level: HealthLevel; reasons: { text: string; points: number }[] };

export function accountHealth(a: HealthInput): Health {
  const reasons: Health["reasons"] = [];
  const hit = (text: string, points: number) => points && reasons.push({ text, points: -points });

  if (a.status === "needs_attention") hit("Account issue", 30);

  if (a.lastWarmupAt === null) hit("Never warmed", 35);
  else {
    const days = (Date.now() - parseTime(a.lastWarmupAt).getTime()) / 86_400_000;
    if (days > 3) hit(`Inactive ${Math.floor(days)}d`, 25);
    else if (days > 1.5) hit("Inactive >1d", 10);
  }

  const { captchas7d: captchas, errors7d: errors } = a;
  hit(`${captchas} captcha${captchas === 1 ? "" : "s"} (7d)`, Math.min(24, captchas * 8));
  hit(`${errors} failed job${errors === 1 ? "" : "s"} (7d)`, Math.min(15, errors * 5));

  const score = Math.max(0, 100 + reasons.reduce((s, r) => s + r.points, 0));
  return { score, level: score >= 75 ? "good" : score >= 50 ? "fair" : "poor", reasons };
}
