import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";

/** Form values, kept as typed strings so fields can be cleared while editing. */
export type WarmupForm = {
  minutes: string;
  watchMinSec: string;
  watchMaxSec: string;
  likePct: string;
  followPct: string;
  /** Comma-separated niche keywords. */
  keywords: string;
};

/** What the worker's warm-up job takes. */
export type WarmupOptions = {
  minutes: number;
  watchMinSec: number;
  watchMaxSec: number;
  likeChance: number;
  followChance: number;
  keywords: string[];
};

const DEFAULTS: WarmupForm = {
  minutes: "10",
  watchMinSec: "5",
  watchMaxSec: "20",
  likePct: "10",
  followPct: "2",
  keywords: "",
};

const STORAGE_KEY = "phonedeck.warmup";

/** Warm-up settings, remembered between app launches. */
export function useWarmupSettings() {
  const [form, setForm] = useState<WarmupForm>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : DEFAULTS;
    } catch {
      return DEFAULTS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      // Not saved; the settings still work for this session.
    }
  }, [form]);

  return [form, setForm] as const;
}

export function toOptions(f: WarmupForm): WarmupOptions {
  const watchMinSec = num(f.watchMinSec, 1, 600, 5);
  return {
    minutes: num(f.minutes, 1, 120, 10),
    watchMinSec,
    watchMaxSec: Math.max(watchMinSec, num(f.watchMaxSec, 1, 600, 20)),
    likeChance: num(f.likePct, 0, 100, 10) / 100,
    followChance: num(f.followPct, 0, 100, 2) / 100,
    keywords: f.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  };
}

export function WarmupSettings({
  form,
  onChange,
}: {
  form: WarmupForm;
  onChange: (f: WarmupForm) => void;
}) {
  const set = (key: keyof WarmupForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...form, [key]: e.target.value });

  return (
    <div className="grid gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))]">
      <Field label="Minutes per account">
        <Input type="number" min={1} max={120} value={form.minutes} onChange={set("minutes")} />
      </Field>
      <Field label="Seconds per video (min–max)">
        <div className="flex items-center gap-1.5">
          <Input type="number" min={1} max={600} value={form.watchMinSec} onChange={set("watchMinSec")} />
          <span className="text-muted-foreground">–</span>
          <Input type="number" min={1} max={600} value={form.watchMaxSec} onChange={set("watchMaxSec")} />
        </div>
      </Field>
      <Field label="Like %">
        <Input type="number" min={0} max={100} value={form.likePct} onChange={set("likePct")} />
      </Field>
      <Field label="Follow %">
        <Input type="number" min={0} max={100} value={form.followPct} onChange={set("followPct")} />
      </Field>
      <Field
        label="Niche keywords (comma-separated, empty = For You feed)"
        className="sm:col-span-4"
      >
        <Input
          value={form.keywords}
          onChange={set("keywords")}
          placeholder="e.g. gym workout, healthy recipes, meal prep"
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-xs text-muted-foreground ${className ?? ""}`}>
      {label}
      {children}
    </label>
  );
}

/** Parse a typed number, clamped to [min, max]; `fallback` when it isn't a number. */
function num(v: string, min: number, max: number, fallback: number) {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
