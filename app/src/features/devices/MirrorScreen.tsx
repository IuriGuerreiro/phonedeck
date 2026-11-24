// Live, controllable phone screen (scrcpy). Video arrives as H.264 over a WebSocket and is
// decoded with WebCodecs; taps, swipes, scrolls and typing go back on the same socket.
// Server side: src-tauri/src/mirror.rs. Falls back to screenshots when this can't run.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Circle,
  Loader2,
  Power,
  RotateCcw,
  Square,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { api } from "@/api";
import { mirrorUrl } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { PcmPlayer } from "./pcm-player";
import { LiveScreen, type ScreenSize } from "./LiveScreen";

/** Widest the phone gets, per size. It also shrinks so the phone + buttons fit the window height. */
const WIDTH_PX: Record<ScreenSize, number> = { sm: 176, md: 240, lg: 320 };
/** Longest video side asked from the phone, per tile size. */
const MAX_SIZE: Record<ScreenSize, number> = { sm: 640, md: 800, lg: 1024 };

/** Android keycodes used by the buttons and the keyboard. */
const KEY = {
  home: 3,
  power: 26,
  volUp: 24,
  volDown: 25,
  recents: 187,
  enter: 66,
  del: 67,
  forwardDel: 112,
  tab: 61,
  up: 19,
  down: 20,
  left: 21,
  right: 22,
  escape: 111,
} as const;

const KEYBOARD: Record<string, number> = {
  Enter: KEY.enter,
  Backspace: KEY.del,
  Delete: KEY.forwardDel,
  Tab: KEY.tab,
  ArrowUp: KEY.up,
  ArrowDown: KEY.down,
  ArrowLeft: KEY.left,
  ArrowRight: KEY.right,
};

type Status = "connecting" | "live" | "error";

type Props = {
  serial: string;
  /** adb state is "device". */
  ready: boolean;
  size?: ScreenSize;
  /** Disconnects the stream (e.g. "Pause screens"). */
  paused?: boolean;
  /** Shown when the phone isn't connected. */
  unavailableText?: string;
};

/**
 * WebCodecs only exists on secure pages (HTTPS or localhost). Elsewhere, e.g. http://<tailscale-ip>,
 * the screen falls back to screenshots, but control still goes through scrcpy.
 */
const canDecode = typeof window !== "undefined" && "VideoDecoder" in window;

/** Screenshot loop for the no-video mode. One request at a time. */
function useScreenshot(serial: string, enabled: boolean, everyMs: number) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let url: string | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const bytes = await api.screenshot(serial);
        // Empty = screen off (or a secure screen); keep the last picture.
        if (alive && bytes.byteLength) {
          const next = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
          if (url) URL.revokeObjectURL(url);
          url = next;
          setSrc(next);
        }
      } catch {
        // Try again next tick.
      }
      if (alive) timer = setTimeout(tick, everyMs);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [serial, enabled, everyMs]);
  return src;
}

