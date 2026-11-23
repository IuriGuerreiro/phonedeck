//! What each phone is doing right now: the running job and its latest progress line.
use std::{collections::HashMap, sync::Mutex};

use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LiveJob {
    pub serial: String,
    pub run_id: i64,
    pub action: String,
    pub username: Option<String>,
    /// Milliseconds since the Unix epoch.
    pub started_at: u64,
    pub progress: Option<String>,
}

#[derive(Default)]
pub struct Live(Mutex<HashMap<String, LiveJob>>);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl Live {
    fn map(&self) -> std::sync::MutexGuard<'_, HashMap<String, LiveJob>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn start(&self, serial: &str, run_id: i64, action: &str, username: Option<&str>) {
        self.map().insert(
            serial.to_string(),
            LiveJob {
                serial: serial.to_string(),
                run_id,
                action: action.to_string(),
                username: username.map(str::to_string),
                started_at: now_ms(),
                progress: None,
            },
        );
    }

    pub fn progress(&self, serial: &str, message: &str) {
        if let Some(j) = self.map().get_mut(serial) {
            j.progress = Some(message.to_string());
        }
    }

    /// Only clears the entry if it is still this run (a newer job may have started).
    pub fn finish(&self, serial: &str, run_id: i64) {
        let mut map = self.map();
        if map.get(serial).is_some_and(|j| j.run_id == run_id) {
            map.remove(serial);
        }
    }

    pub fn all(&self) -> Vec<LiveJob> {
        let mut v: Vec<_> = self.map().values().cloned().collect();
        v.sort_by(|a, b| a.serial.cmp(&b.serial));
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_one_job_per_phone() {
        let live = Live::default();
        live.start("A", 1, "warmup", Some("ana"));
        live.progress("A", "Video 3");
        live.progress("B", "ignored");
        assert_eq!(live.all().len(), 1);
        assert_eq!(live.all()[0].progress.as_deref(), Some("Video 3"));

        live.start("A", 2, "swipe_up", None);
        live.finish("A", 1); // stale run: keep run 2
        assert_eq!(live.all()[0].run_id, 2);
        live.finish("A", 2);
        assert!(live.all().is_empty());
    }
}
