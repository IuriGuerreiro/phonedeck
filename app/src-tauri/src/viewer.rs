//! "View screen": a scrcpy window per phone, view-only so it can't disturb a running job.
use std::{
    collections::HashMap,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

#[derive(Default)]
pub struct Viewers(Mutex<HashMap<String, Child>>);

impl Viewers {
    /// Opens a window for `serial`. If one is already open, does nothing.
    pub fn open(&self, serial: &str, title: &str) -> Result<(), String> {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(child) = map.get_mut(serial) {
            if matches!(child.try_wait(), Ok(None)) {
                return Ok(());
            }
        }
        let bin = crate::setup::scrcpy_bin();
        let child = Command::new(&bin)
            .args(["--serial", serial])
            .args(["--window-title", title])
            .arg("--no-control") // view only
            .arg("--no-audio")
            .args(["--max-size", "1024"])
            .args(["--video-bit-rate", "4M"])
            // scrcpy ships its own adb; mixing adb versions restarts the adb server
            // and drops Appium's connection. Use ours.
            .env("ADB", crate::adb::adb_path())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| {
                format!(
                    "Could not start scrcpy ({}): {e}. Install it from Setup → PC.",
                    bin.display()
                )
            })?;
        map.insert(serial.to_string(), child);
        Ok(())
    }

    pub fn close_all(&self) {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        for (_, mut child) in map.drain() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
