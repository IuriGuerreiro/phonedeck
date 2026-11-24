// Spots screens the automation must not touch (captcha, logged out, account warning,
// something covering the app). The wording is a best guess until real samples exist:
// every block saves its screen, so these rules can be tuned from evidence.
import type { Browser } from "./devices.ts";
import { NeedsAttention, type BlockKind } from "./platforms/types.ts";
import { sleep } from "./ui.ts";

export type Finding = { kind: BlockKind; clues: string[]; /** Only a covering web page: could be an ad still loading. */ weak: boolean };
type Node = { tag: string; text: string; desc: string; id: string; cls: string; pkg: string; box: [number, number, number, number] };

const decode = (s: string) =>
  s.replace(/&#(x[\da-f]+|\d+);/gi, (_, n: string) => {
    const code = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
    return code <= 0x10ffff ? String.fromCodePoint(code) : "";
  })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Elements of a UiAutomator page source. */
export function parseScreen(xml: string): Node[] {
  const nodes: Node[] = [];
  for (const [, tag, body] of xml.matchAll(/<([\w.$]+)((?:\s+[\w:.-]+="[^"]*")*)\s*\/?>/g)) {
    const a: Record<string, string> = {};
    for (const [, k, v] of body.matchAll(/([\w:.-]+)="([^"]*)"/g)) a[k] = decode(v);
    const b = a.bounds?.match(/-?\d+/g)?.map(Number) ?? [0, 0, 0, 0];
    nodes.push({ tag, text: a.text ?? "", desc: a["content-desc"] ?? "", id: a["resource-id"] ?? "", cls: a.class ?? tag, pkg: a.package ?? "", box: [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0] });
  }
  return nodes;
}

// Anchored to the whole label, so a video caption that mentions a captcha doesn't match.
const CLUES: [BlockKind, RegExp[]][] = [
  ["captcha", [
    /^(please )?(verify|confirm) to continue[:.!]?$/, /^security (verification|check)$/, /^verify (that )?you('re| are) (human|not a robot).?$/,
    /^i'?m not a robot$/, /^drag the (slider|puzzle piece)\b.{0,60}$/, /^slide to (complete|verify)\b.{0,40}$/,
    /^select (2|two) objects\b.{0,60}$/, /^(verifica|verifique|verificar|confirma|confirme|confirmar) para continuar[:.!]?$/,
    /^verifica(ção|ción) de (segurança|seguridad)$/, /^não sou um robô$/, /^no soy un robot$/,
    /^(arrasta|arraste|desliza|deslize) (o|a|el|la) (controlo|controle|deslizador|peça|pieza|control|barra)\b.{0,70}$/,
    /^(seleciona|selecione|selecciona|escolhe|escolha|elige) (2|dois|dos) objetos\b.{0,60}$/,
  ]],
  ["account_warning", [
    /^your account (has been |was |is )?(permanently |temporarily )?(banned|suspended|restricted)\b.{0,80}$/,
    /^account (banned|suspended|restricted)$/, /^you('re| are) (following|liking|tapping|commenting) too (fast|often|much)\b.{0,80}$/,
    /^too many (attempts|requests)\b.{0,80}$/, /^community guidelines violation.?$/,
    /^a (tua|sua) conta foi (permanentemente |temporariamente )?(banida|suspensa|restringida|restrita)\b.{0,80}$/,
    /^tu cuenta (ha sido|fue) (permanentemente |temporalmente )?(suspendida|bloqueada|restringida)\b.{0,80}$/,
    /^(demasiadas tentativas|muitas tentativas|demasiados intentos)\b.{0,80}$/,
  ]],
  ["logged_out", [
    /^(log ?in|sign up) (to|for) tiktok$/, /^(your )?session (has )?expired\b.{0,60}$/,
    /^(iniciar sessão no|inicia sessão no|entrar no|entre no) tiktok$/, /^(regista-te no|cadastre-se no) tiktok$/,
    /^(inicia sesión en|iniciar sesión en|regístrate en) tiktok$/, /^(a )?(tua |sua )?sessão (expirou|terminou)\b.{0,60}$/,
  ]],
  // Seen on a real phone: a floating card that hides the top of the app.
  ["popup", [/^(continue editing this post|continuar a editar esta publicação|continuar editando esta publicación)\?$/]],
];
const CAPTCHA_ID = /captcha|secsdk|verify_?puzzle/i;
const DISMISS = /^(not now|maybe later|later|skip|no thanks|agora não|mais tarde|ignorar|saltar|ahora no|más tarde|omitir)$/;

/** What's wrong with this screen, or null. Only the app's own elements count. */
export function findBlock(xml: string, pkg: string): Finding | null {
  const all = parseScreen(xml);
  const nodes = all.filter((n) => n.pkg === pkg);
  for (const n of nodes) {
    if (CAPTCHA_ID.test(n.id) || CAPTCHA_ID.test(n.cls)) return { kind: "captcha", clues: [`element ${n.id || n.cls}`], weak: false };
  }
  // Typed text (search, captions being written) is ours, not the app's.
  const labels = nodes.filter((n) => !/EditText/.test(n.cls)).flatMap((n) => [n.text, n.desc]).map((t) => t.replace(/\s+/g, " ").replace(/’/g, "'").trim()).filter(Boolean);
  for (const [kind, rules] of CLUES) {
    const hits = labels.filter((l) => rules.some((r) => r.test(l.toLowerCase())));
    if (hits.length) return { kind, clues: [...new Set(hits)].slice(0, 5), weak: false };
  }
  const w = Math.max(0, ...all.map((n) => n.box[2]));
  const h = Math.max(0, ...all.map((n) => n.box[3]));
  const web = nodes.find((n) => /WebView/.test(n.cls) && (n.box[2] - n.box[0]) * (n.box[3] - n.box[1]) > w * h * 0.4 && w * h > 0);
  return web ? { kind: "unknown", clues: ["a web page covers the app"], weak: true } : null;
}

/** Best label for a screen that already stopped a job. */
export function classify(xml: string, pkg: string): Finding {
  const found = findBlock(xml, pkg);
  if (found) return found;
  const dismiss = parseScreen(xml).filter((n) => n.pkg === pkg).map((n) => n.text || n.desc).find((t) => DISMISS.test(t.trim().toLowerCase()));
  return dismiss ? { kind: "popup", clues: [dismiss], weak: true } : { kind: "unknown", clues: [], weak: true };
}

/** Identifies what's on screen, to notice swipes that change nothing. Empty when there's nothing to compare. */
export const fingerprint = (xml: string, pkg: string) =>
  parseScreen(xml).filter((n) => n.pkg === pkg && (n.text || n.desc)).map((n) => `${n.text}|${n.desc}`).join("\n");

const MESSAGES: Record<BlockKind, string> = {
  captcha: "Looks like a captcha",
  logged_out: "Looks logged out",
  account_warning: "The app shows an account warning",
  popup: "A popup is in the way",
  unknown: "Unrecognized screen",
};

/**
 * Page source of every window, or null. TikTok shows some popups in a window of their own,
 * which the normal page source (active window only) leaves out. Lookups stay on the normal
 * mode, so the setting is put back.
 */
export async function readScreen(s: Browser): Promise<string | null> {
  try {
    await s.updateSettings({ enableMultiWindows: true });
    return await s.getPageSource();
  } catch {
    return null;
  } finally {
    await s.updateSettings({ enableMultiWindows: false }).catch(() => {});
  }
}

/**
 * Throws NeedsAttention when the screen must not be touched. Returns the page source,
 * or null when it couldn't be read (no information, not proof of a problem).
 */
export async function checkScreen(s: Browser, pkg: string): Promise<string | null> {
  const read = () => readScreen(s);
  let xml = await read();
  let found = xml && findBlock(xml, pkg);
  if (found && found.weak) {
    await sleep(3000);
    xml = await read();
    found = xml && findBlock(xml, pkg);
  }
  if (!xml || !found) return xml;
  throw new NeedsAttention(`${MESSAGES[found.kind]}: ${found.clues.join(", ")}`, { kind: found.kind, clues: found.clues, xml });
}
