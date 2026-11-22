//! Downloads and unpacks tools into the data dir. Each install unpacks into a temp
//! folder first and then swaps it in, so a failed install never leaves a half tool.
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use super::{node_bin, Managed, Progress};

const PLATFORM_TOOLS_URL: &str = "https://dl.google.com/android/repository/platform-tools-latest-linux.zip";
const JDK_MAJOR: u32 = 21;
const APPIUM_SPEC: &str = "appium@3";

type Emit<'a> = &'a (dyn Fn(Progress) + Sync);

pub fn install(m: &Managed, tool: &str, emit: Emit) -> Result<(), String> {
    fs::create_dir_all(&m.root).map_err(|e| format!("Could not create {}: {e}", m.root.display()))?;
    let step = |s: &str| emit(Progress { tool: tool.into(), step: s.into(), done: 0, total: None });
    match tool {
        "adb" => install_platform_tools(m, tool, emit, &step),
        "java" => install_jdk(m, tool, emit, &step),
        "appium" => install_appium(m, tool, emit, &step),
        other => Err(format!("Unknown tool: {other}")),
    }?;
    step("Done");
    Ok(())
}

fn install_platform_tools(m: &Managed, tool: &str, emit: Emit, step: &dyn Fn(&str)) -> Result<(), String> {
    if !cfg!(target_arch = "x86_64") {
        return Err("Google only ships Linux platform-tools for x86_64. Install adb from your distro.".into());
    }
    let tmp = fresh_tmp(m, "platform-tools")?;
    let zip = tmp.join("platform-tools.zip");
    download(PLATFORM_TOOLS_URL, &zip, tool, emit)?;
    step("Extracting…");
    let out = tmp.join("out");
    let file = File::open(&zip).map_err(err)?;
    zip::ZipArchive::new(file).and_then(|mut a| a.extract(&out)).map_err(|e| format!("Bad zip: {e}"))?;
    let adb = out.join("platform-tools/adb");
    if !adb.exists() {
        return Err("The download did not contain platform-tools/adb".into());
    }
    replace_dir(&out.join("platform-tools"), &m.sdk().join("platform-tools"))?;
    let _ = fs::remove_dir_all(&tmp);
    Ok(())
}

fn jdk_url() -> Result<String, String> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "aarch64",
        other => return Err(format!("No Temurin JDK for CPU {other}")),
    };
    Ok(format!(
        "https://api.adoptium.net/v3/binary/latest/{JDK_MAJOR}/ga/linux/{arch}/jdk/hotspot/normal/eclipse"
    ))
}

fn install_jdk(m: &Managed, tool: &str, emit: Emit, step: &dyn Fn(&str)) -> Result<(), String> {
    let tmp = fresh_tmp(m, "jdk")?;
    let archive = tmp.join("jdk.tar.gz");
    download(&jdk_url()?, &archive, tool, emit)?;
    step("Extracting…");
    let out = tmp.join("out");
    let file = File::open(&archive).map_err(err)?;
    tar::Archive::new(flate2::read::GzDecoder::new(file))
        .unpack(&out)
        .map_err(|e| format!("Bad JDK archive: {e}"))?;
    // The archive holds one folder like `jdk-21.0.5+11`.
    let top = fs::read_dir(&out)
        .map_err(err)?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.join("bin/java").exists())
        .ok_or("The JDK archive has no bin/java")?;
    replace_dir(&top, &m.jdk())?;
    let _ = fs::remove_dir_all(&tmp);
    Ok(())
}

/// `npm install appium` into APPIUM_HOME, then `appium driver install uiautomator2` there.
fn install_appium(m: &Managed, tool: &str, emit: Emit, step: &dyn Fn(&str)) -> Result<(), String> {
    let home = m.appium_home();
    fs::create_dir_all(&home).map_err(err)?;
    let pkg = home.join("package.json");
    if !pkg.exists() {
        fs::write(&pkg, "{ \"name\": \"phonedeck-appium\", \"private\": true }\n").map_err(err)?;
    }
    let node = node_bin();
    let npm = match node.parent().filter(|p| !p.as_os_str().is_empty()) {
        Some(dir) => dir.join("npm"),
        None => "npm".into(),
    };

    step(&format!("npm install {APPIUM_SPEC}…"));
    let mut cmd = Command::new(&npm);
    cmd.args(["install", "--no-audit", "--no-fund", "--loglevel", "http", APPIUM_SPEC]);
    run_streaming(cmd, &home, tool, emit).map_err(|e| format!("npm install failed: {e}"))?;

    if home.join("node_modules/appium-uiautomator2-driver/package.json").exists() {
        step("UiAutomator2 driver already installed");
        return Ok(());
    }
    step("appium driver install uiautomator2…");
    let mut cmd = Command::new(&node);
    cmd.arg(home.join("node_modules/appium/index.js"))
        .args(["driver", "install", "uiautomator2"]);
    run_streaming(cmd, &home, tool, emit).map_err(|e| format!("Driver install failed: {e}"))
}

