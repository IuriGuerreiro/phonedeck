import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { Browser } from "../devices.ts";
import { checkScreen, parseScreen, readScreen } from "../screen-check.ts";
import { byDesc, byText, dismissSystemPrompts, findAny, labelRe, sleep, tap, tapAny } from "../ui.ts";

const PKG = "com.zhiliaoapp.musically";
export type PostContent = { postId: number; filePath: string; caption: string; visibility: "private" | "public" };
const NEXT = [byText(labelRe("Next", "Seguinte", "Avançar", "Siguiente")), byDesc(labelRe("Next", "Seguinte", "Avançar", "Siguiente"))];
const POST = [byText(labelRe("Post", "Publicar")), byDesc(labelRe("Post", "Publicar"))];
const CAPTION = ['android=new UiSelector().className("android.widget.EditText")'];
const audience = (visibility: PostContent["visibility"]) => visibility === "private"
  ? ["Only you can view this post", "Só tu podes ver esta publicação", "Only you", "Apenas tu", "Solo tú"]
  : ["Everyone can view this post", "Todos podem ver esta publicação", "Everyone", "Todos"];

const run = promisify(execFile);

/** adb streams the file in chunks, so size doesn't matter to memory. */
async function pushVideo(serial: string, file: string, remotePath: string) {
  try {
    await run("adb", ["-s", serial, "push", file, remotePath], { timeout: 10 * 60_000 });
    const { size } = await stat(file);
    const { stdout } = await run("adb", ["-s", serial, "shell", "stat", "-c", "%s", remotePath], { timeout: 10_000 });
    if (Number(stdout.trim()) !== size) throw new Error("the copy on the phone has the wrong size");
  } catch (err) {
    await run("adb", ["-s", serial, "shell", "rm", "-f", remotePath], { timeout: 10_000 }).catch(() => {});
    const why = (err as { stderr?: string }).stderr?.trim() || (err instanceof Error ? err.message : String(err));
    throw new Error(`Could not copy the video to the phone: ${why}`);
  }
}

export const remoteVideo = (postId: number) => `/sdcard/Download/tapfleet-${postId}.mp4`;
/** Name used before the rename to Tapfleet; a post prepared then may still have its copy there. */
export const oldRemoteVideo = (postId: number) => `/sdcard/Download/phonedeck-${postId}.mp4`;

export async function prepareTikTokPost(s: Browser, serial: string, content: PostContent) {
  const remotePath = remoteVideo(content.postId);
  await pushVideo(serial, content.filePath, remotePath);
  await s.execute("mobile: broadcast", { action: "android.intent.action.MEDIA_SCANNER_SCAN_FILE", uri: `file://${remotePath}` });
  await s.execute("mobile: startActivity", {
    action: "android.intent.action.SEND", package: PKG, mimeType: "video/mp4", flags: "0x10000001",
    extras: [["u", "android.intent.extra.STREAM", `file://${remotePath}`]], wait: true,
  });
  for (let step = 0; step < 4; step++) {
    if (await findAny(s, POST, 1500)) break;
    await tapAny(s, NEXT, "Next in the video editor", 60000);
    await sleep(800);
  }
  const field = await findAny(s, CAPTION, 10000);
  if (!field || !(await findAny(s, POST, 3000))) throw new Error("TikTok did not open the post review screen");
  await field.setValue(content.caption);
  if (await s.isKeyboardShown()) await s.hideKeyboard();
  const privacy = await findAny(s, [byDesc("(?i).*(can view this post|podem ver esta publicação|podes ver esta publicação|puede ver esta publicación).*"), byText("(?i).*(can view this post|podem ver esta publicação|podes ver esta publicação|puede ver esta publicación).*")], 4000);
  if (!privacy) throw new Error("TikTok audience setting not found");
  await privacy.click();
  const option = content.visibility === "private" ? ["Only you", "Apenas tu", "Solo tú"] : ["Everyone", "Todos"];
  const choice = await findAny(s, [byDesc(labelRe(...option)), byText(labelRe(...option))], 4000);
  if (!choice) throw new Error("TikTok audience option not found");
  await sleep(500);
  const [location, size] = await Promise.all([choice.getLocation(), choice.getSize()]);
  await tap(s, location.x + size.width / 2, location.y + size.height / 2);
  await sleep(500);
  await assertReview(s, content);
  return { ready: true };
}

async function assertReview(s: Browser, content: Pick<PostContent, "caption" | "visibility">) {
  const field = await findAny(s, CAPTION, 3000);
  if (!field || (await field.getText()).trim() !== content.caption.trim()) throw new Error("The caption on the phone differs from this draft. Prepare it again.");
  const labels = audience(content.visibility);
  if (!(await findAny(s, [byText(labelRe(...labels)), byDesc(labelRe(...labels))], 3000))) {
    throw new Error("The audience on the phone differs from this draft. Prepare it again.");
  }
}

