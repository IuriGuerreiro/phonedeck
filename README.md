# PhoneDeck

Desktop app (Tauri + React + shadcn/ui + SQLite) that drives Android phones over USB with Appium.

```
app/            Tauri desktop app (React UI in src/, Rust in src-tauri/)
worker/         Node worker: starts Appium, runs phone jobs (WebdriverIO)
```

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
anything missing into `~/.local/share/com.sma.desktop/tools` (no sudo). It also adds the Linux
USB rule (via pkexec) and walks each phone through setup. `SMA_DATA_DIRECTORY` moves the tools folder.
Test the real downloads: `SMA_DATA_DIRECTORY=/tmp/x cargo test real_install -- --ignored --nocapture`
(in `app/src-tauri`).

Phone: enable USB debugging. On Xiaomi also enable **Install via USB** and
**USB debugging (Security settings)** in Developer options, or Appium can't install its helper app.

Logs: `~/.local/share/com.sma.desktop/logs/appium.log`. Database: `~/.local/share/com.sma.desktop/sma.db`.