export function MirrorScreen({ serial, ready, size = "md", paused = false, unavailableText }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<PcmPlayer | null>(null);
  const [sound, setSound] = useState<"playing" | "blocked" | "muted" | "unavailable">("blocked");
  const videoSize = useRef({ w: 0, h: 0 });
  const [aspect, setAspect] = useState(9 / 19.5);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // No-video mode: a screenshot about every 0.8s under the control layer.
  const shot = useScreenshot(serial, !canDecode && ready && !paused && status === "live", 800);

  useEffect(() => {
    if (!ready || paused) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let decoder: VideoDecoder | null = null;
    let needKey = true;
    let timestamp = 0;
    let live = false;
    let failed = false;
    setSound("blocked");
    let audio: PcmPlayer | null = null;
    try {
      audio = new PcmPlayer((playing) => {
        if (!closed) setSound(playing ? "playing" : "blocked");
      });
      audioRef.current = audio;
    } catch {
      setSound("unavailable");
    }
    setStatus("connecting");
    setError(null);

    // First error wins: the server's message arrives just before the socket closes.
    const fail = (msg: string) => {
      if (closed || failed) return;
      failed = true;
      audio?.close();
      audioRef.current = null;
      setError(msg);
      setStatus("error");
    };

    const draw = (frame: VideoFrame) => {
      const c = canvasRef.current;
      if (c) {
        if (c.width !== frame.displayWidth || c.height !== frame.displayHeight) {
          c.width = frame.displayWidth;
          c.height = frame.displayHeight;
        }
        c.getContext("2d")?.drawImage(frame, 0, 0);
      }
      frame.close();
      if (!live) {
        live = true;
        setStatus("live");
      }
    };

    (async () => {
      const url = await mirrorUrl(serial, MAX_SIZE[size], canDecode, audio !== null);
      if (closed) return;
      if (!url) return fail("Web access is off (SMA_WEB=0), so the live screen can't run.");
      ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onmessage = (e) => {
        if (typeof e.data === "string") {
          const m = JSON.parse(e.data);
          if (m.type === "size") {
            videoSize.current = { w: m.width, h: m.height };
            setAspect(m.width / m.height);
            // No video in this mode: the size means the phone is ready for input.
            if (!canDecode && !live) {
              live = true;
              setStatus("live");
            }
          } else if (m.type === "audio" && m.ok === false) {
            audio?.close();
            audioRef.current = null;
            setSound("unavailable");
          } else if (m.type === "error") {
            fail(m.message);
          }
          return;
        }
        const bytes = new Uint8Array(e.data);
        const flags = bytes[0];
        const data = bytes.subarray(1);
        if (flags & 4) {
          audio?.push(data);
          return;
        }
        if (flags & 1) {
          // SPS/PPS: (re)start the decoder with them as an avcC record.
          // avcC + length-prefixed packets (like MP4) works in WebKit as well as Chrome.
          const nals = splitNals(data);
          const sps = nals.find((n) => (n[0] & 0x1f) === 7);
          const pps = nals.find((n) => (n[0] & 0x1f) === 8);
          if (!sps || !pps) return fail("The phone sent a video header this app can't read.");
          decoder?.close();
          decoder = new VideoDecoder({ output: draw, error: (err) => fail(`Video decoder: ${err.message}`) });
          try {
            decoder.configure({ codec: codecString(sps), description: avcC(sps, pps), optimizeForLatency: true });
          } catch (err) {
            fail(`This browser can't decode the stream: ${err}`);
          }
          needKey = true;
          return;
        }
        if (!decoder || decoder.state !== "configured") return;
        const key = (flags & 2) !== 0;
        if (needKey && !key) return;
        needKey = false;
        timestamp += 33_333;
        decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp, data: toLengthPrefixed(data) }));
      };
      ws.onerror = () => fail("Couldn't connect to the live screen.");
      ws.onclose = () => fail("The live screen stopped.");
    })();

    return () => {
      closed = true;
      audio?.close();
      audioRef.current = null;
      wsRef.current = null;
      ws?.close();
      if (decoder && decoder.state !== "closed") decoder.close();
    };
  }, [serial, ready, paused, size, attempt]);

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  /** Pointer position in video pixels. */
  const toVideo = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const { w, h } = videoSize.current;
    const clamp = (v: number, max: number) => Math.min(max - 1, Math.max(0, Math.round(v)));
    return { x: clamp(((e.clientX - r.left) / r.width) * w, w), y: clamp(((e.clientY - r.top) / r.height) * h, h), w, h };
  };

  const down = useRef(false);
  const onPointer = (action: "down" | "move" | "up") => (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!videoSize.current.w) return;
    if (action === "down") {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      // Focus for typing, without scrolling the page to the canvas.
      e.currentTarget.focus({ preventScroll: true });
      down.current = true;
    } else if (!down.current) {
      return;
    }
    if (action === "up") down.current = false;
    send({ t: "touch", action, ...toVideo(e) });
  };

  // Wheel needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      if (!videoSize.current.w) return;
      e.preventDefault();
      send({ t: "scroll", ...toVideo(e), dx: -Math.sign(e.deltaX), dy: -Math.sign(e.deltaY) });
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [send, status]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      navigator.clipboard?.readText().then((text) => text && send({ t: "text", text }), () => {});
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") {
      e.preventDefault();
      send({ t: "back" });
    } else if (KEYBOARD[e.key]) {
      e.preventDefault();
      send({ t: "key", keycode: KEYBOARD[e.key] });
    } else if (e.key.length === 1) {
      e.preventDefault();
      send({ t: "text", text: e.key });
    }
  };

  if (!ready) {
    return <LiveScreen serial={serial} ready={false} size={size} unavailableText={unavailableText} />;
  }

  const key = (keycode: number) => () => send({ t: "key", keycode });

  return (
    <div
      className="flex flex-col items-center gap-2"
      // Leave room for the page header and the button row below the phone.
      style={{ width: `min(${WIDTH_PX[size]}px, calc((100vh - 12rem) * ${aspect}))` }}
    >
      <div
        className="relative w-full overflow-hidden rounded-2xl border-4 border-foreground/80 bg-black"
        style={{ aspectRatio: aspect }}
      >
        {!canDecode && shot && (
          <img src={shot} alt="" className="pointer-events-none absolute inset-0 size-full object-fill" />
        )}
        <canvas
          ref={canvasRef}
          tabIndex={0}
          title="Click and drag to control. Type to send text. Esc = back."
          className={cn(
            // relative: stays above the screenshot <img> in no-video mode.
            "relative size-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
            status !== "live" && "invisible",
          )}
          onPointerDown={onPointer("down")}
          onPointerMove={onPointer("move")}
          onPointerUp={onPointer("up")}
          onPointerCancel={onPointer("up")}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => {
            e.preventDefault();
            send({ t: "back" });
          }}
        />
        {status === "connecting" && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-xs text-white/80">
            {error}
            <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              <RotateCcw /> Retry
            </Button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        <NavButton title="Back (Esc or right-click)" onClick={() => send({ t: "back" })}>
          <ChevronLeft />
        </NavButton>
        <NavButton title="Home" onClick={key(KEY.home)}>
          <Circle />
        </NavButton>
        <NavButton title="Recent apps" onClick={key(KEY.recents)}>
          <Square />
        </NavButton>
        <span className="mx-1 h-4 w-px bg-border" />
        <NavButton title="Volume down" onClick={key(KEY.volDown)}>
          <Volume1 />
        </NavButton>
        <NavButton title="Volume up" onClick={key(KEY.volUp)}>
          <Volume2 />
        </NavButton>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={sound === "unavailable" || paused || status === "error"}
          title={sound === "unavailable" ? "Phone audio unavailable" : sound === "playing" ? "Mute mirror audio" : "Play mirror audio"}
          aria-label={sound === "playing" ? "Mute mirror audio" : "Play mirror audio"}
          aria-pressed={sound === "playing"}
          onClick={() => {
            const player = audioRef.current;
            if (!player) return;
            if (sound === "playing") {
              player.mute();
              setSound("muted");
            } else {
              player.play().catch(() => setSound("blocked"));
            }
          }}
        >
          {sound === "playing" ? <Volume2 /> : <VolumeX />}
        </Button>
        <NavButton title="Power (screen on/off)" onClick={key(KEY.power)}>
          <Power />
        </NavButton>
      </div>
      {sound === "unavailable" && <span className="text-center text-[10px] text-muted-foreground">Phone audio unavailable</span>}
      {!canDecode && (
        <span className="text-center text-[10px] text-muted-foreground" title="Browsers only allow live video on HTTPS pages or on this PC (localhost).">
          Screenshot mode (~1/s). Smooth video needs HTTPS.
        </span>
      )}
    </div>
  );
}

