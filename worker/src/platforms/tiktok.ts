// TikTok (com.zhiliaoapp.musically). Tested on Android 13, app UI in Portuguese.
// TikTok's resource ids are obfuscated (e.g. "lz5"), so this matches on labels.
import type { Browser } from "../devices.ts";
import { byDesc, byText, dismissSystemPrompts, findAny, labelRe, sleep, tap, tapAny } from "../ui.ts";
import { NeedsAttention, type Platform } from "./types.ts";

const PKG = "com.zhiliaoapp.musically";
const HOME_TAB = [byDesc(labelRe("Home", "Início", "Inicio")), byText(labelRe("Home", "Início", "Inicio"))];
const PROFILE_TAB = [byDesc(labelRe("Profile", "Perfil")), byText(labelRe("Profile", "Perfil"))];
const SWITCH_SHEET_TITLE = [byText(labelRe("Switch account", "Mudar de conta", "Cambiar de cuenta"))];
const ADD_ACCOUNT = labelRe("Add account", "Adicionar conta", "Añadir cuenta", "Agregar cuenta");
const CLOSE = [byDesc(labelRe("Close", "Fechar", "Cerrar"))];
const SEARCH = [byDesc(labelRe("Search", "Pesquisar", "Buscar"))];
const SEARCH_FIELD = ['android=new UiSelector().className("android.widget.EditText")'];
const VIDEOS_TAB = [byDesc(labelRe("Videos", "Vídeos")), byText(labelRe("Videos", "Vídeos"))];
const RESULTS_GRID = ['android=new UiSelector().className("android.widget.GridView")'];
// Every full-screen video has a share button; its label starts with "Share video".
const VIDEO_SHARE = [byDesc("(?i)^(share video|partilhar vídeo|compartilhar vídeo|compartir video).*")];
// "Follow <creator>". Not "A seguir" (the Following tab), which starts differently.
const FOLLOW = [byDesc("(?i)^(follow|seguir) .+")];
const SEARCH_SUBMIT = [byText(labelRe("Search", "Pesquisar", "Buscar"))];

async function ensureForeground(s: Browser) {
  await s.activateApp(PKG);
  // A cold start can take several seconds.
  const deadline = Date.now() + 12_000;
  while ((await s.getCurrentPackage()) !== PKG && Date.now() < deadline) await sleep(500);
  await sleep(1000);
  // A contacts prompt (with a "find contacts" sheet behind it) shows up now and then.
  if (await dismissSystemPrompts(s)) await s.back();
  if ((await s.getCurrentPackage()) !== PKG) {
    throw new NeedsAttention("TikTok did not come to the foreground");
  }
}

/** Bring TikTok to its main screens and return the Home tab element. */
async function goHome(s: Browser) {
  await ensureForeground(s);
  let home = await findAny(s, HOME_TAB, 3000);
  if (!home) {
    await s.back();
    home = await findAny(s, HOME_TAB, 2000);
  }
  if (!home) {
    // Deep in a search, a profile or a sheet: a fresh start always lands on the home feed.
    await s.terminateApp(PKG);
    await ensureForeground(s);
    home = await findAny(s, HOME_TAB, 8000);
  }
  if (!home) throw new NeedsAttention("TikTok home tab not found (logged out or a popup is open?)");
  return home;
}

async function openProfile(s: Browser) {
  await goHome(s);
  await tapAny(s, PROFILE_TAB, "the Profile tab");
  await sleep(1500);
}

/**
 * The switcher opens from the display-name button near the top of the profile.
 * TikTok has moved it between layouts (centered in the top bar, or left-aligned
 * under it), so try each likely button and check that the switcher appeared.
 */
async function openSwitcher(s: Browser) {
  await openProfile(s);
  const { width, height } = await s.getWindowSize();
  const buttons = await s.$$("android=new UiSelector().className(\"android.widget.Button\")").getElements();
  const candidates: { x: number; y: number; score: number }[] = [];
  for (const b of buttons) {
    const [loc, size, text, desc] = await Promise.all([
      b.getLocation(),
      b.getSize(),
      b.getText().catch(() => ""),
      b.getAttribute("content-desc").catch(() => ""),
    ]);
    const x = loc.x + size.width / 2;
    const y = loc.y + size.height / 2;
    if (y > height * 0.16) continue;
    if (text && !desc && !text.startsWith("@")) candidates.push({ x, y, score: 0 }); // display name
    else if (!desc && Math.abs(x - width / 2) < width * 0.2) candidates.push({ x, y, score: 1 }); // centered title
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const c of candidates) {
    await tap(s, c.x, c.y);
    if (await findAny(s, SWITCH_SHEET_TITLE, 3000)) return;
    await s.back(); // Wrong button: undo whatever it opened.
    await sleep(800);
    await openProfile(s);
  }
  throw new Error("TikTok account switcher did not open");
}

async function sheetAccounts(s: Browser): Promise<{ name: string; selected: boolean }[]> {
  // Each account row is a Button whose label is the username.
  const rows = await s
    .$$("android=new UiSelector().className(\"android.widget.Button\").descriptionMatches(\".+\")")
    .getElements();
  const out: { name: string; selected: boolean }[] = [];
  const addRe = new RegExp(ADD_ACCOUNT.replace("(?i)", ""), "i");
  const closeRe = /^(close|fechar|cerrar)$/i;
  for (const r of rows) {
    const name = (await r.getAttribute("content-desc"))?.trim() ?? "";
    if (!name || addRe.test(name) || closeRe.test(name)) continue;
    const selected = (await r.getAttribute("selected")) === "true";
    out.push({ name, selected });
  }
  return out;
}

