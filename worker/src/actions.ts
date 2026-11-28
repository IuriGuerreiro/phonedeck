// Phone actions. Each takes the job payload and returns a small result.
import { prepareTikTokPost, publishTikTokPost, remoteVideo, oldRemoteVideo, type PostContent } from "./platforms/tiktok-posting.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { requestStop, shouldStop, withDevice, type Browser } from "./devices.ts";
import { NeedsAttention, platform, type Platform } from "./platforms/index.ts";
import { progress, send } from "./protocol.ts";
import { checkScreen, classify, fingerprint, readScreen } from "./screen-check.ts";
import { doubleTap, randInt, sleep, swipeUp } from "./ui.ts";

export type WarmupOptions = {
  /** Session length in minutes. */
  minutes: number;
  /** Seconds to stay on each video: a random value in [watchMinSec, watchMaxSec]. */
  watchMinSec?: number;
  watchMaxSec?: number;
  /** 0..1 chance to like a video, on platforms where double-tap likes. */
  likeChance: number;
  /** 0..1 chance to follow the creator of a video. */
  followChance?: number;
  /**
   * Niche keywords. When set, the session searches them and watches the results
   * instead of the main feed, moving to the next keyword every few videos.
   */
  keywords?: string[];
  /** Likes / follows still allowed today (set by the app's safety limits). */
  maxLikes?: number;
  maxFollows?: number;
  /** Random breaks: after every [everyMin, everyMax] minutes, pause [lengthMin, lengthMax] minutes. */
  breaks?: { everyMin: number; everyMax: number; lengthMin: number; lengthMax: number };
};

const run = promisify(execFile);
const KEYCODE_HOME = 3;
const KEYCODE_WAKEUP = 224;

/** Videos to watch per keyword before searching the next one. */
const VIDEOS_PER_KEYWORD: [number, number] = [6, 12];

/** How many times each phone got blocked. */
const blocks = new Map<string, number>();
/** Swipes in a row that may leave the screen unchanged before it counts as stuck. */
const MAX_STUCK_SWIPES = 3;

const preparedPosts = new Map<string, PostContent>();

export type Job =
  | ({ action: "prepare_post"; serial: string; platform: string; username: string } & PostContent)
  | { action: "publish_post"; serial: string; platform: string; username: string; postId: number }
  | ({ action: "post_video"; serial: string; platform: string; username: string } & PostContent)
  | { action: "open_app"; serial: string; package: string }
  | { action: "swipe_up"; serial: string }
  | { action: "list_accounts"; serial: string; platform: string }
  | { action: "video_analytics"; serial: string; platform: string; username: string }
  | { action: "account_analytics"; serial: string; platform: string; username: string }
  | { action: "switch_account"; serial: string; platform: string; username: string }
  | ({ action: "warmup"; serial: string; platform: string; username?: string } & WarmupOptions)
  | { action: "stop"; serial: string };

