//! PC setup: checks the tools PhoneDeck needs and installs missing ones into the app
//! data dir (`<data>/tools`), with no sudo. Rust then hands those paths to the worker.
//!
//! Layout:
//!   tools/android-sdk/platform-tools/adb   ANDROID_HOME, SMA_ADB
//!   tools/jdk/bin/java                     JAVA_HOME
//!   tools/appium/node_modules/...          APPIUM_HOME (Appium + uiautomator2 driver)
//!
//! Anything not installed here falls back to the old lookups (env vars, PATH,
//! ~/Android/Sdk, worker/.appium).
mod install;
pub mod phone;

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};


static TOOLS_DIR: OnceLock<PathBuf> = OnceLock::new();
static INSTALLING: Mutex<()> = Mutex::new(());

/// Call once at startup. `SMA_DATA_DIRECTORY` overrides the app data dir (handy for tests).
pub fn init(app_data_dir: &Path) {
    let _ = TOOLS_DIR.set(tools_dir_for(app_data_dir));
}

pub fn tools_dir_for(app_data_dir: &Path) -> PathBuf {
    std::env::var_os("SMA_DATA_DIRECTORY")
        .map(PathBuf::from)
        .unwrap_or_else(|| app_data_dir.to_path_buf())
        .join("tools")
}

/// Paths of the tools PhoneDeck installs itself.
#[derive(Clone)]
pub struct Managed {
    pub root: PathBuf,
}

impl Managed {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    pub fn sdk(&self) -> PathBuf {
        self.root.join("android-sdk")
    }
    pub fn adb(&self) -> PathBuf {
        self.sdk().join("platform-tools/adb")
    }
    pub fn jdk(&self) -> PathBuf {
        self.root.join("jdk")
    }
    pub fn java(&self) -> PathBuf {
        self.jdk().join("bin/java")
    }
    pub fn appium_home(&self) -> PathBuf {
        self.root.join("appium")
    }
    fn has_appium(&self) -> bool {
        self.appium_home().join("node_modules/appium/package.json").exists()
    }
}

fn managed() -> Option<Managed> {
    TOOLS_DIR.get().cloned().map(Managed::new)
}

/// adb installed by PhoneDeck, if any. Used by `adb::adb_path`.
pub fn managed_adb() -> Option<PathBuf> {
    managed().map(|m| m.adb()).filter(|p| p.exists())
}

/// Env vars for the worker, for every tool PhoneDeck installed itself.
pub fn worker_env() -> Vec<(&'static str, OsString)> {
    let Some(m) = managed() else { return vec![] };
    let mut env = vec![];
    if m.adb().exists() {
        env.push(("ANDROID_HOME", m.sdk().into()));
        env.push(("SMA_ADB", m.adb().into()));
    }
    if m.java().exists() {
        env.push(("JAVA_HOME", m.jdk().into()));
    }
    if m.has_appium() {
        env.push(("APPIUM_HOME", m.appium_home().into()));
    }
    env
}

// ---------- status ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    /// "node" | "java" | "adb" | "appium"
    id: &'static str,
    name: &'static str,
    ok: bool,
    version: Option<String>,
    path: Option<String>,
    /// Installed by PhoneDeck into the data dir.
    managed: bool,
    /// What is wrong, when not ok.
    problem: Option<String>,
    /// PhoneDeck can install it with one click.
    can_install: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    tools: Vec<ToolStatus>,
    tools_dir: String,
    udev: phone::UdevStatus,
}

pub fn status(m: &Managed) -> SetupStatus {
    SetupStatus {
        tools: vec![check_node(), check_java(m), check_adb(m), check_appium(m)],
        tools_dir: m.root.display().to_string(),
        udev: phone::udev_status(),
    }
}

fn run_capture(cmd: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    // `java -version` prints to stderr.
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    out.status.success().then_some(text)
}

pub fn node_bin() -> PathBuf {
    std::env::var_os("SMA_NODE").map(PathBuf::from).unwrap_or_else(|| "node".into())
}

fn check_node() -> ToolStatus {
    let node = node_bin();
    let version = run_capture(&node, &["--version"]).map(|v| v.trim().to_string());
    let major = version.as_deref().and_then(|v| v.trim_start_matches('v').split('.').next()?.parse::<u32>().ok());
    let problem = match major {
        None => Some("Node.js not found. Install Node 24+ from nodejs.org (or set SMA_NODE).".into()),
        Some(m) if m < 24 => Some(format!("Node {m} is too old. PhoneDeck needs Node 24+.")),
        _ => None,
    };
    ToolStatus {
        id: "node",
        name: "Node.js 24+",
        ok: problem.is_none(),
        version,
        path: which(&node),
        managed: false,
        problem,
        can_install: false,
    }
}

/// `java -version` output → major version, e.g. `openjdk version "21.0.5"` → 21, `"1.8.0"` → 8.
fn java_major(text: &str) -> Option<u32> {
    let v = text.split('"').nth(1)?;
    let mut parts = v.split(['.', '-', '+']);
    let first: u32 = parts.next()?.parse().ok()?;
    if first == 1 { parts.next()?.parse().ok() } else { Some(first) }
}