async function closeSheet(s: Browser) {
  const close = await findAny(s, CLOSE, 1500);
  if (close) await close.click();
  else await s.back();
  await sleep(500);
}

/** Search `keyword`, open the Videos results, and start playing the first one. */
async function openSearchResults(s: Browser, keyword: string) {
  await tapAny(s, SEARCH, "the search button");
  const field = await findAny(s, SEARCH_FIELD, 5000);
  if (!field) throw new Error("TikTok search field did not open");
  await field.click();
  await field.clearValue();
  await field.setValue(keyword);
  // Submit with the "Search" text button next to the field; the Enter key only shows suggestions.
  const submit = await findAny(s, SEARCH_SUBMIT, 2000);
  if (submit) await submit.click();
  else await s.execute("mobile: performEditorAction", { action: "search" });
  await sleep(2500);
  await tapAny(s, VIDEOS_TAB, "the Videos results tab", 6000);
  await sleep(2000);
  const grid = await findAny(s, RESULTS_GRID, 8000);
  if (!grid) throw new Error(`No TikTok video results for "${keyword}"`);
  // Tap the first cell (top-left of a two-column grid).
  const [loc, size] = await Promise.all([grid.getLocation(), grid.getSize()]);
  await tap(s, loc.x + size.width * 0.25, loc.y + Math.min(400, size.height * 0.2));
  await sleep(2500);
  if (!(await findAny(s, VIDEO_SHARE, 5000))) {
    throw new Error(`TikTok did not open a video from the "${keyword}" results`);
  }
}

export function parseProfileCount(text: string): number {
  const match = text.trim().replace(/\s+/g, "").match(/^(\d+(?:[.,]\d+)*)([kKmMbB]|mil|mi)?$/);
  if (!match) throw new Error(`Unrecognized TikTok count: ${text}`);
  const suffix = match[2]?.toLowerCase();
  const numeric = suffix ? match[1].replace(",", ".") : match[1].replace(/[.,]/g, "");
  const value = Number(numeric) * (suffix === "k" || suffix === "mil" ? 1000 : suffix === "m" || suffix === "mi" ? 1e6 : suffix === "b" ? 1e9 : 1);
  if (!Number.isSafeInteger(Math.round(value))) throw new Error(`Invalid TikTok count: ${text}`);
  return Math.round(value);
}

export const tiktok: Platform = {
  id: "tiktok",
  package: PKG,
  doubleTapLikes: true,

  async openFeed(s, keyword) {
    const home = await goHome(s);
    await home.click();
    await sleep(1500);
    if (keyword) await openSearchResults(s, keyword);
  },

  async isOnFeed(s) {
    if (await dismissSystemPrompts(s)) await s.back();
    if ((await s.getCurrentPackage()) !== PKG) return false;
    return !!(await findAny(s, VIDEO_SHARE, 2000));
  },

  async follow(s) {
    const btn = await findAny(s, FOLLOW, 1000);
    if (!btn) return false;
    await btn.click();
    await sleep(800);
    return true;
  },

  async readAccountStats(s) {
    await openProfile(s);
    const handle = await findAny(s, [byText("^@.+")], 5000);
    if (!handle) throw new Error("TikTok profile username not found");
    const username = (await handle.getText()).replace(/^@/, "").replace(/[\uFFFC-\uFFFD]/g, "").trim();
    const read = async (labels: string[]) => {
      const label = await findAny(s, [byText(labelRe(...labels))], 5000);
      if (!label) throw new Error(`Profile metric not found: ${labels[0]}`);
      const text = await label.getText();
      const value = await s.$(`//*[@text=${JSON.stringify(text)}]/../*[1]`).getText();
      return parseProfileCount(value);
    };
    return { username, following: await read(["Following", "A seguir", "Siguiendo"]),
      followers: await read(["Followers", "Follower", "Seguidores", "Seguidor"]),
      likes: await read(["Likes", "Gostos", "Me gusta"]) };
  },

  async listAccounts(s) {
    await openSwitcher(s);
    const accounts = await sheetAccounts(s);
    await closeSheet(s);
    accounts.sort((a, b) => Number(b.selected) - Number(a.selected));
    return accounts.map((a) => a.name);
  },

  async switchAccount(s, username) {
    await openSwitcher(s);
    const accounts = await sheetAccounts(s);
    const target = accounts.find((a) => a.name.toLowerCase() === username.toLowerCase());
    if (!target) {
      await closeSheet(s);
      throw new Error(`@${username} is not logged in on this phone's TikTok`);
    }
    if (target.selected) {
      await closeSheet(s);
      return;
    }
    await tapAny(s, [byDesc(labelRe(target.name))], `@${username} in the switcher`);
    // Switching reloads the app; wait for the tab bar to come back.
    await sleep(4000);
    if (!(await findAny(s, [...HOME_TAB, ...PROFILE_TAB], 15000))) {
      throw new NeedsAttention(`TikTok did not finish switching to @${username}`);
    }
  },
};