/** Presses Post once, then waits until the video is on the profile. `onPress` runs just before the tap. */
export async function publishTikTokPost(s: Browser, username: string, content: Pick<PostContent, "caption" | "visibility" | "filePath">, onPress: () => void, note: (text: string) => void) {
  await checkScreen(s, PKG);
  await assertReview(s, content);
  const button = await findAny(s, POST, 4000);
  if (!button) throw new Error("Could not find Publish on screen");
  onPress();
  await button.click();
  await sleep(1500);
  if (content.visibility === "public") await confirmPublic(s);
  if (await findAny(s, POST, 1500)) throw new Error("TikTok is still showing the publish screen. Check the phone before trying again.");
  note("Uploading to TikTok…");
  await confirmPosted(s, username, content);
  return { posted: true };
}

const PUBLISH_NOW = /^(post now|publicar agora|publicar ahora)$/i;

/** A public account's "Post video publicly?" question. Only answered for posts meant for everyone. */
async function confirmPublic(s: Browser) {
  const yes = parseScreen((await readScreen(s)) ?? "").find((n) => n.pkg === PKG && PUBLISH_NOW.test((n.text || n.desc).trim()));
  if (!yes) return;
  const [x1, y1, x2, y2] = yes.box;
  await tap(s, (x1 + x2) / 2, (y1 + y2) / 2);
  await sleep(1500);
}

/** 4 minutes plus one per 25 MB: 24 minutes for the largest video. */
export const confirmMs = (bytes: number) => 4 * 60_000 + Math.ceil(bytes / (25 * 1024 * 1024)) * 60_000;
const PROFILE = [byDesc(labelRe("Profile", "Perfil"))];
const TILE = ["id=com.zhiliaoapp.musically:id/tv_play_count"];
const DENY = /^(don't allow|not now|não permitir|agora não|no permitir|ahora no)$/i;
/** "Há 2 m", "5s ago", "Just now": posted within the hour. */
const FRESH = /(^|\D)\d+\s?(s|m|min|mins|seg)(\s|$)|just now|agora|ahora/i;

export const isFresh = (time: string) => FRESH.test(time.replace(/^[·\s]+/, "").trim());

/** Captions on a video can be cut short ("…more"), so a long one only has to start the same. */
export function sameCaption(shown: string, wanted: string): boolean {
  const clean = (t: string) => t.replace(/\s+/g, " ").trim();
  const [a, b] = [clean(shown), clean(wanted)];
  if (!a) return false;
  if (a === b) return true;
  const cut = a.replace(/\s*(…|\.{3})\s*(more|mais|más|ver mais)?$/i, "");
  return cut !== a && cut.length >= 20 && b.startsWith(cut);
}

/**
 * Never restarts TikTok: that could cut off the upload. Prompts that follow a post
 * (contacts, Facebook friends) are answered "Don't allow".
 */
async function confirmPosted(s: Browser, username: string, content: Pick<PostContent, "caption" | "visibility" | "filePath">) {
  const tab = content.visibility === "private" ? ["Private videos", "Vídeos privados", "Videos privados"] : ["Videos", "Vídeos"];
  const deadline = Date.now() + confirmMs((await stat(content.filePath)).size);
  while (Date.now() < deadline) {
    await sleep(3000);
    await dismissSystemPrompts(s);
    if (await declinePrompt(s)) continue;
    await checkScreen(s, PKG);
    const profile = await findAny(s, PROFILE, 2000);
    if (!profile) {
      // A video or sheet is open over the tabs.
      if ((await s.getCurrentPackage()) === PKG && (await findAny(s, [byDesc(labelRe("Back", "Voltar", "Atrás"))], 500))) await s.back();
      continue;
    }
    await profile.click();
    await sleep(2000);
    const handle = await findAny(s, [byText("^@.+")], 3000);
    const shown = handle ? (await handle.getText()).replace(/^@/, "").replace(/[￼-�]/g, "").trim() : "";
    if (shown.toLowerCase() !== username.toLowerCase()) continue;
    const tabEl = await findAny(s, [byDesc(labelRe(...tab))], 2000);
    if (!tabEl) continue;
    await tabEl.click();
    await sleep(2000);
    // Pinned videos come first, so look past them.
    const count = Math.min(4, (await s.$$(TILE[0]).getElements()).length);
    for (let i = 0; i < count; i++) {
      const tile = (await s.$$(TILE[0]).getElements())[i];
      if (!tile) break;
      const [loc, size] = await Promise.all([tile.getLocation(), tile.getSize()]);
      await tap(s, loc.x + size.width / 2, loc.y - 60);
      await sleep(2000);
      const nodes = parseScreen((await readScreen(s)) ?? "").filter((n) => n.pkg === PKG);
      const text = (id: string) => nodes.find((n) => n.id.endsWith(`:id/${id}`))?.text ?? "";
      const found = sameCaption(text("desc"), content.caption) && isFresh(text("tv_post_time"));
      await s.back();
      await sleep(1000);
      if (found) return;
    }
  }
  throw new Error("Publish was pressed, but the video hasn't shown up on the profile yet. Check TikTok before posting again.");
}

async function declinePrompt(s: Browser): Promise<boolean> {
  const deny = parseScreen((await readScreen(s)) ?? "").find((n) => n.pkg === PKG && DENY.test((n.text || n.desc).replace(/’/g, "'").trim()));
  if (!deny) return false;
  const [x1, y1, x2, y2] = deny.box;
  await tap(s, (x1 + x2) / 2, (y1 + y2) / 2);
  await sleep(1000);
  return true;
}