function NavButton(props: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="icon-sm" variant="ghost" title={props.title} onClick={props.onClick}>
      {props.children}
    </Button>
  );
}

// ---------- H.264 helpers ----------

/** NAL units of an Annex B buffer (split on 00 00 01 / 00 00 00 01 start codes). */
function splitNals(buf: Uint8Array): Uint8Array[] {
  const starts: number[] = [];
  for (let i = 0; i + 2 < buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      starts.push(i + 3);
      i += 2;
    }
  }
  return starts.map((start, k) => {
    let end = k + 1 < starts.length ? starts[k + 1] - 3 : buf.length;
    // A 4-byte start code leaves one extra zero before the next NAL.
    if (k + 1 < starts.length && end > start && buf[end - 1] === 0) end--;
    return buf.subarray(start, end);
  });
}

/** Annex B → 4-byte big-endian length before each NAL. */
function toLengthPrefixed(buf: Uint8Array): Uint8Array {
  const nals = splitNals(buf);
  const out = new Uint8Array(nals.reduce((n, x) => n + 4 + x.length, 0));
  const view = new DataView(out.buffer);
  let o = 0;
  for (const nal of nals) {
    view.setUint32(o, nal.length);
    out.set(nal, o + 4);
    o += 4 + nal.length;
  }
  return out;
}

/** AVCDecoderConfigurationRecord with one SPS and one PPS. */
function avcC(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const out = new Uint8Array(11 + sps.length + pps.length);
  out.set([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 0xff]);
  out.set(sps, 8);
  out.set([1, pps.length >> 8, pps.length & 0xff], 8 + sps.length);
  out.set(pps, 11 + sps.length);
  return out;
}

/** "avc1.PPCCLL" (profile, constraints, level) from an SPS NAL. */
function codecString(sps: Uint8Array): string {
  const hex = (b: number) => b.toString(16).padStart(2, "0");
  return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`;
}
