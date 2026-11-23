// A phone-shaped box that shows a fresh screenshot every few seconds (adb screencap).
// View only. For smooth video use "View screen", which opens scrcpy.
import { useEffect, useRef, useState } from "react";
import { ImageOff, Loader2, MoonStar, Sun } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ScreenSize = "sm" | "md" | "lg";

const WIDTH: Record<ScreenSize, string> = { sm: "w-40", md: "w-56", lg: "w-72" };

type Props = {
  serial: string;
  /** adb state is "device". No screenshots otherwise. */
  ready: boolean;
  paused?: boolean;
  size?: ScreenSize;
  /** Delay between screenshots. */
  everyMs?: number;
  /** Shown over the screen when it can't be captured. */
  unavailableText?: string;
};

export function LiveScreen({ serial, ready, paused = false, size = "md", everyMs = 3000, unavailableText }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [screenOff, setScreenOff] = useState(false);
  /** Bumped by Wake to take a screenshot right away. */
  const [kick, setKick] = useState(0);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || paused) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    // One request at a time: the next one is scheduled after this one ends.
    const tick = async () => {
      try {
        const bytes = await api.screenshot(serial);
        if (!alive) return;
        setError(null);
        setUpdatedAt(Date.now());
        // Empty = the screen is off; keep polling so it shows once it's on.
        setScreenOff(bytes.byteLength === 0);
        if (bytes.byteLength === 0) {
          timer = setTimeout(tick, everyMs);
          return;
        }
        const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setSrc(url);
      } catch (e) {
        if (alive) setError(String(e));
      }
      if (alive) timer = setTimeout(tick, everyMs);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [serial, ready, paused, everyMs, kick]);

  async function wake() {
    try {
      await api.wakeScreen(serial);
      setTimeout(() => setKick((k) => k + 1), 700);
    } catch (e) {
      toast.error(String(e));
    }
  }

  // Free the last image when the component goes away.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const overlay = !ready
    ? (unavailableText ?? "Phone not connected")
    : error && !src
      ? "Can't capture the screen"
      : null;

  return (
    <div className={cn("flex flex-col items-center gap-1", WIDTH[size])}>
      <div className="relative aspect-[9/19.5] w-full overflow-hidden rounded-2xl border-4 border-foreground/80 bg-black">
        {src && ready && !screenOff && (
          <img src={src} alt="Phone screen" className={cn("size-full object-contain", paused && "opacity-60")} />
        )}
        {ready && screenOff && !overlay ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-xs text-white/70">
            <MoonStar className="size-5" />
            Screen is off
            <Button size="sm" variant="secondary" onClick={wake}>
              <Sun /> Wake
            </Button>
          </div>
        ) : overlay ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-xs text-white/70">
            <ImageOff className="size-5" />
            {overlay}
          </div>
        ) : (
          !src && (
            <div className="absolute inset-0 flex items-center justify-center text-white/70">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )
        )}
      </div>
      <span className="h-4 text-[10px] text-muted-foreground tabular-nums" title={error ?? undefined}>
        {ready && updatedAt
          ? paused
            ? "Paused"
            : error
              ? "Retrying…"
              : `Updated ${new Date(updatedAt).toLocaleTimeString()}`
          : ""}
      </span>
    </div>
  );
}
