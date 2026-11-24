// Made-up screens: real captcha samples don't exist yet.
import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, findBlock, fingerprint } from "../src/screen-check.ts";

const PKG = "com.zhiliaoapp.musically";
const el = (text: string, o: { cls?: string; id?: string; desc?: string; pkg?: string; box?: string } = {}) =>
  `<${o.cls ?? "android.widget.TextView"} package="${o.pkg ?? PKG}" class="${o.cls ?? "android.widget.TextView"}" text="${text}" content-desc="${o.desc ?? ""}" resource-id="${o.id ?? ""}" bounds="${o.box ?? "[0,0][100,50]"}" />`;
const screen = (...els: string[]) => `<?xml version="1.0"?><hierarchy rotation="0"><android.widget.FrameLayout package="${PKG}" class="android.widget.FrameLayout" text="" bounds="[0,0][1080,2400]">${els.join("")}</android.widget.FrameLayout></hierarchy>`;
const kind = (...els: string[]) => findBlock(screen(...els), PKG)?.kind ?? null;

test("recognizes likely captchas, warnings and logouts", () => {
  for (const t of ["Verify to continue:", "Drag the slider to fit the puzzle", "Select 2 objects that are the same shape:", "Verifica para continuar", "Arrasta o controlo deslizante para encaixar a peça", "Verificaci&#243;n de seguridad"])
    assert.equal(kind(el(t)), "captcha", t);
  assert.equal(kind(el("", { id: `${PKG}:id/captcha_view` })), "captcha");
  assert.equal(kind(el("You’re following too fast. Take a break.")), "account_warning");
  assert.equal(kind(el("Your account was permanently banned")), "account_warning");
  assert.equal(kind(el("Continuar a editar esta publicação?")), "popup");
  assert.equal(kind(el("Iniciar sessão no TikTok")), "logged_out");
});

test("does not flag normal screens", () => {
  assert.equal(kind(el("", { desc: "Share video. 1.2K shares" }), el("How I solved the captcha: verify to continue lol #fyp")), null);
  assert.equal(kind(el("Verify to continue", { cls: "android.widget.EditText" })), null);
  assert.equal(kind(el("Verify to continue", { pkg: "com.other.app" })), null);
  assert.equal(kind(el("Início"), el("Perfil"), el("Vídeos"), el("Mudar de conta"), el("Adicionar conta")), null);
  assert.equal(findBlock("", PKG), null);
});

test("treats a covering web page as unknown, not a small one", () => {
  assert.deepEqual(findBlock(screen(el("", { cls: "android.webkit.WebView", box: "[0,400][1080,2000]" })), PKG), { kind: "unknown", clues: ["a web page covers the app"], weak: true });
  assert.equal(kind(el("", { cls: "android.webkit.WebView", box: "[0,0][1080,200]" })), null);
});

test("labels popups and unknown screens, and notices unchanged screens", () => {
  assert.equal(classify(screen(el("Not now")), PKG).kind, "popup");
  assert.equal(classify(screen(el("Something new")), PKG).kind, "unknown");
  assert.equal(fingerprint(screen(el("a")), PKG), fingerprint(screen(el("a")), PKG));
  assert.notEqual(fingerprint(screen(el("a")), PKG), fingerprint(screen(el("b")), PKG));
  assert.equal(fingerprint(screen(), PKG), "");
});
