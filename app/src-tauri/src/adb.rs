//! Finds phones with `adb devices -l`.
use std::{path::PathBuf, process::Command};

pub struct AdbDevice {
    pub serial: String,
    /// adb state: "device" (ready), "unauthorized", "offline", ...
    pub state: String,
    pub model: Option<String>,
}

pub fn adb_path() -> PathBuf {
    if let Some(p) = std::env::var_os("SMA_ADB") {
        return p.into();
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

pub fn list() -> Result<Vec<AdbDevice>, String> {
    let out = Command::new(adb_path())
        .args(["devices", "-l"])
        .output()
        .map_err(|e| format!("Could not run adb: {e}. Install Android platform-tools or set SMA_ADB."))?;
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
            let state = parts.next()?.to_string();
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
                   emulator-5554          unauthorized transport_id:4\n\n";
        let d = parse(out);
        assert_eq!(d.len(), 2);
        assert_eq!(d[0].serial, "470955eb");
        assert_eq!(d[0].state, "device");
        assert_eq!(d[0].model.as_deref(), Some("Redmi Note 10"));
        assert_eq!(d[1].state, "unauthorized");
        assert_eq!(d[1].model, None);
    }
}