export function runJob(job: Job): Promise<unknown> {
  switch (job.action) {
    case "prepare_post":
      return withJobDevice(job, (s) => guard(s, job, async () => {
        await switchTo(s, job.serial, platform(job.platform), job.username);
        progress(job.serial, "Preparing video on TikTok…");
        const result = await prepareTikTokPost(s, job.serial, job);
        preparedPosts.set(job.serial, job);
        return result;
      }));
    case "publish_post":
      return posting(job, async (s, onPress) => {
        const prepared = preparedPosts.get(job.serial);
        preparedPosts.delete(job.serial);
        if (!prepared || prepared.postId !== job.postId) throw new Error("This draft is no longer prepared on the phone. Prepare it again.");
        progress(job.serial, "Publishing video…");
        return publishTikTokPost(s, job.username, prepared, onPress, (n) => progress(job.serial, n));
      });
    case "post_video":
      return posting(job, async (s, onPress) => {
        await switchTo(s, job.serial, platform(job.platform), job.username);
        progress(job.serial, "Preparing video on TikTok…");
        await prepareTikTokPost(s, job.serial, job);
        progress(job.serial, "Publishing video…");
        return publishTikTokPost(s, job.username, job, onPress, (n) => progress(job.serial, n));
      });
    case "open_app":
      return withJobDevice(job, async (s) => {
        await s.activateApp(job.package);
        return { opened: job.package };
      });
    case "swipe_up":
      return withJobDevice(job, async (s) => {
        await swipeUp(s);
        return { swiped: true };
      });
    case "list_accounts":
      return withJobDevice(job, (s) =>
        guard(s, job, async () => {
          const p = platform(job.platform);
          progress(job.serial, `Reading ${p.id} accounts…`);
          return { accounts: await p.listAccounts(s) };
        }),
      );
    case "video_analytics":
      return withJobDevice(job, (s) => guard(s, job, async () => {
        const p = platform(job.platform);
        await switchTo(s, job.serial, p, job.username);
        progress(job.serial, `Reading videos for @${job.username}…`);
        return { videos: await p.readVideos(s, job.username, () => shouldStop(job.serial)) };
      }));
    case "account_analytics":
      return withJobDevice(job, (s) => guard(s, job, async () => {
        const p = platform(job.platform);
        await switchTo(s, job.serial, p, job.username);
        const stats = await p.readAccountStats(s);
        if (stats.username.toLowerCase() !== job.username.toLowerCase()) throw new Error("TikTok profile does not match the requested account");
        return stats;
      }));
    case "switch_account":
      return withJobDevice(job, (s) =>
        guard(s, job, async () => {
          await switchTo(s, job.serial, platform(job.platform), job.username);
          return { switched: job.username };
        }),
      );
    case "warmup":
      return withJobDevice(job, (s) =>
        guard(s, job, async () => {
          const p = platform(job.platform);
          if (job.username) await switchTo(s, job.serial, p, job.username);
          return warmup(s, job.serial, p, job);
        }),
      );
    case "stop":
      // Not queued: it has to reach a job that is already running on this phone.
      requestStop(job.serial);
      return Promise.resolve({ stopping: true });
    default:
      throw new Error(`Unknown action: ${(job as { action: string }).action}`);
  }
}

/**
 * Failures before Publish was pressed are marked "Not posted:", so the app knows a retry
 * can't post twice. Anything later is uncertain.
 */
async function posting<T>(job: Extract<Job, { action: "publish_post" | "post_video" }>, fn: (s: Browser, onPress: () => void) => Promise<T>): Promise<T> {
  let pressed = false;
  try {
    const result = await withJobDevice(job, (s) => guard(s, job, () => fn(s, () => void (pressed = true))));
    // The copy on the phone is no longer needed.
    await run("adb", ["-s", job.serial, "shell", "rm", "-f", remoteVideo(job.postId), oldRemoteVideo(job.postId)], { timeout: 10_000 }).catch(() => {});
    return result;
  } catch (err) {
    if (!pressed && err instanceof Error) err.message = `Not posted: ${err.message}`;
    throw err;
  }
}

function withJobDevice<T>(job: Job, fn: (s: Browser) => Promise<T>): Promise<T> {
  const epoch = blocks.get(job.serial) ?? 0;
  return withDevice(job.serial, (s) => {
    // Queued before another job got blocked: the screen is still waiting for a person.
    if ((blocks.get(job.serial) ?? 0) !== epoch) throw new Error("Phone on hold: an earlier job needs attention.");
    if (job.action !== "publish_post") preparedPosts.delete(job.serial);
    return fn(s);
  });
}

async function switchTo(s: Browser, serial: string, p: Platform, username: string) {
  progress(serial, `Switching to @${username}…`);
  await p.switchAccount(s, username);
}

/**
 * Watch videos for `minutes`: stay on each one for a random time in the watch
 * range, sometimes like it or follow the creator, then swipe to the next.
 * With keywords, videos come from searching them (rotating every few videos).
 * Stops early when asked, or when the app leaves the feed and can't get back
 * (that usually means a checkpoint a person must handle).
 */