/// Runs a command in `dir` with APPIUM_HOME set, sends each output line as progress,
/// and returns the last lines as the error when it fails.
fn run_streaming(mut cmd: Command, dir: &Path, tool: &str, emit: Emit) -> Result<(), String> {
    // npm and appium are `#!/usr/bin/env node` scripts; make sure our node is on PATH.
    let mut path = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect::<Vec<_>>();
    if let Some(dir) = node_bin().parent().filter(|p| !p.as_os_str().is_empty()) {
        path.insert(0, dir.to_path_buf());
    }
    let mut child = cmd
        .current_dir(dir)
        .env("APPIUM_HOME", dir)
        .env("PATH", std::env::join_paths(path).map_err(err)?)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not run {:?}: {e}", cmd.get_program()))?;

    let (stdout, stderr) = (child.stdout.take().expect("piped"), child.stderr.take().expect("piped"));
    // Both streams carry progress (npm logs to stderr). Keep every line for the error tail.
    let pump = |r: Box<dyn Read + Send>| {
        let mut lines = vec![];
        for line in BufReader::new(r).lines().map_while(Result::ok) {
            let line = strip_ansi(&line).trim().to_string();
            if !line.is_empty() {
                emit(Progress { tool: tool.into(), step: line.clone(), done: 0, total: None });
                lines.push(line);
            }
        }
        lines
    };
    let (mut tail, errs) = std::thread::scope(|s| {
        let e = s.spawn(|| pump(Box::new(stderr)));
        let o = pump(Box::new(stdout));
        (o, e.join().unwrap_or_default())
    });
    let status = child.wait().map_err(err)?;
    if status.success() {
        return Ok(());
    }
    tail.extend(errs);
    let start = tail.len().saturating_sub(15);
    Err(format!("{status}\n{}", tail[start..].join("\n")))
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Skip `ESC [ ... letter`.
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn download(url: &str, dest: &Path, tool: &str, emit: Emit) -> Result<(), String> {
    let mut resp = ureq::get(url).call().map_err(|e| format!("Download failed ({url}): {e}"))?;
    let total = resp.body().content_length();
    let mut reader = resp.body_mut().with_config().limit(2 * 1024 * 1024 * 1024).reader();
    let mut file = File::create(dest).map_err(err)?;
    let mut buf = vec![0u8; 64 * 1024];
    let (mut done, mut last) = (0u64, 0u64);
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("Download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(err)?;
        done += n as u64;
        if done - last >= 512 * 1024 {
            last = done;
            emit(Progress { tool: tool.into(), step: "Downloading…".into(), done, total });
        }
    }
    if total.is_some_and(|t| t != done) {
        return Err(format!("Download incomplete: got {done} of {} bytes", total.unwrap_or(0)));
    }
    emit(Progress { tool: tool.into(), step: "Downloaded".into(), done, total: Some(done) });
    Ok(())
}

fn fresh_tmp(m: &Managed, name: &str) -> Result<PathBuf, String> {
    let tmp = m.root.join(".tmp").join(name);
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(err)?;
    Ok(tmp)
}

/// Moves `from` to `to`, replacing what was there.
fn replace_dir(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    if to.exists() {
        fs::remove_dir_all(to).map_err(|e| format!("Could not remove old {}: {e}", to.display()))?;
    }
    fs::rename(from, to).map_err(|e| format!("Could not move into {}: {e}", to.display()))
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[cfg(test)]
mod tests {
    use super::strip_ansi;

    #[test]
    fn strips_colors() {
        assert_eq!(strip_ansi("\x1b[32m✔\x1b[39m done"), "✔ done");
    }
}
