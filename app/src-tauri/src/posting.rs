use std::{fs::{self, OpenOptions}, io::Write, path::PathBuf, sync::Mutex};
use rusqlite::params;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use crate::db::Db;

const MAX_BYTES: i64 = 50 * 1024 * 1024;
pub struct Media { dir: PathBuf, writes: Mutex<()> }
impl Media {
    pub fn new(dir: PathBuf) -> Result<Self, std::io::Error> {
        fs::create_dir_all(&dir)?;
        Ok(Self { dir, writes: Mutex::new(()) })
    }
    fn path(&self, id: i64) -> PathBuf { self.dir.join(format!("{id}.mp4")) }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Post {
    pub id: i64,
    pub account_id: i64,
    pub username: String,
    pub serial: String,
    pub name: String,
    pub caption: String,
    pub visibility: String,
    pub bytes: i64,
    pub status: String,
    pub error: Option<String>,
    pub created_at: String,
}
impl Db {
    fn post_status(&self, id: i64, status: &str, error: Option<&str>) -> Result<(), String> {
        self.conn().execute("UPDATE posts SET status = ?2, error = ?3 WHERE id = ?1", params![id, status, error]).map_err(|e| e.to_string())?;
        Ok(())
    }
    fn claim_post(&self, id: i64, before: &[&str], after: &str) -> Result<(), String> {
        let conn = self.conn();
        let status: String = conn.query_row("SELECT status FROM posts WHERE id = ?1", [id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !before.contains(&status.as_str()) { return Err(format!("Cannot {after} a post with status {status}")); }
        let occupied: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM posts p JOIN accounts a ON a.id = p.account_id WHERE a.serial = (SELECT a2.serial FROM posts p2 JOIN accounts a2 ON a2.id = p2.account_id WHERE p2.id = ?1) AND p.status IN ('preparing', 'publishing'))", [id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if occupied { return Err("Another post is being prepared or published on this phone".into()); }
        if after == "preparing" {
            conn.execute("UPDATE posts SET status = 'draft' WHERE id != ?1 AND status = 'ready' AND account_id IN (SELECT a.id FROM accounts a WHERE a.serial = (SELECT a2.serial FROM posts p2 JOIN accounts a2 ON a2.id = p2.account_id WHERE p2.id = ?1))", [id]).map_err(|e| e.to_string())?;
        }
        conn.execute("UPDATE posts SET status = ?2, error = NULL WHERE id = ?1", params![id, after]).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn posts(&self) -> Result<Vec<Post>, String> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT p.id, p.account_id, a.username, a.serial, p.name, p.caption, p.visibility, p.bytes, p.status, p.error, p.created_at FROM posts p JOIN accounts a ON a.id = p.account_id ORDER BY p.id DESC").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok(Post { id: r.get(0)?, account_id: r.get(1)?, username: r.get(2)?, serial: r.get(3)?, name: r.get(4)?, caption: r.get(5)?, visibility: r.get(6)?, bytes: r.get(7)?, status: r.get(8)?, error: r.get(9)?, created_at: r.get(10)? })).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }
    fn post(&self, id: i64) -> Result<Post, String> { self.posts()?.into_iter().find(|p| p.id == id).ok_or("Post not found".into()) }
}

#[tauri::command(async)]
pub fn list_posts(db: State<'_, Db>) -> Result<Vec<Post>, String> { db.posts() }

#[tauri::command(async)]
pub fn create_post(db: State<'_, Db>, account_id: i64, name: String, caption: String, visibility: String, bytes: i64) -> Result<i64, String> {
    create_draft(&db, account_id, name, caption, visibility, bytes)
}

fn create_draft(db: &Db, account_id: i64, name: String, caption: String, visibility: String, bytes: i64) -> Result<i64, String> {
    if bytes <= 0 || bytes > MAX_BYTES { return Err("Choose an MP4 video up to 50 MB".into()); }
    if !name.to_lowercase().ends_with(".mp4") || name.len() > 255 { return Err("Choose an MP4 video".into()); }
    if caption.trim().is_empty() || caption.chars().count() > 2200 { return Err("Enter a caption up to 2200 characters".into()); }
    if visibility != "private" && visibility != "public" { return Err("Choose Only you or Everyone".into()); }
    let conn = db.conn();
    let platform: String = conn.query_row("SELECT platform FROM accounts WHERE id = ?1", [account_id], |r| r.get(0)).map_err(|e| e.to_string())?;
    if platform != "tiktok" { return Err("Posting supports TikTok accounts".into()); }
    conn.execute("INSERT INTO posts(account_id, name, caption, visibility, bytes, status) VALUES (?1, ?2, ?3, ?4, ?5, 'uploading')", params![account_id, name, caption.trim(), visibility, bytes]).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command(async)]
pub fn upload_post_chunk(db: State<'_, Db>, media: State<'_, Media>, id: i64, offset: u64, data: Vec<u8>) -> Result<(), String> {
    append_chunk(&db, &media, id, offset, data)
}

fn append_chunk(db: &Db, media: &Media, id: i64, offset: u64, data: Vec<u8>) -> Result<(), String> {
    if data.is_empty() || data.len() > 128 * 1024 { return Err("Invalid video chunk".into()); }
    let _lock = media.writes.lock().map_err(|e| e.to_string())?;
    let post = db.post(id)?;
    if post.status != "uploading" { return Err("This video upload is closed".into()); }
    let path = media.path(id);
    let length = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if length != offset || offset + data.len() as u64 > post.bytes as u64 { return Err("Video upload offset or size mismatch".into()); }
    let mut file = OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
    file.write_all(&data).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn finish_post_upload(db: State<'_, Db>, media: State<'_, Media>, id: i64) -> Result<(), String> {
    finish_upload(&db, &media, id)
}

fn finish_upload(db: &Db, media: &Media, id: i64) -> Result<(), String> {
    let _lock = media.writes.lock().map_err(|e| e.to_string())?;
    let post = db.post(id)?;
    if post.status != "uploading" { return Err("This video upload is closed".into()); }
    let data = fs::read(media.path(id)).map_err(|e| e.to_string())?;
    if data.len() as i64 != post.bytes || data.get(4..8) != Some(b"ftyp") { return Err("The upload is incomplete or is not an MP4 video".into()); }
    db.post_status(id, "draft", None)
}

#[tauri::command(async)]
pub fn delete_post(db: State<'_, Db>, media: State<'_, Media>, id: i64) -> Result<(), String> {
    let _lock = media.writes.lock().map_err(|e| e.to_string())?;
    let conn = db.conn();
    let changed = conn.execute("DELETE FROM posts WHERE id = ?1 AND status IN ('draft', 'uploading', 'failed', 'ready')", [id]).map_err(|e| e.to_string())?;
    if changed == 0 { return Err("This post cannot be deleted while publishing or after submission".into()); }
    let _ = fs::remove_file(media.path(id));
    Ok(())
}

#[tauri::command]
pub async fn prepare_post(app: AppHandle, id: i64) -> Result<(), String> {
    let db = app.state::<Db>();
    let post = db.post(id)?;
    db.claim_post(id, &["draft", "failed", "ready"], "preparing")?;
    let path = app.state::<Media>().path(id);
    let result = crate::execute_job(&app, post.serial, serde_json::json!({ "action": "prepare_post", "platform": "tiktok", "username": post.username, "postId": id, "filePath": path, "caption": post.caption, "visibility": post.visibility })).await;
    match result {
        Ok(_) => db.post_status(id, "ready", None),
        Err(e) => { db.post_status(id, "failed", Some(&e))?; Err(e) }
    }
}

#[tauri::command]
pub async fn publish_post(app: AppHandle, id: i64) -> Result<(), String> {
    let db = app.state::<Db>();
    let post = db.post(id)?;
    db.check_hold(&post.serial)?;
    db.claim_post(id, &["ready"], "publishing")?;
    let result = crate::execute_job(&app, post.serial, serde_json::json!({ "action": "publish_post", "postId": id })).await;
    match result {
        Ok(_) => db.post_status(id, "submitted", None),
        Err(e) => { db.post_status(id, "uncertain", Some(&e))?; Err(e) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::AccountEvent;
    fn account(db: &Db) -> i64 {
        db.upsert_account("phone", "tiktok", "one", AccountEvent::Seen).unwrap();
        db.accounts(None).unwrap()[0].id
    }
    fn draft(db: &Db, account_id: i64) -> i64 {
        create_draft(db, account_id, "clip.mp4".into(), "Caption #test".into(), "private".into(), 12).unwrap()
    }
    #[test]
    fn saves_real_upload_chunks_and_rejects_incomplete_or_reordered_data() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let id = draft(&db, account(&db));
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("sma-upload-{}-{stamp}", std::process::id()));
        let media = Media::new(dir.clone()).unwrap();
        assert!(append_chunk(&db, &media, id, 1, vec![0]).is_err());
        append_chunk(&db, &media, id, 0, b"\0\0\0\x0cftyp".to_vec()).unwrap();
        assert!(finish_upload(&db, &media, id).is_err());
        assert!(append_chunk(&db, &media, id, 0, vec![0]).is_err());
        append_chunk(&db, &media, id, 8, b"isom".to_vec()).unwrap();
        finish_upload(&db, &media, id).unwrap();
        assert_eq!(db.post(id).unwrap().status, "draft");
        assert_eq!(fs::read(media.path(id)).unwrap(), b"\0\0\0\x0cftypisom");
        assert!(append_chunk(&db, &media, id, 12, vec![0]).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn restart_preserves_uncertainty_instead_of_retrying_a_publish() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("sma-post-recovery-{}-{stamp}.db", std::process::id()));
        let db = Db::open(&path).unwrap();
        let aid = account(&db);
        let ready = draft(&db, aid);
        let publishing = draft(&db, aid);
        db.post_status(ready, "ready", None).unwrap();
        db.post_status(publishing, "publishing", None).unwrap();
        drop(db);
        let reopened = Db::open(&path).unwrap();
        assert_eq!(reopened.post(ready).unwrap().status, "failed");
        assert_eq!(reopened.post(publishing).unwrap().status, "uncertain");
        assert!(reopened.claim_post(publishing, &["ready"], "publishing").is_err());
        drop(reopened);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn prevents_duplicate_publish_and_two_posts_occupying_one_phone() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        let aid = account(&db);
        let one = draft(&db, aid);
        let two = draft(&db, aid);
        db.post_status(one, "draft", None).unwrap();
        db.post_status(two, "draft", None).unwrap();
        db.claim_post(one, &["draft"], "preparing").unwrap();
        assert!(db.claim_post(two, &["draft"], "preparing").is_err());
        db.post_status(one, "ready", None).unwrap();
        db.claim_post(two, &["draft"], "preparing").unwrap();
        assert_eq!(db.post(one).unwrap().status, "draft");
        db.post_status(two, "ready", None).unwrap();
        db.claim_post(two, &["ready"], "publishing").unwrap();
        assert!(db.claim_post(two, &["ready"], "publishing").is_err());
        db.post_status(two, "submitted", None).unwrap();
        assert!(db.claim_post(two, &["draft", "ready", "failed"], "preparing").is_err());
        assert!(create_draft(&db, aid, "image.png".into(), "Caption".into(), "public".into(), 12).is_err());
    }
}