async function warmup(s: Browser, serial: string, p: Platform, opts: WarmupOptions) {
  const minutes = clamp(opts.minutes, 1, 120);
  const watchMin = clamp(opts.watchMinSec ?? 5, 1, 600);
  const watchMax = Math.max(watchMin, clamp(opts.watchMaxSec ?? 20, 1, 600));
  const likeChance = p.doubleTapLikes ? clamp(opts.likeChance, 0, 1) : 0;
  const followChance = clamp(opts.followChance ?? 0, 0, 1);
  const keywords = (opts.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const maxLikes = Math.max(0, opts.maxLikes ?? Infinity);
  const maxFollows = Math.max(0, opts.maxFollows ?? Infinity);
  const breaks = opts.breaks;
  const nextBreakIn = () => (breaks ? randInt(breaks.everyMin * 60_000, breaks.everyMax * 60_000) : Infinity);
  let nextBreak = Date.now() + nextBreakIn();

  const end = Date.now() + minutes * 60_000;
  const { width, height } = await s.getWindowSize();
  const stats = { videos: 0, likes: 0, follows: 0, searches: 0, breaks: 0 };

  // Keywords are shuffled once, then used in turn.
  const queue = [...keywords].sort(() => Math.random() - 0.5);
  let keyword: string | undefined;
  let leftForKeyword = 0;
  let lastScreen = "";
  let stuck = 0;

  const open = async () => {
    progress(serial, keyword ? `Searching "${keyword}"…` : `Opening ${p.id} feed…`);
    await p.openFeed(s, keyword);
  };

  while (Date.now() < end && !shouldStop(serial)) {
    // Not worth a new search with less than one video's watch time left.
    if (queue.length && leftForKeyword <= 0 && stats.searches > 0 && end - Date.now() < watchMax * 1000) break;
    if (queue.length && leftForKeyword <= 0) {
      keyword = queue[stats.searches % queue.length];
      leftForKeyword = randInt(...VIDEOS_PER_KEYWORD);
      stats.searches++;
      await open();
    } else if (stats.videos === 0 && !keyword) {
      await open();
    }

    const xml = await checkScreen(s, p.package);
    const screen = xml ? fingerprint(xml, p.package) : "";
    stuck = screen && screen === lastScreen ? stuck + 1 : 0;
    lastScreen = screen;
    if (xml && stuck >= MAX_STUCK_SWIPES) throw new NeedsAttention("Swiping doesn't change the screen; something may be covering it", { xml });

    if (!(await p.isOnFeed(s))) {
      progress(serial, "Left the video feed, going back…");
      await open();
      if (!(await p.isOnFeed(s))) throw new NeedsAttention(`${p.id} feed is not reachable`);
    }

    await sleepUnlessStopped(serial, Math.min(randInt(watchMin * 1000, watchMax * 1000), end - Date.now()));
    if (shouldStop(serial) || Date.now() >= end) break;

    // Something may have appeared while watching.
    await checkScreen(s, p.package);
    if (stats.likes < maxLikes && Math.random() < likeChance) {
      await doubleTap(s, width * (0.4 + Math.random() * 0.2), height * (0.4 + Math.random() * 0.15));
      stats.likes++;
      await sleep(randInt(500, 1200));
    }
    if (stats.follows < maxFollows && Math.random() < followChance && (await p.follow(s))) {
      stats.follows++;
      await sleep(randInt(500, 1200));
    }
    await swipeUp(s, randInt(220, 420));
    stats.videos++;
    leftForKeyword--;
    const left = Math.max(0, Math.round((end - Date.now()) / 60_000));
    const where = keyword ? ` · "${keyword}"` : "";
    progress(
      serial,
      `Warm-up${where}: ${stats.videos} videos, ${stats.likes} likes, ${stats.follows} follows, ~${left} min left`,
    );

    // Random break: sit still like a person putting the phone down. Counts toward the session.
    if (breaks && Date.now() >= nextBreak && end - Date.now() > 60_000) {
      const ms = Math.min(randInt(breaks.lengthMin * 60_000, breaks.lengthMax * 60_000), end - Date.now() - 30_000);
      progress(serial, `Taking a break for ~${Math.max(1, Math.round(ms / 60_000))} min…`);
      await sleepUnlessStopped(serial, ms);
      // The screen may have timed out meanwhile; wake it (doesn't unlock a PIN).
      await s.execute("mobile: pressKey", { keycode: KEYCODE_WAKEUP }).catch(() => {});
      stats.breaks++;
      nextBreak = Date.now() + nextBreakIn();
    }
  }

  // Done (or stopped): close the app and leave the phone on its home screen.
  // Not on errors: a needs-attention screen should stay up for a person to see.
  progress(serial, `Closing ${p.id}…`);
  await s.execute("mobile: pressKey", { keycode: KEYCODE_HOME }).catch(() => {});
  await s.terminateApp(p.package).catch(() => {});

  return { ...stats, stopped: shouldStop(serial) };
}

/**
 * When a job is blocked, save the evidence and tell the app, which holds the phone until a
 * person has looked. Plain failures count too if the screen shows a known block.
 */
async function guard<T>(s: Browser, job: Job, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const pkg = platform("platform" in job ? job.platform : "tiktok").package;
    let blocked = err instanceof NeedsAttention ? err : null;
    if (!blocked) {
      blocked = await checkScreen(s, pkg).then(() => null, (e) => (e instanceof NeedsAttention ? e : null));
      if (!blocked) throw err;
      blocked.message += ` (while: ${err instanceof Error ? err.message : err})`;
    }
    blocks.set(job.serial, (blocks.get(job.serial) ?? 0) + 1);
    await report(s, job, pkg, blocked).catch((e) => console.error("[alert]", e));
    throw blocked;
  }
}

