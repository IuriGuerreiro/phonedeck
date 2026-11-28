//! Finds phones with `adb devices -l`.
use std::{path::PathBuf, process::Command};

pub struct AdbDevice {
    pub serial: String,
    /// adb state: "device" (ready), "unauthorized", "offline", ...
    pub state: String,
    pub model: Option<String>,
}

pub fn adb_path() -> PathBuf {
    if let Some(p) = crate::rename::var_os("ADB") {
        return p.into();
    }
    if let Some(p) = crate::setup::managed_adb() {
        return p;
    }
    let sdks = ["ANDROID_HOME", "ANDROID_SDK_ROOT"]
        .iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .chain(std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Android/Sdk")));
    for sdk in sdks {
        let adb = sdk.join("platform-tools/adb");
        if adb.exists() {
            return adb;
        }
    }
    "adb".into()
}

/// Runs `adb -s <serial> <args>`; stdout+stderr, trimmed. Err when adb exits non-zero.
pub fn run(serial: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(adb_path())
        .arg("-s")
        .arg(serial)
        .args(args)
        .output()
        .map_err(|e| format!("Could not run adb: {e}"))?;
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    if out.status.success() { Ok(text.trim().to_string()) } else { Err(text.trim().to_string()) }
}

pub fn list() -> Result<Vec<AdbDevice>, String> {
    let out = Command::new(adb_path())
        .args(["devices", "-l"])
        .output()
        .map_err(|e| format!("Could not run adb: {e}. Install Android platform-tools or set TAPFLEET_ADB."))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(parse(&String::from_utf8_lossy(&out.stdout)))
}

/// Lines look like: `470955eb  device usb:1-2 product:x model:Redmi_Note_10 device:y transport_id:1`
fn parse(text: &str) -> Vec<AdbDevice> {
    text.lines()
        .skip_while(|l| !l.starts_with("List of devices"))
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let serial = parts.next()?.to_string();
            let mut state = parts.next()?.to_string();
            // "no permissions (missing udev rules? ...); see [...]" spans several words.
            if state == "no" {
                state = "no permissions".into();
                for p in parts.by_ref() {
                    if p.ends_with(']') {
                        break;
                    }
                }
            }
            let model = parts
                .find_map(|p| p.strip_prefix("model:"))
                .map(|m| m.replace('_', " "));
            Some(AdbDevice { serial, state, model })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_devices_output() {
        let out = "* daemon started successfully\nList of devices attached\n\
                   470955eb               device usb:1-2 product:sweet model:Redmi_Note_10 device:sweet transport_id:3\n\
                   emulator-5554          unauthorized transport_id:4\n\
                   ABC123                 no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html] usb:1-3 transport_id:5\n\n";
        let d = parse(out);
        assert_eq!(d.len(), 3);
        assert_eq!(d[2].state, "no permissions");
        assert_eq!(d[0].serial, "470955eb");
        assert_eq!(d[0].state, "device");
        assert_eq!(d[0].model.as_deref(), Some("Redmi Note 10"));
        assert_eq!(d[1].state, "unauthorized");
        assert_eq!(d[1].model, None);
    }
}
