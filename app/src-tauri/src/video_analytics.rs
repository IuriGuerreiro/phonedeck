use serde::{Deserialize, Serialize};
use tauri::State;
use rusqlite::params;
use crate::db::Db;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMeasurement {
    pub platform_video_id: String,
    pub url: String,
    pub caption: String,
    pub views: i64,
    pub likes: Option<i64>,
    pub comments: Option<i64>,
    pub shares: Option<i64>,
    pub saves: Option<i64>,
}

#[derive(Deserialize)]
struct Collection {
    pub videos: Vec<VideoMeasurement>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoReading {
    pub id: i64,
    pub account_id: i64,
    pub captured_at: String,
    pub videos: Vec<VideoMeasurement>,
}

pub fn record(db: &Db, serial: &str, job: &serde_json::Value, result: &serde_json::Value) -> Result<(), String> {
    let videos: Collection = serde_json::from_value(result.clone()).map_err(|e| e.to_string())?;
    let platform = job["platform"].as_str().ok_or("Missing platform")?;
    let username = job["username"].as_str().ok_or("Missing username")?;
    db.save_video_reading(serial, platform, username, &videos.videos)
}

impl Db {
    pub fn save_video_reading(&self, serial: &str, platform: &str, username: &str, videos: &[VideoMeasurement]) -> Result<(), String> {
        let mut ids = std::collections::HashSet::new();
        for v in videos {
            if v.platform_video_id.is_empty() || !v.platform_video_id.bytes().all(|b| b.is_ascii_digit()) || !ids.insert(&v.platform_video_id) {
                return Err("Invalid or duplicate video identity".into());
            }
            let url = tauri::Url::parse(&v.url).map_err(|e| e.to_string())?;
            if url.scheme() != "https" || url.host_str() != Some("www.tiktok.com") || !(url.path().eq_ignore_ascii_case(&format!("/@{username}/video/{}", v.platform_video_id)) || url.path().eq_ignore_ascii_case(&format!("/@{username}/photo/{}", v.platform_video_id))) {
                return Err("Invalid TikTok video URL".into());
            }
            if v.views < 0 || [v.likes, v.comments, v.shares, v.saves].into_iter().flatten().any(|n| n < 0) {
                return Err("Video counts must be nonnegative".into());
            }
        }
        let conn = self.conn();
        let account_id: i64 = conn.query_row("SELECT id FROM accounts WHERE serial = ?1 AND platform = ?2 AND username = ?3", params![serial, platform, username], |r| r.get(0)).map_err(|e| e.to_string())?;
        let measurements = serde_json::to_string(videos).map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO video_readings(account_id, measurements) VALUES (?1, ?2)", params![account_id, measurements]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn video_readings(&self) -> Result<Vec<VideoReading>, String> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT v.id, v.account_id, v.captured_at, v.measurements FROM video_readings v JOIN accounts a ON a.id = v.account_id ORDER BY v.id").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))).map_err(|e| e.to_string())?;
        rows.map(|r| {
            let (id, account_id, captured_at, json) = r.map_err(|e| e.to_string())?;
            Ok(VideoReading { id, account_id, captured_at, videos: serde_json::from_str(&json).map_err(|e| e.to_string())? })
        }).collect()
    }
}

#[tauri::command(async)]
pub fn video_readings(db: State<'_, Db>) -> Result<Vec<VideoReading>, String> {
    db.video_readings()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::AccountEvent;

    fn video(views: i64) -> VideoMeasurement {
        VideoMeasurement { platform_video_id: "123".into(), url: "https://www.tiktok.com/@one/video/123".into(), caption: "A video".into(), views, likes: Some(0), comments: None, shares: Some(1), saves: None }
    }

    #[test]
    fn retains_history_and_empty_collections_without_converting_missing_counts_to_zero() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("sma-video-{}-{stamp}.db", std::process::id()));
        let db = Db::open(&path).unwrap();
        db.upsert_account("A", "tiktok", "one", AccountEvent::Seen).unwrap();
        db.upsert_account("B", "tiktok", "two", AccountEvent::Seen).unwrap();
        db.save_video_reading("A", "tiktok", "one", &[video(10)]).unwrap();
        db.save_video_reading("A", "tiktok", "one", &[video(20)]).unwrap();
        db.save_video_reading("B", "tiktok", "two", &[]).unwrap();
        let rows = db.video_readings().unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].account_id, rows[1].account_id);
        assert_ne!(rows[1].account_id, rows[2].account_id);
        assert_eq!(rows[0].videos[0].views, 10);
        assert_eq!(rows[1].videos[0].views, 20);
        assert_eq!(rows[1].videos[0].likes, Some(0));
        assert_eq!(rows[1].videos[0].comments, None);
        assert!(rows[2].videos.is_empty());
        assert!(rows[0].captured_at.ends_with('Z'));
        drop(db);
        let reopened = Db::open(&path).unwrap();
        assert_eq!(reopened.video_readings().unwrap().len(), 3);
        drop(reopened);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_bad_measurements_without_saving_a_partial_collection() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        db.upsert_account("A", "tiktok", "one", AccountEvent::Seen).unwrap();
        assert!(db.save_video_reading("A", "tiktok", "one", &[video(10), video(-1)]).is_err());
        assert!(db.save_video_reading("A", "tiktok", "one", &[video(1), video(2)]).is_err());
        let mut bad = video(10);
        bad.url = "https://evil.test/@one/video/123".into();
        assert!(db.save_video_reading("A", "tiktok", "one", &[bad]).is_err());
        assert!(db.video_readings().unwrap().is_empty());
    }
}