fn check_java(m: &Managed) -> ToolStatus {
    let (java, managed) = if m.java().exists() {
        (m.java(), true)
    } else if let Some(home) = std::env::var_os("JAVA_HOME").filter(|h| Path::new(h).join("bin/java").exists()) {
        (PathBuf::from(home).join("bin/java"), false)
    } else {
        ("java".into(), false)
    };
    let out = run_capture(&java, &["-version"]);
    let major = out.as_deref().and_then(java_major);
    let problem = match major {
        None => Some("No Java JDK found.".into()),
        Some(v) if v < 17 => Some(format!("Java {v} is too old. Appium needs JDK 17+.")),
        _ => None,
    };
    ToolStatus {
        id: "java",
        name: "Java JDK 17+",
        ok: problem.is_none(),
        version: out.as_deref().and_then(|o| o.lines().next()).map(str::to_string),
        path: if managed { Some(java.display().to_string()) } else { which(&java) },
        managed,
        problem,
        can_install: true,
    }
}

fn check_adb(m: &Managed) -> ToolStatus {
    let adb = crate::adb::adb_path();
    let out = run_capture(&adb, &["version"]);
    // "Android Debug Bridge version 1.0.41\nVersion 35.0.2-12147458\n..."
    let version = out.as_deref().and_then(|o| o.lines().nth(1)).map(str::to_string);
    ToolStatus {
        id: "adb",
        name: "Android platform-tools (adb)",
        ok: out.is_some(),
        version,
        path: which(&adb),
        managed: adb == m.adb(),
        problem: out.is_none().then(|| "adb not found.".into()),
        can_install: cfg!(target_arch = "x86_64"),
    }
}

/// The APPIUM_HOME the worker will use: ours, else $APPIUM_HOME, else worker/.appium.
pub fn effective_appium_home(m: &Managed) -> PathBuf {
    if m.has_appium() {
        return m.appium_home();
    }
    std::env::var_os("APPIUM_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| crate::worker::worker_dir().join(".appium"))
}

fn package_version(pkg_json: &Path) -> Option<String> {
    let text = std::fs::read_to_string(pkg_json).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    v["version"].as_str().map(str::to_string)
}

fn check_appium(m: &Managed) -> ToolStatus {
    let home = effective_appium_home(m);
    let appium = [home.join("node_modules/appium"), crate::worker::worker_dir().join("node_modules/appium")]
        .into_iter()
        .find_map(|p| package_version(&p.join("package.json")));
    let driver = package_version(&home.join("node_modules/appium-uiautomator2-driver/package.json"));
    let problem = match (&appium, &driver) {
        (None, _) => Some("Appium is not installed.".into()),
        (_, None) => Some("The UiAutomator2 driver is not installed.".into()),
        _ => None,
    };
    let version = appium.map(|a| match &driver {
        Some(d) => format!("Appium {a}, uiautomator2 {d}"),
        None => format!("Appium {a}"),
    });
    ToolStatus {
        id: "appium",
        name: "Appium + UiAutomator2 driver",
        ok: problem.is_none(),
        version,
        path: Some(home.display().to_string()),
        managed: home == m.appium_home(),
        problem,
        can_install: true,
    }
}

/// Absolute path of a command, resolving PATH.
fn which(cmd: &Path) -> Option<String> {
    if cmd.components().count() > 1 {
        return cmd.exists().then(|| cmd.display().to_string());
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|d| d.join(cmd))
        .find(|p| p.is_file())
        .map(|p| p.display().to_string())
}

// ---------- commands ----------

fn need_managed() -> Result<Managed, String> {
    managed().ok_or_else(|| "Setup is not initialised".into())
}

#[tauri::command]
pub async fn setup_status() -> Result<SetupStatus, String> {
    let m = need_managed()?;
    tauri::async_runtime::spawn_blocking(move || status(&m)).await.map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub tool: String,
    /// Short human message: "Downloading…", "Extracting…", a line of npm output.
    pub step: String,
    pub done: u64,
    pub total: Option<u64>,
}

/// Installs one tool ("java" | "adb" | "appium"). Emits `setup-progress` events.
#[tauri::command]
pub async fn setup_install(app: AppHandle, tool: String) -> Result<(), String> {
    let m = need_managed()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = INSTALLING.try_lock().map_err(|_| "Another install is already running".to_string())?;
        let emit = |p: Progress| {
            let _ = app.emit("setup-progress", p);
        };
        install::install(&m, &tool, &emit)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_java_versions() {
        assert_eq!(java_major("openjdk version \"21.0.5\" 2024-10-15\nOpenJDK Runtime"), Some(21));
        assert_eq!(java_major("java version \"1.8.0_402\""), Some(8));
        assert_eq!(java_major("openjdk version \"17\" 2021-09-14"), Some(17));
        assert_eq!(java_major("nothing here"), None);
    }

    /// Runs the real installers. Downloads ~250 MB.
    /// `SMA_DATA_DIRECTORY=/tmp/x cargo test real_install -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_install() {
        let dir = std::env::var_os("SMA_DATA_DIRECTORY").expect("set SMA_DATA_DIRECTORY");
        let m = Managed::new(PathBuf::from(dir).join("tools"));
        let last = Mutex::new(String::new());
        let emit = |p: Progress| {
            let line = format!("[{}] {}", p.tool, p.step);
            let mut last = last.lock().unwrap();
            if *last != line {
                eprintln!("{line}");
                *last = line;
            }
        };
        for tool in ["adb", "java", "appium"] {
            install::install(&m, tool, &emit).unwrap_or_else(|e| panic!("{tool}: {e}"));
        }
        assert!(m.adb().exists());
        assert!(m.java().exists());
        let _ = TOOLS_DIR.set(m.root.clone());
        let s = status(&m);
        for t in &s.tools {
            eprintln!("{} ok={} managed={} {:?} {:?}", t.id, t.ok, t.managed, t.version, t.problem);
            if t.id != "node" {
                assert!(t.ok && t.managed, "{} not ok", t.id);
            }
        }
    }
}
