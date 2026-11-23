// Fake scrcpy view: a phone frame showing what the automation is doing.
// Nothing real is streamed; the "feed" is generated and scrolls on a timer.
import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  Circle,
  Heart,

  Maximize2,
  MessageCircle,
  Monitor,
  Music2,
  Pause,
  Play,
  Plus,
  Search,
  Share2,
  Square,
  Triangle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { randInt } from "@/lib/mock";
import { cn } from "@/lib/utils";
import type { Device, LiveTask } from "@/mocks/devices";

const GRADIENTS = [
  "from-rose-500 to-orange-400",
  "from-sky-500 to-indigo-600",
  "from-emerald-500 to-teal-700",
  "from-fuchsia-500 to-purple-700",
  "from-amber-400 to-red-600",
  "from-slate-600 to-slate-900",
];
const CREATORS = ["coach.dani", "proteinpancakes", "liftwithlena", "mealprep.daily", "stretch.guru", "homegymhero"];
const CAPTIONS = [
  "5 moves for a stronger back 💪",
  "High protein breakfast in 3 min",
  "Day 41 of my gym journey",
  "Meal prep Sunday: 5 lunches",
  "Stop doing squats like this ❌",
  "Easy mobility routine for desk workers",
];

type Video = { id: number; gradient: string; creator: string; caption: string; likes: number; watchSec: number };

function makeVideo(id: number): Video {
  return {
    id,
    gradient: GRADIENTS[randInt(0, GRADIENTS.length - 1)],
    creator: CREATORS[randInt(0, CREATORS.length - 1)],
    caption: CAPTIONS[randInt(0, CAPTIONS.length - 1)],
    likes: randInt(800, 250_000),
    watchSec: randInt(3, 7),
  };
}

type LogLine = { id: number; text: string };

export function ScreenMirror({ device, task }: { device: Device; task: LiveTask }) {
  const [paused, setPaused] = useState(false);
  const [big, setBig] = useState(false);

  return (
    <Card className="lg:sticky lg:top-6">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Monitor className="size-4" /> Live screen
        </CardTitle>
        <div className="flex items-center gap-1">
          {task.kind !== "no_screen" && (
            <Badge variant={paused ? "outline" : "secondary"} className="gap-1">
              <span className={cn("size-1.5 rounded-full", paused ? "bg-muted-foreground" : "animate-pulse bg-red-500")} />
              {paused ? "Paused" : "Live"}
            </Badge>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            title={paused ? "Resume view" : "Pause view"}
            disabled={task.kind === "no_screen"}
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play /> : <Pause />}
          </Button>
          <Button size="icon-sm" variant="ghost" title={big ? "Smaller" : "Bigger"} onClick={() => setBig(!big)}>
            <Maximize2 />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        <LiveScreen serial={device.serial} task={task} paused={paused} size={big ? "lg" : "md"} />
        {task.kind === "idle" && <p className="text-xs text-muted-foreground">Idle. Nothing is running.</p>}
      </CardContent>
    </Card>
  );
}

export type ScreenSize = "sm" | "md" | "lg";

/** The phone screen for whatever the phone is doing. `sm` is the compact control-room size. */
export function LiveScreen({ serial, task, paused, size }: { serial: string; task: LiveTask; paused: boolean; size: ScreenSize }) {
  if (task.kind === "warmup") return <WarmupScreen key={serial} task={task} paused={paused} size={size} />;
  return (
    <PhoneFrame size={size}>
      {task.kind === "idle" ? (
        <HomeScreen />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-neutral-950 p-4 text-center text-xs text-neutral-400">
          <Monitor className="size-8" />
          No screen
          {size !== "sm" && <span className="text-neutral-500">{task.reason}</span>}
        </div>
      )}
    </PhoneFrame>
  );
}

function WarmupScreen({ task, paused, size }: { task: Extract<LiveTask, { kind: "warmup" }>; paused: boolean; size: ScreenSize }) {
  const nextId = useRef(1);
  const [videos, setVideos] = useState(() => [makeVideo(0), makeVideo(1)]);
  const [index, setIndex] = useState(0);
  const [liked, setLiked] = useState<Set<number>>(new Set());
  const [heart, setHeart] = useState<number | null>(null);
  const [log, setLog] = useState<LogLine[]>([{ id: 0, text: `Warm-up started for @${task.account}` }]);
  const current = videos[index];

  const addLog = (text: string) => setLog((l) => [{ id: Date.now() + Math.random(), text }, ...l].slice(0, 6));

  // Each video: watch for a while, maybe like, then swipe up.
  useEffect(() => {
    if (paused) return;
    const v = current;
    addLog(`Watching @${v.creator} for ${v.watchSec}s`);
    const timers: number[] = [];
    if (Math.random() < 0.35) {
      timers.push(
        window.setTimeout(() => {
          setLiked((s) => new Set(s).add(v.id));
          setHeart(v.id);
          addLog(`Liked @${v.creator}`);
          window.setTimeout(() => setHeart(null), 900);
        }, (v.watchSec * 1000) / 2),
      );
    }
    timers.push(
      window.setTimeout(() => {
        addLog("Swipe up");
        setVideos((vs) => [...vs, makeVideo(++nextId.current)]);
        setIndex((i) => i + 1);
      }, v.watchSec * 1000),
    );
    return () => timers.forEach(clearTimeout);
  }, [index, paused]);

  return (
    <>
      <PhoneFrame size={size}>
        <div className="relative h-full overflow-hidden bg-black">
          <div
            className="h-full transition-transform duration-500 ease-out"
            style={{ transform: `translateY(-${index * 100}%)` }}
          >
            {videos.map((v) => (
              <VideoSlide key={v.id} video={v} liked={liked.has(v.id)} showHeart={heart === v.id} />
            ))}
          </div>
          <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-3 pt-6 text-[10px] font-semibold text-white/90">
            <span className="text-white/60">Following</span>
            <span className="border-b border-white pb-0.5">For You</span>
            <Search className="absolute right-3 size-3.5" />
          </div>
        </div>
      </PhoneFrame>

      {size !== "sm" && <div className="w-full rounded-lg border bg-muted/40 p-2">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-medium">Warm-up · @{task.account}</span>
          <span className="text-muted-foreground">Video {index + 1}</span>
        </div>
        <ul className="flex flex-col gap-0.5 font-mono text-[11px] text-muted-foreground">
          {log.map((l, i) => (
            <li key={l.id} className={cn(i === 0 && "text-foreground")}>
              {l.text}
            </li>
          ))}
        </ul>
      </div>}
    </>
  );
}

function VideoSlide({ video: v, liked, showHeart }: { video: Video; liked: boolean; showHeart: boolean }) {
  return (
    <div className={cn("relative h-full w-full bg-gradient-to-br text-white", v.gradient)}>
      {showHeart && (
        <Heart className="absolute top-1/2 left-1/2 size-16 -translate-1/2 animate-in zoom-in-50 fade-in fill-red-500 text-red-500 duration-300" />
      )}
      <div className="absolute right-2 bottom-16 flex flex-col items-center gap-3 text-[9px]">
        <div className="relative">
          <div className="size-8 rounded-full border-2 border-white bg-white/30" />
          <Plus className="absolute -bottom-1.5 left-1/2 size-3.5 -translate-x-1/2 rounded-full bg-red-500 p-0.5" />
        </div>
        <Stat icon={<Heart className={cn("size-5", liked && "fill-red-500 text-red-500")} />} label={fmt(v.likes + (liked ? 1 : 0))} />
        <Stat icon={<MessageCircle className="size-5" />} label={fmt(Math.round(v.likes / 40))} />
        <Stat icon={<Bookmark className="size-5" />} label={fmt(Math.round(v.likes / 25))} />
        <Stat icon={<Share2 className="size-5" />} label="Share" />
      </div>
      <div className="absolute right-12 bottom-4 left-3 flex flex-col gap-1 text-[10px]">
        <span className="font-semibold">@{v.creator}</span>
        <span className="line-clamp-2">{v.caption}</span>
        <span className="flex items-center gap-1 text-white/80">
          <Music2 className="size-3" /> original sound
        </span>
      </div>
    </div>
  );
}

function Stat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      {icon}
      {label}
    </div>
  );
}

