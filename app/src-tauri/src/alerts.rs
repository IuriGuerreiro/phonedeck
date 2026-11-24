//! Screens that stopped a job. An open alert holds its whole phone: no job runs there
//! until a person has looked and resolved it.
use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;
use tauri::{ipc::Response, AppHandle, Emitter, Manager, State};

use crate::db::Db;

pub const KINDS: [&str; 5] = ["captcha", "logged_out", "account_warning", "popup", "unknown"];
pub const HOLD: &str = "Phone on hold";

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    id: i64,
    kind: String,
    /// What the user said it was.
    label: Option<String>,
    serial: String,
    username: Option<String>,
    account_id: Option<i64>,
    action: String,
    message: String,
    has_screenshot: bool,
    created_at: String,
    resolved_at: Option<String>,
}

fn s(e: impl ToString) -> String {
    e.to_string()
}

impl Db {
    pub fn add_alert(&self, a: &Value) -> Result<i64, String> {
        let kind = a["kind"].as_str().filter(|k| KINDS.contains(k)).unwrap_or("unknown");
        let conn = self.conn();
        conn.execute(
            "INSERT INTO alerts (kind, serial, platform, username, action, message, dir, details)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                kind,
                a["serial"].as_str().ok_or("alert without a phone")?,
                a["platform"].as_str(),
                a["username"].as_str(),
                a["action"].as_str().unwrap_or(""),
                a["message"].as_str().unwrap_or(""),
                a["dir"].as_str(),
                a.to_string(),
            ],
        )
        .map_err(s)?;
        Ok(conn.last_insert_rowid())
    }

    /// Errors while the phone has an open alert.
    pub fn check_hold(&self, serial: &str) -> Result<(), String> {
        let open: bool = self
            .conn()
            .query_row("SELECT EXISTS (SELECT 1 FROM alerts WHERE serial = ?1 AND resolved_at IS NULL)", [serial], |r| r.get(0))
            .map_err(s)?;
        if open {
            return Err(format!("{HOLD}: check it, then resolve its alert on the Alerts page."));
        }
        Ok(())
    }

    /// Every open alert, plus the latest resolved ones.
    pub fn alerts(&self) -> Result<Vec<Alert>, String> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare(
                "SELECT l.id, l.kind, l.label, l.serial, l.username, a.id, l.action, l.message, l.dir, l.created_at, l.resolved_at
                 FROM alerts l LEFT JOIN accounts a
                   ON a.serial = l.serial AND a.platform = l.platform AND a.username = l.username
                 WHERE l.resolved_at IS NULL
                    OR l.id IN (SELECT id FROM alerts WHERE resolved_at IS NOT NULL ORDER BY id DESC LIMIT 100)
                 ORDER BY l.id DESC",
            )
            .map_err(s)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Alert {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    label: r.get(2)?,
                    serial: r.get(3)?,
                    username: r.get(4)?,
                    account_id: r.get(5)?,
                    action: r.get(6)?,
                    message: r.get(7)?,
                    has_screenshot: r.get::<_, Option<String>>(8)?.is_some_and(|d| PathBuf::from(d).join("screen.png").is_file()),
                    created_at: r.get(9)?,
                    resolved_at: r.get(10)?,
                })
            })
            .map_err(s)?;
        rows.collect::<rusqlite::Result<_>>().map_err(s)
    }

    /// Also clears the account's "needs attention", unless it has another open alert.
    pub fn resolve_alert(&self, id: i64) -> Result<(), String> {
        let mut conn = self.conn();
        let tx = conn.transaction().map_err(s)?;
        tx.execute(
            "UPDATE alerts SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1 AND resolved_at IS NULL",
            [id],
        )
        .map_err(s)?;
        tx.execute(
            "UPDATE accounts SET status = 'ok', note = NULL WHERE EXISTS (
                SELECT 1 FROM alerts l WHERE l.id = ?1 AND l.serial = accounts.serial
                  AND l.platform = accounts.platform AND l.username = accounts.username)
             AND NOT EXISTS (
                SELECT 1 FROM alerts o WHERE o.resolved_at IS NULL AND o.serial = accounts.serial
                  AND o.platform = accounts.platform AND o.username = accounts.username)",
            [id],
        )
        .map_err(s)?;
        tx.commit().map_err(s)
    }

    pub fn label_alert(&self, id: i64, label: &str) -> Result<(), String> {
        if label != "false_alarm" && !KINDS.contains(&label) {
            return Err("Unknown label".into());
        }
        self.conn().execute("UPDATE alerts SET label = ?2 WHERE id = ?1", rusqlite::params![id, label]).map_err(s)?;
        Ok(())
    }

    fn alert_dir(&self, id: i64) -> Result<Option<String>, String> {
        self.conn().query_row("SELECT dir FROM alerts WHERE id = ?1", [id], |r| r.get(0)).map_err(s)
    }
}

/// A worker's "blocked" event. It arrives before the job's own reply.
pub fn record(app: &AppHandle, msg: &Value) {
    match app.state::<Db>().add_alert(msg) {
        Ok(id) => {
            let _ = app.emit("alert", id);
        }
        Err(e) => eprintln!("[alerts] {e}"),
    }
}

pub fn screenshot_bytes(db: &Db, id: i64) -> Result<Vec<u8>, String> {
    let dir = db.alert_dir(id)?.ok_or("No screenshot was saved")?;
    std::fs::read(PathBuf::from(dir).join("screen.png")).map_err(s)
}

#[tauri::command(async)]
pub fn list_alerts(db: State<'_, Db>) -> Result<Vec<Alert>, String> {
    db.alerts()
}

#[tauri::command(async)]
pub fn resolve_alert(db: State<'_, Db>, id: i64) -> Result<(), String> {
    db.resolve_alert(id)
}

#[tauri::command(async)]
pub fn label_alert(db: State<'_, Db>, id: i64, label: String) -> Result<(), String> {
    db.label_alert(id, &label)
}

#[tauri::command(async)]
pub fn alert_screenshot(db: State<'_, Db>, id: i64) -> Result<Response, String> {
    screenshot_bytes(&db, id).map(Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::AccountEvent;
    use serde_json::json;

    #[test]
    fn alerts_hold_the_phone_until_resolved() {
        let db = Db::open(std::path::Path::new(":memory:")).unwrap();
        db.upsert_account("A", "tiktok", "ana", AccountEvent::NeedsAttention("x")).unwrap();
        let alert = json!({ "serial": "A", "kind": "captcha", "platform": "tiktok", "username": "ana", "action": "warmup", "message": "m" });
        let one = db.add_alert(&alert).unwrap();
        let two = db.add_alert(&alert).unwrap();
        assert!(db.check_hold("A").unwrap_err().starts_with(HOLD));
        assert!(db.check_hold("B").is_ok());

        db.resolve_alert(one).unwrap();
        assert!(db.check_hold("A").is_err());
        assert_eq!(db.accounts(None).unwrap()[0].status, "needs_attention");
        db.resolve_alert(two).unwrap();
        assert!(db.check_hold("A").is_ok());
        assert_eq!(db.accounts(None).unwrap()[0].status, "ok");

        db.label_alert(one, "false_alarm").unwrap();
        assert!(db.label_alert(one, "nope").is_err());
        let all = db.alerts().unwrap();
        assert_eq!((all.len(), all[1].label.as_deref()), (2, Some("false_alarm")));
        assert!(all[0].account_id.is_some() && !all[0].has_screenshot);
        // Unknown kinds and missing fields still hold the phone.
        db.add_alert(&json!({ "serial": "B", "kind": "??" })).unwrap();
        assert!(db.check_hold("B").is_err());
    }
}
