//! Phone-side setup: Linux USB permissions (udev), phone info, and pre-installing
//! Appium's UiAutomator2 helper apps.
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde::Serialize;

use crate::adb::{adb_path, run as adb};

/// Gives the logged-in user access to any USB device that exposes an adb interface
/// (class ff, subclass 42, protocol 01), whatever the vendor.
const UDEV_RULE: &str = r#"SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_device", ENV{ID_USB_INTERFACES}=="*:ff4201:*", MODE="0660", TAG+="uaccess""#;
const UDEV_FILE: &str = "/etc/udev/rules.d/51-phonedeck-android.rules";
const UDEV_DIRS: [&str; 3] = ["/etc/udev/rules.d", "/usr/lib/udev/rules.d", "/lib/udev/rules.d"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UdevStatus {
    /// Only Linux needs udev rules.
    applies: bool,
    /// Some rule for Android/adb devices is already present.
    installed: bool,
    /// Copy-paste fallback for a terminal.
    manual_command: String,
}

pub fn udev_status() -> UdevStatus {
    UdevStatus {
        applies: cfg!(target_os = "linux"),
        installed: has_android_rule(),
        manual_command: format!(
            "echo '{UDEV_RULE}' | sudo tee {UDEV_FILE} && sudo udevadm control --reload-rules && sudo udevadm trigger && adb kill-server"
        ),
    }
}

fn has_android_rule() -> bool {
    UDEV_DIRS.iter().filter_map(|d| fs::read_dir(d).ok()).flatten().filter_map(Result::ok).any(|e| {
        let name = e.file_name().to_string_lossy().to_lowercase();
        name.contains("android") || fs::read_to_string(e.path()).is_ok_and(|t| t.contains("ff4201"))
    })
}

/// Writes the udev rule through pkexec (the desktop's graphical sudo prompt).
#[tauri::command]
pub async fn install_udev_rule() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let tmp = std::env::temp_dir().join("phonedeck-51-android.rules");
        fs::write(&tmp, format!("# Added by Tapfleet: lets adb reach Android phones over USB.\n{UDEV_RULE}\n"))
            .map_err(|e| e.to_string())?;
        let script = format!(
            "install -m 0644 \"$1\" {UDEV_FILE} && udevadm control --reload-rules && udevadm trigger --subsystem-match=usb"
        );
        let out = Command::new("pkexec")
            .args(["sh", "-c", &script, "sh"])
            .arg(&tmp)
            .output()
            .map_err(|e| format!("Could not run pkexec ({e}). Run the manual command instead."))?;
        let _ = fs::remove_file(&tmp);
        match out.status.code() {
            Some(0) => {}
            Some(126) => return Err("The password prompt was cancelled.".into()),
            Some(127) => return Err("Not authorised (no polkit agent?). Run the manual command instead.".into()),
            _ => return Err(format!("Installing the rule failed: {}", String::from_utf8_lossy(&out.stderr).trim())),
        }
        // adb caches permission errors; restart it so it sees the new access.
        let _ = Command::new(adb_path()).arg("kill-server").output();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

const SERVER_PKG: &str = "io.appium.uiautomator2.server";
const SERVER_TEST_PKG: &str = "io.appium.uiautomator2.server.test";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneInfo {
    manufacturer: String,
    model: String,
    android_version: String,
    /// Both UiAutomator2 helper apps are on the phone.
    helpers_installed: bool,
}

/// Needs the phone in adb state "device".
#[tauri::command]
pub async fn phone_info(serial: String) -> Result<PhoneInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prop = |p: &str| adb(&serial, &["shell", "getprop", p]);
        let packages = adb(&serial, &["shell", "pm", "list", "packages", "io.appium"])?;
        let has = |pkg: &str| packages.lines().any(|l| l.trim() == format!("package:{pkg}"));
        Ok(PhoneInfo {
            manufacturer: prop("ro.product.manufacturer")?,
            model: prop("ro.product.model")?,
            android_version: prop("ro.build.version.release")?,
            helpers_installed: has(SERVER_PKG) && has(SERVER_TEST_PKG),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkResult {
    file: String,
    ok: bool,
    output: String,
    /// Xiaomi & co. block installs until "Install via USB" is on.
    user_restricted: bool,
}

/// Installs the UiAutomator2 server, its test runner and Appium Settings from the
/// installed driver, so the first Appium session doesn't have to.
#[tauri::command]
pub async fn install_helper_apks(serial: String) -> Result<Vec<ApkResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let m = super::need_managed()?;
        let home = super::effective_appium_home(&m);
        let apks = find_helper_apks(&home.join("node_modules"));
        if apks.is_empty() {
            return Err(format!(
                "No helper APKs found under {}. Install Appium + UiAutomator2 first.",
                home.display()
            ));
        }
        Ok(apks
            .iter()
            .map(|apk| {
                let path = apk.to_string_lossy();
                let res = adb(&serial, &["install", "-r", "-g", &path]);
                let output = match &res {
                    Ok(o) | Err(o) => o.clone(),
                };
                ApkResult {
                    file: apk.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                    ok: res.is_ok() && output.contains("Success"),
                    user_restricted: output.contains("INSTALL_FAILED_USER_RESTRICTED"),
                    output,
                }
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Settings app first, then the server, then its test runner.
fn find_helper_apks(node_modules: &Path) -> Vec<PathBuf> {
    let mut found = vec![];
    walk(node_modules, 0, &mut found);
    found.retain(|p| {
        let s = p.to_string_lossy();
        (s.contains("/io.appium.settings/") || s.contains("/appium-uiautomator2-server/")) && s.ends_with(".apk")
    });
    // The same package can be nested more than once; keep one copy of each file name.
    found.sort_by_key(|p| p.components().count());
    let mut seen = std::collections::HashSet::new();
    found.retain(|p| seen.insert(p.file_name().map(|n| n.to_owned())));
    found.sort_by_key(|p| {
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        (if name.contains("settings") { 0 } else if name.contains("androidTest") { 2 } else { 1 }, name)
    });
    found
}

fn walk(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if depth > 8 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.filter_map(Result::ok) {
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            walk(&e.path(), depth + 1, out);
        } else if ft.is_file() && e.file_name().to_string_lossy().ends_with(".apk") {
            out.push(e.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_helper_apks_in_install_order() {
        let root = std::env::temp_dir().join(format!("phonedeck-apks-{}", std::process::id()));
        let nm = root.join("node_modules/appium-uiautomator2-driver/node_modules");
        for f in [
            "appium-uiautomator2-server/apks/appium-uiautomator2-server-debug-androidTest.apk",
            "appium-uiautomator2-server/apks/appium-uiautomator2-server-v10.7.6.apk",
            "io.appium.settings/apks/settings_apk-debug.apk",
            "other-package/apks/ignored.apk",
        ] {
            let p = nm.join(f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, b"").unwrap();
        }
        let names: Vec<_> = find_helper_apks(&root.join("node_modules"))
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        let _ = fs::remove_dir_all(&root);
        assert_eq!(
            names,
            [
                "settings_apk-debug.apk",
                "appium-uiautomator2-server-v10.7.6.apk",
                "appium-uiautomator2-server-debug-androidTest.apk"
            ]
        );
    }
}