async function report(s: Browser, job: Job, pkg: string, err: NeedsAttention) {
  const seen = err.seen ?? {};
  const xml = seen.xml ?? (await readScreen(s)) ?? "";
  const png = seen.png ?? (await s.takeScreenshot().catch(() => ""));
  const activity = await s.getCurrentActivity().catch(() => null);
  const dump = await run("adb", ["-s", job.serial, "shell", "dumpsys", "package", pkg], { timeout: 10_000, maxBuffer: 16 << 20 }).then((r) => r.stdout, () => "");
  const guess = classify(xml, pkg);
  const kind = seen.kind ?? guess.kind;
  const clues = seen.clues ?? guess.clues;
  const alert = {
    event: "blocked", serial: job.serial, action: job.action, kind, clues, message: err.message, activity,
    platform: "platform" in job ? job.platform : null,
    username: "username" in job ? (job.username ?? null) : null,
    appVersion: dump.match(/versionName=(\S+)/)?.[1] ?? null,
    at: new Date().toISOString(),
  };
  let dir: string | null = path.join(process.env.SMA_LOG_DIR ?? path.join(os.tmpdir(), "sma-logs"), "alerts", `${job.serial.replace(/[^\w.-]/g, "_")}-${Date.now()}`);
  try {
    await mkdir(dir, { recursive: true });
    if (xml) await writeFile(path.join(dir, "screen.xml"), xml);
    if (png) await writeFile(path.join(dir, "screen.png"), Buffer.from(png, "base64"));
    await writeFile(path.join(dir, "info.json"), JSON.stringify(alert, null, 2));
  } catch (e) {
    console.error("[alert] evidence not saved:", e);
    dir = null;
  }
  // Sent even without evidence: the hold matters more.
  send({ ...alert, dir });
}

async function sleepUnlessStopped(serial: string, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end && !shouldStop(serial)) await sleep(Math.min(500, end - Date.now()));
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
