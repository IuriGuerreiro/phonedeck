//! Live phone stats (battery, storage, RAM, screen) and screenshots, straight from adb.
use std::process::Command;

use serde::Serialize;
use tauri::ipc::Response;

use crate::adb::{adb_path, run as adb};

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStats {
    /// 0–100.
    pub battery: Option<u8>,
    pub charging: bool,
    /// °C.
    pub battery_temp: Option<f32>,
    pub storage_used_bytes: Option<u64>,
    pub storage_total_bytes: Option<u64>,
    pub ram_total_bytes: Option<u64>,
    /// e.g. "1080x2400".
    pub screen: Option<String>,
}

/// Plain text only: the phone's shell would read `<`, `>` or `|` as redirects.
const SEP: &str = "@@SMA_SEP@@";

/// One adb round trip for everything. Needs the phone in adb state "device".
#[tauri::command]
pub async fn device_stats(serial: String) -> Result<DeviceStats, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let script = format!(
            "dumpsys battery; echo {SEP}; df -k /data; echo {SEP}; grep MemTotal /proc/meminfo; echo {SEP}; wm size"
        );
        Ok(parse(&adb(&serial, &["shell", &script])?))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// PNG of the phone's screen, sent to the UI as raw bytes (no JSON/base64).
/// Empty when the screen is off: a screencap would just be black.
#[tauri::command]
pub async fn screenshot(serial: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || screenshot_png(&serial).map(Response::new))
        .await
        .map_err(|e| e.to_string())?
}

/// Blocking. PNG bytes, or empty when the screen is off.
pub fn screenshot_png(serial: &str) -> Result<Vec<u8>, String> {
    if !screen_on(&adb(serial, &["shell", "dumpsys power | grep mWakefulness="])?) {
        return Ok(Vec::new());
    }
    let out = Command::new(adb_path())
        .args(["-s", serial, "exec-out", "screencap", "-p"])
        .output()
        .map_err(|e| format!("Could not run adb: {e}"))?;
    // screencap writes PNG to stdout; anything else means it failed.
    if !out.status.success() || !out.stdout.starts_with(b"\x89PNG") {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() { "Screenshot failed".into() } else { err });
    }
    Ok(out.stdout)
}

/// Turns the screen on (does not unlock).
#[tauri::command]
pub async fn wake_screen(serial: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || adb(&serial, &["shell", "input keyevent KEYCODE_WAKEUP"]).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

/// `dumpsys power` says "mWakefulness=Awake" when the screen is on ("Asleep" / "Dozing" when off).
fn screen_on(power: &str) -> bool {
    // Unknown output: assume on and let the screenshot show what it shows.
    !power.contains("mWakefulness=") || power.contains("mWakefulness=Awake")
}

fn parse(text: &str) -> DeviceStats {
    let mut parts = text.split(SEP);
    let (battery, df, mem, wm) = (
        parts.next().unwrap_or(""),
        parts.next().unwrap_or(""),
        parts.next().unwrap_or(""),
        parts.next().unwrap_or(""),
    );
    let mut s = DeviceStats::default();

    // "  level: 82", "  status: 2" (2 = charging, 5 = full), "  AC powered: true", "  temperature: 312".
    let field = |name: &str| {
        battery.lines().find_map(|l| {
            let (k, v) = l.split_once(':')?;
            (k.trim() == name).then(|| v.trim().to_string())
        })
    };
    s.battery = field("level").and_then(|v| v.parse::<u8>().ok()).map(|v| v.min(100));
    let powered = ["AC powered", "USB powered", "Wireless powered"]
        .iter()
        .any(|k| field(k).as_deref() == Some("true"));
    s.charging = field("status").as_deref() == Some("2") || (powered && field("status").as_deref() != Some("5"));
    s.battery_temp = field("temperature").and_then(|v| v.parse::<f32>().ok()).map(|t| t / 10.0);

    // Header, then "fs 1K-blocks used available use% mount". Old toybox may wrap the line.
    let nums: Vec<u64> = df
        .lines()
        .skip_while(|l| !l.trim_start().starts_with("Filesystem"))
        .skip(1)
        .flat_map(str::split_whitespace)
        .skip(1)
        .take(2)
        .filter_map(|t| t.parse().ok())
        .collect();
    if let [total, used] = nums[..] {
        s.storage_total_bytes = Some(total * 1024);
        s.storage_used_bytes = Some(used * 1024);
    }

    // "MemTotal:        5767180 kB"
    s.ram_total_bytes = mem
        .split_whitespace()
        .nth(1)
        .and_then(|v| v.parse::<u64>().ok())
        .map(|kb| kb * 1024);

    // "Physical size: 1080x2400", maybe followed by "Override size: ...". The override is what shows.
    let size = |label: &str| wm.lines().find_map(|l| l.trim().strip_prefix(label).map(|v| v.trim().to_string()));
    s.screen = size("Override size:").or_else(|| size("Physical size:"));
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stats() {
        let text = format!(
            "Current Battery Service state:\n  AC powered: false\n  USB powered: true\n  status: 2\n  level: 82\n  temperature: 312\n\
             {SEP}\nFilesystem      1K-blocks     Used Available Use% Mounted on\n/dev/block/dm-5 115000000 74000000 41000000  65% /data\n\
             {SEP}\nMemTotal:        5767180 kB\n{SEP}\nPhysical size: 1080x2400\n"
        );
        let s = parse(&text);
        assert_eq!(s.battery, Some(82));
        assert!(s.charging);
        assert_eq!(s.battery_temp, Some(31.2));
        assert_eq!(s.storage_total_bytes, Some(115_000_000 * 1024));
        assert_eq!(s.storage_used_bytes, Some(74_000_000 * 1024));
        assert_eq!(s.ram_total_bytes, Some(5_767_180 * 1024));
        assert_eq!(s.screen.as_deref(), Some("1080x2400"));
    }

    #[test]
    fn reads_screen_state() {
        assert!(screen_on("  mWakefulness=Awake"));
        assert!(!screen_on("  mWakefulness=Dozing"));
        assert!(!screen_on("  mWakefulness=Asleep"));
        assert!(screen_on(""));
    }

    #[test]
    fn full_battery_on_charger_is_not_charging() {
        let s = parse("  AC powered: true\n  status: 5\n  level: 100\n");
        assert_eq!(s.battery, Some(100));
        assert!(!s.charging);
    }

    #[test]
    fn handles_wrapped_df_and_override_size() {
        let text = format!(
            "{SEP}\nFilesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/bootdevice/by-name/userdata\n  50000 20000 30000 40% /data\n\
             {SEP}\n{SEP}\nPhysical size: 1080x2400\nOverride size: 720x1600\n"
        );
        let s = parse(&text);
        assert_eq!(s.storage_total_bytes, Some(50_000 * 1024));
        assert_eq!(s.screen.as_deref(), Some("720x1600"));
        assert_eq!(s.battery, None);
    }
}
