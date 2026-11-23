// Posts and their stats. Shared by the posting queue and the analytics pages.
import { useSyncExternalStore } from "react";

import { seeded } from "@/lib/mock";

export type PostStatus = "draft" | "scheduled" | "posting" | "posted" | "failed";

export type Post = {
  id: number;
  accountId: number;
  /** Fake file name; nothing is uploaded. */
  video: string;
  durationSec: number;
  caption: string;
  hashtags: string[];
  status: PostStatus;
  /** When it should go out (scheduled) or went out (posted). */
  at: string;
  error?: string;
  /** Background gradient for the fake thumbnail. */
  cover: string;
};

export type VideoStats = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  avgWatchSec: number;
  /** 0..1 */
  completionRate: number;
  newFollowers: number;
  /** Views per day since posting. */
  daily: { date: string; views: number }[];
  /** % of viewers still watching at each tenth of the video (0%..100%). */
  retention: number[];
  /** Where views came from, in %. */
  sources: { label: string; pct: number }[];
};

const COVERS = ["from-rose-500 to-orange-400", "from-sky-500 to-indigo-600", "from-emerald-500 to-teal-700", "from-fuchsia-500 to-purple-700", "from-amber-400 to-red-600", "from-slate-600 to-slate-900"];
const day = (d: number, h = 18) => {
  const t = new Date();
  t.setDate(t.getDate() + d);
  t.setHours(h, 0, 0, 0);
  return t.toISOString();
};

const seed = (): Post[] => [
  { id: 1, accountId: 1, video: "back-day-5-moves.mp4", durationSec: 28, caption: "5 moves for a stronger back 💪", hashtags: ["gym", "backday", "fitness"], status: "posted", at: day(-12), cover: COVERS[0] },
  { id: 2, accountId: 1, video: "protein-pancakes.mp4", durationSec: 41, caption: "High protein pancakes in 3 min", hashtags: ["protein", "breakfast"], status: "posted", at: day(-8), cover: COVERS[1] },
  { id: 3, accountId: 2, video: "sunday-prep.mp4", durationSec: 55, caption: "Meal prep Sunday: 5 lunches for $20", hashtags: ["mealprep", "budget"], status: "posted", at: day(-6), cover: COVERS[2] },
  { id: 4, accountId: 4, video: "one-pan-pasta.mp4", durationSec: 33, caption: "One pan pasta, 15 minutes", hashtags: ["pasta", "easyrecipes"], status: "posted", at: day(-4), cover: COVERS[4] },
  { id: 5, accountId: 1, video: "squat-mistakes.mp4", durationSec: 22, caption: "Stop doing squats like this ❌", hashtags: ["squat", "gymtips"], status: "posted", at: day(-2), cover: COVERS[3] },
  { id: 6, accountId: 3, video: "desk-stretch.mp4", durationSec: 37, caption: "Easy mobility routine for desk workers", hashtags: ["stretching", "mobility"], status: "failed", at: day(-1), error: "Captcha during upload", cover: COVERS[5] },
  { id: 7, accountId: 2, video: "chicken-bowls.mp4", durationSec: 46, caption: "Chicken rice bowls x5", hashtags: ["mealprep", "highprotein"], status: "scheduled", at: day(0, 20), cover: COVERS[2] },
  { id: 8, accountId: 1, video: "leg-day-finisher.mp4", durationSec: 30, caption: "Leg day finisher you'll hate", hashtags: ["legday", "gym"], status: "scheduled", at: day(1), cover: COVERS[0] },
  { id: 9, accountId: 4, video: "garlic-bread.mp4", durationSec: 25, caption: "Best garlic bread ever?", hashtags: ["garlicbread", "cooking"], status: "scheduled", at: day(2, 12), cover: COVERS[4] },
  { id: 10, accountId: 5, video: "first-lift.mp4", durationSec: 19, caption: "Day 1. Let's go.", hashtags: ["gymjourney"], status: "draft", at: day(3), cover: COVERS[3] },
];

let posts = seed();
let nextId = 11;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function usePosts() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => posts,
  );
}

export const postsApi = {
  add(p: Omit<Post, "id" | "cover">) {
    posts = [...posts, { ...p, id: nextId, cover: COVERS[nextId++ % COVERS.length] }];
    emit();
  },
  update(id: number, patch: Partial<Post>) {
    posts = posts.map((p) => (p.id === id ? { ...p, ...patch } : p));
    emit();
  },
  remove(id: number) {
    posts = posts.filter((p) => p.id !== id);
    emit();
  },
  /** Fake "post now": goes to posting, then posted after a moment. */
  postNow(id: number) {
    postsApi.update(id, { status: "posting", error: undefined });
    setTimeout(() => postsApi.update(id, { status: "posted", at: new Date().toISOString() }), 2500);
  },
  reset() {
    posts = seed();
    nextId = 11;
    emit();
  },
};

/** Made-up but stable stats for a posted video. */
export function videoStats(p: Post): VideoStats | null {
  if (p.status !== "posted") return null;
  const r = seeded(p.id * 7 + 3);
  const daysLive = Math.max(1, Math.round((Date.now() - new Date(p.at).getTime()) / 86_400_000));
  const viral = r() < 0.25 ? 6 + r() * 10 : 1;
  const daily: VideoStats["daily"] = [];
  let total = 0;
  for (let i = 0; i < Math.min(daysLive, 14); i++) {
    // Most views come in the first days, then it tails off.
    const v = Math.round((1500 + r() * 3000) * viral * Math.exp(-i / 2.2));
    total += v;
    const d = new Date(p.at);
    d.setDate(d.getDate() + i);
    daily.push({ date: d.toISOString().slice(0, 10), views: v });
  }
  const completion = 0.18 + r() * 0.35;
  const retention = Array.from({ length: 11 }, (_, i) =>
    Math.round(100 * (i === 0 ? 1 : Math.max(completion, Math.exp(-i * (0.12 + r() * 0.05))))),
  );
  retention[10] = Math.round(completion * 100);
  const fyp = 60 + Math.round(r() * 25);
  const search = Math.round((100 - fyp) * (0.3 + r() * 0.3));
  const profile = Math.round((100 - fyp - search) * 0.6);
  const likes = Math.round(total * (0.04 + r() * 0.06));
  return {
    views: total,
    likes,
    comments: Math.round(likes * (0.02 + r() * 0.04)),
    shares: Math.round(likes * (0.03 + r() * 0.08)),
    saves: Math.round(likes * (0.05 + r() * 0.1)),
    avgWatchSec: Math.round(p.durationSec * (0.35 + r() * 0.35)),
    completionRate: completion,
    newFollowers: Math.round(total * (0.002 + r() * 0.006)),
    daily,
    retention,
    sources: [
      { label: "For You", pct: fyp },
      { label: "Search", pct: search },
      { label: "Profile", pct: profile },
      { label: "Other", pct: 100 - fyp - search - profile },
    ],
  };
}

/** Engagement rate: (likes + comments + shares) / views. */
export const engagement = (s: VideoStats) => (s.views ? (s.likes + s.comments + s.shares) / s.views : 0);

export const fmtNum = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
