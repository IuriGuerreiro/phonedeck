// Small UI helpers on top of a WebdriverIO session.
// Selectors prefer labels matched in several languages (the phones may not be in English)
// because app resource ids are often obfuscated and change between app versions.
import type { Browser } from "./devices.ts";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const randInt = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));

/** Build a case-insensitive whole-label regex for UiSelector, e.g. labelRe("Profile", "Perfil"). */
export const labelRe = (...words: string[]) =>
  `(?i)^(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`;

export const byDesc = (re: string) => `android=new UiSelector().descriptionMatches("${re}")`;
export const byText = (re: string) => `android=new UiSelector().textMatches("${re}")`;
export const byId = (id: string) => `id=${id}`;

/** First selector that matches a displayed element within `timeoutMs`, or null. */
export async function findAny(s: Browser, selectors: string[], timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  do {
    for (const sel of selectors) {
      const els = await s.$$(sel).getElements();
      for (const el of els) {
        if (await el.isDisplayed().catch(() => false)) return el;
      }
    }
    await sleep(300);
  } while (Date.now() < deadline);
  return null;
}

export async function tapAny(s: Browser, selectors: string[], what: string, timeoutMs = 4000) {
  const el = await findAny(s, selectors, timeoutMs);
  if (!el) throw new Error(`Could not find ${what} on screen`);
  await el.click();
}

export async function tap(s: Browser, x: number, y: number) {
  await s
    .action("pointer", { parameters: { pointerType: "touch" } })
    .move({ x: Math.round(x), y: Math.round(y) })
    .down()
    .pause(60)
    .up()
    .perform();
}

export async function doubleTap(s: Browser, x: number, y: number) {
  await s
    .action("pointer", { parameters: { pointerType: "touch" } })
    .move({ x: Math.round(x), y: Math.round(y) })
    .down()
    .pause(50)
    .up()
    .pause(90)
    .down()
    .pause(50)
    .up()
    .perform();
}

export async function swipeUp(s: Browser, durationMs = 300) {
  const { width, height } = await s.getWindowSize();
  const x = Math.round(width * (0.45 + Math.random() * 0.1));
  await s
    .action("pointer", { parameters: { pointerType: "touch" } })
    .move({ x, y: Math.round(height * 0.75) })
    .down()
    .pause(50)
    .move({ x, y: Math.round(height * 0.25), duration: durationMs })
    .up()
    .perform();
}

/** Packages that show Android's permission prompts (stock Android and Xiaomi MIUI). */
const PERMISSION_PACKAGES = new Set([
  "com.android.permissioncontroller",
  "com.google.android.permissioncontroller",
  "com.android.packageinstaller",
  "com.lbe.security.miui",
]);
const DENY = [
  "id=com.android.permissioncontroller:id/permission_deny_button",
  "id=com.android.permissioncontroller:id/permission_deny_and_dont_ask_again_button",
  byText(labelRe("Don't allow", "Deny", "Não permitir", "Recusar", "No permitir", "Rechazar")),
];

/**
 * Answer Android permission prompts with "Don't allow" so automation never grants an
 * app access to contacts, location, etc. Returns true if it dismissed something.
 */
export async function dismissSystemPrompts(s: Browser): Promise<boolean> {
  let dismissed = false;
  for (let i = 0; i < 3; i++) {
    if (!PERMISSION_PACKAGES.has(await s.getCurrentPackage())) break;
    const deny = await findAny(s, DENY, 1500);
    if (deny) await deny.click();
    else await s.back();
    dismissed = true;
    await sleep(800);
  }
  return dismissed;
}