function HomeScreen() {
  const apps = ["bg-pink-500", "bg-sky-500", "bg-green-500", "bg-black ring-1 ring-white/30", "bg-amber-500", "bg-indigo-500", "bg-red-500", "bg-teal-500"];
  return (
    <div className="flex h-full flex-col justify-between bg-gradient-to-b from-indigo-900 to-slate-900 p-4 pt-10 text-white">
      <div className="text-center">
        <div className="text-3xl font-light">
          {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
        <div className="text-[10px] text-white/70">{new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>
      </div>
      <div className="grid grid-cols-4 gap-3 pb-2">
        {apps.map((c, i) => (
          <div key={i} className={cn("aspect-square rounded-xl", c)} />
        ))}
      </div>
    </div>
  );
}

/** Phone outline with a status bar and Android nav buttons. */
const FRAME_WIDTH: Record<ScreenSize, string> = { sm: "w-40", md: "w-56", lg: "w-72" };

function PhoneFrame({ size, children }: { size: ScreenSize; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 transition-all", FRAME_WIDTH[size])}>
      <div className="relative aspect-[9/19.5] w-full overflow-hidden rounded-[2rem] border-[6px] border-neutral-900 bg-black shadow-xl dark:border-neutral-700">
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-1.5 text-[9px] font-medium text-white">
          <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <span className="absolute top-1.5 left-1/2 size-2 -translate-x-1/2 rounded-full bg-neutral-900" />
          <span>82%</span>
        </div>
        {children}
      </div>
      {size !== "sm" && <div className="flex gap-6 text-muted-foreground">
        <Button size="icon-xs" variant="ghost" title="Back (mock)">
          <Triangle className="-rotate-90" />
        </Button>
        <Button size="icon-xs" variant="ghost" title="Home (mock)">
          <Circle />
        </Button>
        <Button size="icon-xs" variant="ghost" title="Recent apps (mock)">
          <Square />
        </Button>
      </div>}
    </div>
  );
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));

