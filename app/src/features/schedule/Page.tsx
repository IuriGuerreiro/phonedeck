// Scheduled warm-ups: what's planned, the schedules themselves, and what past runs did.
// The app runs them in the background (src-tauri/src/scheduler.rs), within Settings → Safety.
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ChevronDown, ChevronRight, Pencil, Play, Plus, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { api, type Schedule, type ScheduleRun, type UpcomingRun } from "@/api";
import { Switch } from "@/components/shared/Switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useGroups, type Group } from "@/data/groups";
import { parseTime, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useSettings } from "@/settings/SettingsContext";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Monday first, as most people read a week. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const NEW_SCHEDULE: Schedule = {
  id: null,
  name: "",
  enabled: true,
  groupId: null,
  days: [1, 2, 3, 4, 5, 6, 0],
  times: ["10:00"],
  minutes: 10,
  jitterMin: 20,
};

function daysText(days: number[]) {
  if (days.length === 7) return "Every day";
  const key = [...days].sort().join(",");
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "0,6") return "Weekends";
  return DAY_ORDER.filter((d) => days.includes(d)).map((d) => DAYS[d]).join(", ");
}

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingRun[]>([]);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const { groups } = useGroups();
  const { openSettings } = useSettings();

  const refresh = useCallback(() => {
    api.listSchedules().then(setSchedules, (e) => toast.error(String(e)));
    api.upcomingRuns(8).then(setUpcoming, () => {});
    api.scheduleRuns(20).then(setRuns, () => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function save(s: Schedule) {
    try {
      await api.saveSchedule(s);
      setEditing(null);
      toast.success("Schedule saved");
      refresh();
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function toggle(s: Schedule, enabled: boolean) {
    try {
      await api.saveSchedule({ ...s, enabled });
      refresh();
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function remove(s: Schedule) {
    if (!confirm(`Delete "${s.name}"?`)) return;
    await api.deleteSchedule(s.id!).catch((e) => toast.error(String(e)));
    refresh();
  }

  async function runNow(s: Schedule) {
    try {
      await api.runScheduleNow(s.id!);
      toast.success(`"${s.name}" started`);
      refresh();
    } catch (e) {
      toast.error(String(e));
    }
  }

  const groupName = (id: number | null) =>
    id === null ? "All accounts" : (groups.find((g) => g.id === id)?.name ?? "Deleted group");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Schedule</h1>
          <p className="text-sm text-muted-foreground">
            Warm-ups start on their own while Tapfleet is running. Quiet hours and daily limits from{" "}
            <button className="underline underline-offset-4" onClick={() => openSettings("safety")}>
              Safety
            </button>{" "}
            still apply.
          </p>
        </div>
        {!editing && (
          <Button onClick={() => setEditing(NEW_SCHEDULE)}>
            <Plus /> New schedule
          </Button>
        )}
      </div>

      {editing && <Editor initial={editing} groups={groups} onSave={save} onCancel={() => setEditing(null)} />}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex flex-col gap-4">
          {schedules === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : schedules.length === 0 && !editing ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                <CalendarClock className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No schedules yet. Warm-ups only run when you click.</p>
                <Button variant="outline" onClick={() => setEditing(NEW_SCHEDULE)}>
                  <Plus /> New schedule
                </Button>
              </CardContent>
            </Card>
          ) : (
            schedules.map((s) => (
              <Card key={s.id} className={cn(!s.enabled && "opacity-60")}>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{s.name}</CardTitle>
                    <CardDescription>
                      {groupName(s.groupId)} · {daysText(s.days)} · {s.times.join(", ")}
                    </CardDescription>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.minutes} min per account
                      {s.jitterMin > 0 && ` · starts up to ${s.jitterMin} min late at random`}
                    </p>
                  </div>
                  <Switch label="Enabled" checked={s.enabled} onChange={(v) => toggle(s, v)} />
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => runNow(s)}>
                    <Play /> Run now
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                    <Pencil /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(s)}>
                    <Trash2 /> Delete
                  </Button>
                </CardContent>
              </Card>
            ))
          )}

          <History runs={runs} onChange={refresh} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Next runs</CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing planned this week.</p>
            ) : (
              <ul className="flex flex-col divide-y text-sm">
                {upcoming.map((u) => (
                  <li key={`${u.scheduleId}-${u.date}-${u.at}`} className="flex justify-between gap-2 py-2">
                    <span className="truncate">{u.name}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {dayLabel(u.date)} {u.at}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** "Today", "Tomorrow" or "Wed 26". */
function dayLabel(date: string) {
  const d = new Date(`${date}T00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric" });
}

function Editor({
  initial,
  groups,
  onSave,
  onCancel,
}: {
  initial: Schedule;
  groups: Group[];
  onSave: (s: Schedule) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState<Schedule>(initial);
  const [newTime, setNewTime] = useState("18:00");
  const set = <K extends keyof Schedule>(k: K, v: Schedule[K]) => setS((cur) => ({ ...cur, [k]: v }));
  const toggleDay = (d: number) => set("days", s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d]);
  const addTime = () => {
    if (newTime && !s.times.includes(newTime)) set("times", [...s.times, newTime].sort());
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{initial.id ? "Edit schedule" : "New schedule"}</CardTitle>
        <Button variant="ghost" size="icon-sm" onClick={onCancel} title="Cancel">
          <X />
        </Button>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(s);
          }}
        >
          <Field label="Name">
            <Input autoFocus value={s.name} onChange={(e) => set("name", e.target.value)} placeholder="Morning warm-up" />
          </Field>

          <Field label="Accounts">
            <div className="flex flex-wrap gap-1">
              <Chip on={s.groupId === null} onClick={() => set("groupId", null)}>
                All accounts
              </Chip>
              {groups.map((g) => (
                <Chip key={g.id} on={s.groupId === g.id} onClick={() => set("groupId", g.id)}>
                  {g.name}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Days">
            <div className="flex flex-wrap gap-1">
              {DAY_ORDER.map((d) => (
                <Chip key={d} on={s.days.includes(d)} onClick={() => toggleDay(d)}>
                  {DAYS[d]}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Start times" hint="Every target account is warmed up at each time.">
            <div className="flex flex-wrap items-center gap-1">
              {s.times.map((t) => (
                <Badge key={t} variant="secondary" className="gap-1 tabular-nums">
                  {t}
                  <button
                    type="button"
                    title={`Remove ${t}`}
                    onClick={() => set("times", s.times.filter((x) => x !== t))}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
              <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="w-28" />
              <Button type="button" size="sm" variant="outline" onClick={addTime}>
                <Plus /> Add
              </Button>
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Minutes per account" hint="Shortened if the daily limit is closer.">
              <Input
                type="number"
                min={1}
                max={120}
                value={s.minutes}
                onChange={(e) => set("minutes", Number(e.target.value) || 1)}
              />
            </Field>
            <Field label="Random delay (min)" hint="So it doesn't start at the exact same minute every day.">
              <Input
                type="number"
                min={0}
                max={120}
                value={s.jitterMin}
                onChange={(e) => set("jitterMin", Math.max(0, Number(e.target.value) || 0))}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" size="sm" variant={on ? "secondary" : "outline"} onClick={onClick} aria-pressed={on}>
      {children}
    </Button>
  );
}

const STATUS: Record<ScheduleRun["status"], { label: string; variant: "secondary" | "outline" | "destructive" }> = {
  running: { label: "Running", variant: "secondary" },
  done: { label: "Done", variant: "secondary" },
  skipped: { label: "Skipped", variant: "outline" },
  stopped: { label: "Stopped", variant: "outline" },
};

function History({ runs, onChange }: { runs: ScheduleRun[]; onChange: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scheduled runs yet.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {runs.map((r) => {
              const counts = { ok: 0, skipped: 0, error: 0 };
              r.results.forEach((x) => counts[x.result]++);
              const expanded = open === r.id;
              return (
                <li key={r.id} className="py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => setOpen(expanded ? null : r.id)}
                    >
                      {expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                      <span className="truncate font-medium">{r.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground" title={parseTime(r.startedAt).toLocaleString()}>
                        {r.slot.startsWith("now") ? "Run now" : r.slot.slice(11)} · {timeAgo(r.startedAt)}
                      </span>
                    </button>
                    {r.status !== "running" && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {counts.ok} ok{counts.skipped ? ` · ${counts.skipped} skipped` : ""}
                        {counts.error ? ` · ${counts.error} failed` : ""}
                      </span>
                    )}
                    <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                    {r.status === "running" && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        title="Stop this run"
                        onClick={() => api.stopScheduleRun(r.id).then(onChange, (e) => toast.error(String(e)))}
                      >
                        <Square />
                      </Button>
                    )}
                  </div>
                  {expanded && (
                    <ul className="mt-2 ml-6 flex flex-col gap-1 text-xs">
                      {r.results.length === 0 && <li className="text-muted-foreground">Still running…</li>}
                      {r.results.map((x, i) => (
                        <li key={i} className="flex gap-2">
                          <span
                            className={cn(
                              "w-14 shrink-0",
                              x.result === "ok" && "text-[#0ca30c]",
                              x.result === "error" && "text-destructive",
                              x.result === "skipped" && "text-muted-foreground",
                            )}
                          >
                            {x.result}
                          </span>
                          <span className="shrink-0 font-medium">{x.account ? `@${x.account}` : "—"}</span>
                          <span className="text-muted-foreground">{x.note}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
