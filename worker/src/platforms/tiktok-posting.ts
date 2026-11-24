import { readFile } from "node:fs/promises";
import type { Browser } from "../devices.ts";
import { byDesc, byText, findAny, labelRe, sleep, tap, tapAny } from "../ui.ts";

const PKG = "com.zhiliaoapp.musically";
export type PostContent = { postId: number; filePath: string; caption: string; visibility: "private" | "public" };
const NEXT = [byText(labelRe("Next", "Seguinte", "Avançar", "Siguiente")), byDesc(labelRe("Next", "Seguinte", "Avançar", "Siguiente"))];
const POST = [byText(labelRe("Post", "Publicar")), byDesc(labelRe("Post", "Publicar"))];
const CAPTION = ['android=new UiSelector().className("android.widget.EditText")'];
const audience = (visibility: PostContent["visibility"]) => visibility === "private"
  ? ["Only you can view this post", "Só tu podes ver esta publicação", "Only you", "Apenas tu", "Solo tú"]
  : ["Everyone can view this post", "Todos podem ver esta publicação", "Everyone", "Todos"];

export async function prepareTikTokPost(s: Browser, content: PostContent) {
  const remotePath = `/sdcard/Download/phonedeck-${content.postId}.mp4`;
  await s.pushFile(remotePath, (await readFile(content.filePath)).toString("base64"));
  await s.execute("mobile: broadcast", { action: "android.intent.action.MEDIA_SCANNER_SCAN_FILE", uri: `file://${remotePath}` });
  await s.execute("mobile: startActivity", {
    action: "android.intent.action.SEND", package: PKG, mimeType: "video/mp4", flags: "0x10000001",
    extras: [["u", "android.intent.extra.STREAM", `file://${remotePath}`]], wait: true,
  });
  for (let step = 0; step < 4; step++) {
    if (await findAny(s, POST, 1500)) break;
    await tapAny(s, NEXT, "Next in the video editor", 15000);
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

export async function publishTikTokPost(s: Browser, content: Pick<PostContent, "caption" | "visibility">) {
  await assertReview(s, content);
  await tapAny(s, POST, "Publish");
  // Submission is distinct from a confirmed published video. Never retry it automatically.
  await sleep(1500);
  if (await findAny(s, POST, 1500)) throw new Error("TikTok is still showing the publish screen. Check the phone before trying again.");
  return { submitted: true };
}
