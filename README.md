# Tapfleet

Desktop app (Tauri + React + shadcn/ui + SQLite) that drives Android phones over USB with Appium.

```
app/            Tauri desktop app (React UI in src/, Rust in src-tauri/)
worker/         Node worker: starts Appium, runs phone jobs (WebdriverIO)
```

UI layout (`app/src`): one folder per sidebar page in `features/`, registered in
`features/index.ts`. Real data goes through `data/` (wrappers over `api.ts`).

How it fits: React → Rust commands → SQLite. Rust starts the worker; the worker starts
Appium and keeps one session per phone. Rust and the worker talk JSON lines over stdin/stdout.

## Run

Needs Node 24+, Rust, a JDK, Android platform-tools, and the Tauri Linux prerequisites.

```sh
npm run setup   # install deps + Appium UiAutomator2 driver
npm run dev     # start the app
npm run check   # typecheck, build, tests
```

**Setup screen:** the app's **Setup** button checks Node, JDK, adb and Appium, and installs
anything missing into `~/.local/share/app.tapfleet.desktop/tools` (no sudo). It also adds the Linux
USB rule (via pkexec) and walks each phone through setup. `TAPFLEET_DATA_DIRECTORY` moves the tools folder.
Test the real downloads: `TAPFLEET_DATA_DIRECTORY=/tmp/x cargo test real_install -- --ignored --nocapture`
(in `app/src-tauri`).

Phone: enable USB debugging. On Xiaomi also enable **Install via USB** and
**USB debugging (Security settings)** in Developer options, or Appium can't install its helper app.

**Web access:** the app also serves its UI at `http://<this-pc>:1440` for browsers on other devices
(same Wi-Fi or Tailscale). Copy the link with the token from **Settings → Web access**.
`TAPFLEET_WEB_ADDR=127.0.0.1:1440` keeps it on this PC only; `TAPFLEET_WEB=0` turns it off.
The Devices page and Control room show each phone's live screen (scrcpy, installed from Setup):
click and drag to tap and swipe, scroll to scroll, type to send text, Esc or right-click for Back.
In dev builds the web page serves `app/dist`, so run `npm --prefix app run build` after UI changes.

Logs: `~/.local/share/app.tapfleet.desktop/logs/appium.log`. Database: `~/.local/share/app.tapfleet.desktop/tapfleet.db`.
Installs from before the rename (`com.sma.desktop`, `sma.db`) move over on first start.
The old `SMA_*` env vars still work.
