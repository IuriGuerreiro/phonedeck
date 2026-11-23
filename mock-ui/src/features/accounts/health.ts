// Account health: a 0–100 score with the reasons behind it.
import type { Account } from "./mock";

export type HealthLevel = "good" | "fair" | "poor";
export type Health = { score: number; level: HealthLevel; reasons: { text: string; points: number }[] };

export function accountHealth(a: Account): Health {
  const reasons: Health["reasons"] = [];
  const hit = (text: string, points: number) => points && reasons.push({ text, points: -points });

  if (a.status === "needs_attention") hit("Account issue", 30);

  if (a.lastWarmupAt === null) hit("Never warmed", 35);
  else {
    const days = (Date.now() - new Date(a.lastWarmupAt).getTime()) / 86_400_000;
    if (days > 3) hit(`Inactive ${Math.floor(days)}d`, 25);
    else if (days > 1.5) hit("Inactive >1d", 10);
  }

  hit(`${a.captchas7d} captcha${a.captchas7d === 1 ? "" : "s"} (7d)`, Math.min(24, a.captchas7d * 8));
  hit(`${a.errors7d} failed job${a.errors7d === 1 ? "" : "s"} (7d)`, Math.min(15, a.errors7d * 5));

  const score = Math.max(0, 100 + reasons.reduce((s, r) => s + r.points, 0));
  return { score, level: score >= 75 ? "good" : score >= 50 ? "fair" : "poor", reasons };
}
