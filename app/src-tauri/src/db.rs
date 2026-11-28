//! SQLite storage. One file in the app data folder.
use std::{path::Path, sync::Mutex};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSnapshot {
    pub account_id: i64,
    pub captured_at: String,
    pub followers: i64,
    pub following: i64,
    pub likes: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: i64,
    pub name: String,
    pub keywords: Vec<String>,
    pub account_ids: Vec<i64>,
}

pub struct Db(Mutex<Connection>);

/// Each entry runs once, in order. Append new migrations; never edit old ones.
const MIGRATIONS: &[&str] = &[r#"
    CREATE TABLE devices (
        serial     TEXT PRIMARY KEY,
        name       TEXT,
        model      TEXT,
        first_seen TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE job_runs (
        id          INTEGER PRIMARY KEY,
        serial      TEXT NOT NULL,
        action      TEXT NOT NULL,
        payload     TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
        result      TEXT,
        error       TEXT,
        started_at  TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT
    );
    CREATE INDEX job_runs_started ON job_runs (started_at DESC);
"#, r#"
    CREATE TABLE accounts (
        id             INTEGER PRIMARY KEY,
        serial         TEXT NOT NULL,
        platform       TEXT NOT NULL,
        username       TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'needs_attention')),
        note           TEXT,
        last_warmup_at TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (serial, platform, username)
    );
"#, r#"
    CREATE TABLE account_snapshots (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL,
        captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        followers INTEGER NOT NULL CHECK(followers >= 0),
        following INTEGER NOT NULL CHECK(following >= 0),
        likes INTEGER NOT NULL CHECK(likes >= 0)
    );
    CREATE INDEX account_snapshots_account ON account_snapshots(account_id, id);
"#, r#"
    CREATE TABLE account_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) > 0),
        keywords TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE account_group_members (
        group_id INTEGER NOT NULL REFERENCES account_groups(id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        PRIMARY KEY(group_id, account_id)
    );
"#, r#"
    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
"#, r#"
    CREATE TABLE schedules (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        enabled    INTEGER NOT NULL DEFAULT 1,
        -- NULL = all accounts. Not a foreign key: a deleted group disables the schedule (below).
        group_id   INTEGER,
        days       INTEGER NOT NULL,          -- bit 0 = Sunday ... bit 6 = Saturday
        times      TEXT NOT NULL,             -- JSON ["09:00", ...]
        minutes    INTEGER NOT NULL,
        jitter_min INTEGER NOT NULL DEFAULT 0
    );
    -- Never silently widen a group schedule to every account.
    CREATE TRIGGER schedules_group_deleted AFTER DELETE ON account_groups BEGIN
        UPDATE schedules SET enabled = 0 WHERE group_id = OLD.id;
    END;
    CREATE TABLE schedule_runs (
        id          INTEGER PRIMARY KEY,
        schedule_id INTEGER NOT NULL,
        slot        TEXT NOT NULL,
        status      TEXT NOT NULL,            -- running | done | skipped | stopped
        results     TEXT,
        started_at  TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        UNIQUE (schedule_id, slot)
    );
"#, r#"
    CREATE TABLE video_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        measurements TEXT NOT NULL
    );
    CREATE INDEX video_readings_account ON video_readings(account_id, id);
"#, r#"
    CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        caption TEXT NOT NULL,
        visibility TEXT NOT NULL CHECK(visibility IN ('private', 'public')),
        bytes INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('uploading', 'draft', 'preparing', 'ready', 'publishing', 'submitted', 'failed', 'uncertain')),
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
"#, r#"
    CREATE TABLE alerts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kind        TEXT NOT NULL,
        label       TEXT,                     -- what the user said it was
        serial      TEXT NOT NULL,
        platform    TEXT,
        username    TEXT,
        action      TEXT NOT NULL,
        message     TEXT NOT NULL,
        dir         TEXT,                     -- folder with screen.png, screen.xml, info.json
        details     TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        resolved_at TEXT
    );
    CREATE INDEX alerts_open ON alerts(serial) WHERE resolved_at IS NULL;
"#];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownDevice {
    pub serial: String,
    pub name: Option<String>,
    pub model: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRun {
    pub id: i64,
    pub serial: String,
    pub action: String,
    pub status: String,
    pub error: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: i64,
    pub serial: String,
    pub platform: String,
    pub username: String,
    pub status: String,
    pub note: Option<String>,
    pub last_warmup_at: Option<String>,
    /// Last 7 days. A captcha counts as the user labelled it, else as guessed.
    pub captchas_7d: u32,
    /// Failed jobs in the last 7 days that say something about the account: not PC or
    /// connection trouble, and not stops that became an alert.
    pub errors_7d: u32,
}

/// Warm-up minutes on one local day, all accounts.
#[derive(Serialize, Debug, PartialEq)]
pub struct DayMinutes {
    /// "YYYY-MM-DD"
    pub date: String,
    pub minutes: u32,
}

/// What a finished job means for an account's row.
pub enum AccountEvent<'a> {
    Seen,
    WarmedUp,
    NeedsAttention(&'a str),
}

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let mut conn = Connection::open(path)?;
        // Wait for a lock instead of failing, e.g. while a previous instance is closing.
        conn.busy_timeout(std::time::Duration::from_secs(15))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", true)?;
        migrate(&mut conn)?;
        // Scheduled runs cut off the same way.
        conn.execute(
            "UPDATE schedule_runs SET status = 'stopped', finished_at = datetime('now') WHERE status = 'running'",
            [],
        )?;
        // Runs left 'running' by a crash or forced quit can never finish now.
        conn.execute(
            "UPDATE job_runs SET status = 'error', error = 'App closed before the job finished',
             finished_at = datetime('now') WHERE status = 'running'",
            [],
        )?;
        conn.execute("UPDATE posts SET status = 'failed', error = 'App closed during preparation. Prepare this draft again.' WHERE status IN ('preparing', 'ready')", [])?;
        conn.execute("UPDATE posts SET status = 'uncertain', error = 'App closed while publishing. Check TikTok before posting again.' WHERE status = 'publishing'", [])?;
        Ok(Self(Mutex::new(conn)))
    }

    pub(crate) fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        // A panic while holding the lock leaves the connection usable; keep going.
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn groups(&self) -> Result<Vec<Group>, String> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT id, name, keywords FROM account_groups ORDER BY id").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))).map_err(|e| e.to_string())?;
        let mut groups = Vec::new();
        for row in rows {
            let (id, name, keywords) = row.map_err(|e| e.to_string())?;
            let mut members = conn.prepare("SELECT account_id FROM account_group_members WHERE group_id = ?1 ORDER BY account_id").map_err(|e| e.to_string())?;
            let account_ids = members.query_map([id], |r| r.get(0)).map_err(|e| e.to_string())?.collect::<rusqlite::Result<Vec<i64>>>().map_err(|e| e.to_string())?;
            groups.push(Group { id, name, keywords: serde_json::from_str(&keywords).map_err(|e| e.to_string())?, account_ids });
        }
        Ok(groups)
    }

    pub fn save_group(&self, id: Option<i64>, name: &str, keywords: Vec<String>) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() { return Err("Group name is required".into()); }
        let mut clean = Vec::new();
        for word in keywords {
            let word = word.trim();
            if !word.is_empty() && !clean.iter().any(|k: &String| k.eq_ignore_ascii_case(word)) { clean.push(word.to_string()); }
        }
        let keywords = serde_json::to_string(&clean).map_err(|e| e.to_string())?;
        let conn = self.conn();
        let result = match id {
            Some(id) => conn.execute("UPDATE account_groups SET name = ?2, keywords = ?3 WHERE id = ?1", params![id, name, keywords]),
            None => conn.execute("INSERT INTO account_groups(name, keywords) VALUES (?1, ?2)", params![name, keywords]),
        }.map_err(|e| if matches!(e, rusqlite::Error::SqliteFailure(ref code, _) if code.extended_code == 2067) { "A group with this name already exists".into() } else { e.to_string() })?;
        if result == 0 { return Err("Group no longer exists".into()); }
        Ok(())
    }

    pub fn delete_group(&self, id: i64) -> Result<(), String> {
        self.conn().execute("DELETE FROM account_groups WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn set_group_member(&self, group_id: i64, account_id: i64, member: bool) -> Result<(), String> {
        let conn = self.conn();
        if member {
            conn.execute("INSERT OR IGNORE INTO account_group_members(group_id, account_id) VALUES (?1, ?2)", params![group_id, account_id])
        } else {
            conn.execute("DELETE FROM account_group_members WHERE group_id = ?1 AND account_id = ?2", params![group_id, account_id])
        }.map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn apply_group_keywords(&self, serial: &str, job: &mut serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
        if job.get("action").and_then(|v| v.as_str()) != Some("warmup") { return Ok(()); }
        let Some(username) = job.get("username").and_then(|v| v.as_str()) else { return Ok(()); };
        let platform = job.get("platform").and_then(|v| v.as_str()).unwrap_or("");
        let accounts = self.accounts(Some(serial)).map_err(|e| e.to_string())?;
        let Some(account) = accounts.iter().find(|a| a.username == username && a.platform == platform) else { return Ok(()); };
        let mut keywords = Vec::new();
        for group in self.groups()?.into_iter().filter(|g| g.account_ids.contains(&account.id)) {
            for word in group.keywords {
                if !keywords.iter().any(|k: &String| k.eq_ignore_ascii_case(&word)) { keywords.push(word); }
            }
        }
        if !keywords.is_empty() { job.insert("keywords".into(), serde_json::json!(keywords)); }
        Ok(())
    }

    /// Safety limits; defaults until saved.
    pub fn safety(&self) -> Result<crate::safety::Safety, String> {
        let v: Option<String> = self
            .conn()
            .query_row("SELECT value FROM settings WHERE key = 'safety'", [], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(v.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default())
    }

    pub fn set_safety(&self, s: &crate::safety::Safety) -> Result<(), String> {
        let json = serde_json::to_string(s).map_err(|e| e.to_string())?;
        self.conn()
            .execute(
                "INSERT INTO settings (key, value) VALUES ('safety', ?1)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                [json],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// "HH:MM" in this PC's time zone.
    pub fn local_time(&self) -> Result<String, String> {
        self.conn()
            .query_row("SELECT strftime('%H:%M', 'now', 'localtime')", [], |r| r.get(0))
            .map_err(|e| e.to_string())
    }

    /// Likes, follows and minutes from this account's finished warm-ups today (local day).
    pub fn usage_today(&self, serial: &str, username: &str) -> Result<crate::safety::Usage, String> {
        self.conn()
            .query_row(
                "SELECT COALESCE(SUM(json_extract(result, '$.likes')), 0),
                        COALESCE(SUM(json_extract(result, '$.follows')), 0),
                        COALESCE(SUM((julianday(finished_at) - julianday(started_at)) * 1440), 0)
                 FROM job_runs
                 WHERE serial = ?1 AND action = 'warmup' AND finished_at IS NOT NULL
                   AND json_extract(payload, '$.username') = ?2
                   AND date(started_at, 'localtime') = date('now', 'localtime')",
                params![serial, username],
                |r| {
                    Ok(crate::safety::Usage {
                        likes: r.get::<_, i64>(0)?.max(0) as u32,
                        follows: r.get::<_, i64>(1)?.max(0) as u32,
                        minutes: r.get::<_, f64>(2)?.max(0.0).round() as u32,
                    })
                },
            )
            .map_err(|e| e.to_string())
    }

    /// Warm-up minutes for each of the last `days` local days, oldest first, empty days included.
    /// A run never counts for more than it was asked to last: one cut off by closing the app
    /// is only marked finished the next time the app opens.
    pub fn warmup_days(&self, days: u32) -> Result<Vec<DayMinutes>, String> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare(
                "WITH RECURSIVE d(n) AS (SELECT ?1 - 1 UNION ALL SELECT n - 1 FROM d WHERE n > 0),
                 runs AS (
                   SELECT date(started_at, 'localtime') AS day,
                          MAX(0, MIN((julianday(finished_at) - julianday(started_at)) * 1440,
                                     COALESCE(json_extract(payload, '$.minutes'), 10) + 3)) AS minutes
                   FROM job_runs WHERE action = 'warmup' AND finished_at IS NOT NULL
                     AND COALESCE(error, '') NOT LIKE 'App closed before%'
                     AND started_at > datetime('now', '-' || (?1 + 1) || ' days'))
                 SELECT date('now', 'localtime', '-' || n || ' days') AS day,
                        (SELECT COALESCE(SUM(minutes), 0) FROM runs WHERE runs.day = date('now', 'localtime', '-' || n || ' days'))
                 FROM d ORDER BY n DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([days.clamp(1, 90)], |r| Ok(DayMinutes { date: r.get(0)?, minutes: r.get::<_, f64>(1)?.round() as u32 }))
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
    }

    #[cfg(test)]
    pub fn backdate_run_start(&self, id: i64, minutes: i64) -> rusqlite::Result<()> {
        self.conn().execute(
            "UPDATE job_runs SET started_at = datetime(finished_at, ?2) WHERE id = ?1",
            params![id, format!("-{minutes} minutes")],
        )?;
        Ok(())
    }

    pub fn touch_device(&self, serial: &str, model: Option<&str>) -> rusqlite::Result<()> {
        self.conn().execute(
            "INSERT INTO devices (serial, model) VALUES (?1, ?2)
             ON CONFLICT (serial) DO UPDATE SET
               model = COALESCE(excluded.model, devices.model),
               last_seen = datetime('now')
             -- Polled every few seconds: skip the write unless something changed.
             WHERE (excluded.model IS NOT NULL AND devices.model IS NOT excluded.model)
                OR devices.last_seen < datetime('now', '-1 minute')",
            params![serial, model],
        )?;
        Ok(())
    }

    pub fn known_devices(&self) -> rusqlite::Result<Vec<KnownDevice>> {
        let conn = self.conn();
        let mut stmt =
            conn.prepare("SELECT serial, name, model FROM devices ORDER BY first_seen")?;
        let rows = stmt.query_map([], |r| {
            Ok(KnownDevice { serial: r.get(0)?, name: r.get(1)?, model: r.get(2)? })
        })?;
        rows.collect()
    }

    pub fn rename_device(&self, serial: &str, name: Option<&str>) -> rusqlite::Result<()> {
        self.conn()
            .execute("UPDATE devices SET name = ?2 WHERE serial = ?1", params![serial, name])?;
        Ok(())
    }

    pub fn upsert_account(
        &self,
        serial: &str,
        platform: &str,
        username: &str,
        event: AccountEvent,
    ) -> rusqlite::Result<()> {
        let (status, note, warmed) = match event {
            AccountEvent::Seen => ("ok", None, false),
            AccountEvent::WarmedUp => ("ok", None, true),
            AccountEvent::NeedsAttention(note) => ("needs_attention", Some(note), false),
        };
        self.conn().execute(
            "INSERT INTO accounts (serial, platform, username, status, note, last_warmup_at)
             VALUES (?1, ?2, ?3, ?4, ?5, CASE WHEN ?6 THEN datetime('now') END)
             ON CONFLICT (serial, platform, username) DO UPDATE SET
               status = excluded.status,
               note = excluded.note,
               last_warmup_at = COALESCE(excluded.last_warmup_at, accounts.last_warmup_at)",
            params![serial, platform, username, status, note, warmed],
        )?;
        Ok(())
    }

    /// `None` lists the accounts on every phone.
    pub fn accounts(&self, serial: Option<&str>) -> rusqlite::Result<Vec<Account>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, serial, platform, username, status, note, last_warmup_at,
               (SELECT count(*) FROM alerts l
                 WHERE l.serial = accounts.serial AND l.platform = accounts.platform AND l.username = accounts.username
                   AND COALESCE(l.label, l.kind) = 'captcha'
                   AND julianday(l.created_at) > julianday('now', '-7 days')),
               (SELECT count(*) FROM job_runs r
                 WHERE r.serial = accounts.serial AND r.status = 'error'
                   AND r.started_at > datetime('now', '-7 days')
                   AND json_extract(r.payload, '$.platform') = accounts.platform
                   AND json_extract(r.payload, '$.username') = accounts.username
                   AND r.error NOT LIKE '%App closed before%' AND r.error NOT LIKE '%Worker stopped%'
                   AND r.error NOT LIKE '%Could not reach worker%' AND r.error NOT LIKE '%engine is not ready%'
                   AND r.error NOT LIKE '%Unable to connect to%' AND r.error NOT LIKE '%WebDriverError%'
                   AND r.error NOT LIKE '%Phone on hold%' AND r.error NOT LIKE '%Could not copy the video%'
                   AND r.error NOT LIKE '%adb: device%' AND r.error NOT LIKE '%was not in the list of connected devices%'
                   AND NOT EXISTS (SELECT 1 FROM alerts l WHERE l.serial = r.serial
                     AND l.message != '' AND instr(r.error, l.message) > 0
                     AND julianday(l.created_at) >= julianday(r.started_at)
                     AND julianday(l.created_at) <= julianday(COALESCE(r.finished_at, 'now'), '+2 seconds')))
             FROM accounts WHERE ?1 IS NULL OR serial = ?1
             ORDER BY platform, username COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([serial], |r| {
            Ok(Account {
                id: r.get(0)?,
                serial: r.get(1)?,
                platform: r.get(2)?,
                username: r.get(3)?,
                status: r.get(4)?,
                note: r.get(5)?,
                last_warmup_at: r.get(6)?,
                captchas_7d: r.get(7)?,
                errors_7d: r.get(8)?,
            })
        })?;
        rows.collect()
    }

    pub fn save_account_snapshot(&self, serial: &str, platform: &str, username: &str, followers: i64, following: i64, likes: i64) -> rusqlite::Result<()> {
        self.conn().execute("INSERT INTO account_snapshots(account_id, followers, following, likes)
            SELECT id, ?4, ?5, ?6 FROM accounts WHERE serial = ?1 AND platform = ?2 AND username = ?3",
            params![serial, platform, username, followers, following, likes])?;
        Ok(())
    }

    pub fn account_snapshots(&self) -> rusqlite::Result<Vec<AccountSnapshot>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT s.account_id, s.captured_at, s.followers, s.following, s.likes FROM account_snapshots s JOIN accounts a ON a.id = s.account_id ORDER BY s.id")?;
        let rows = stmt.query_map([], |r| Ok(AccountSnapshot { account_id: r.get(0)?, captured_at: r.get(1)?, followers: r.get(2)?, following: r.get(3)?, likes: r.get(4)? }))?;
        rows.collect()
    }

    pub fn delete_account(&self, id: i64) -> rusqlite::Result<()> {
        self.conn().execute("DELETE FROM accounts WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn start_run(&self, serial: &str, action: &str, payload: &str) -> rusqlite::Result<i64> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO job_runs (serial, action, payload, status) VALUES (?1, ?2, ?3, 'running')",
            params![serial, action, payload],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn finish_run(&self, id: i64, outcome: &Result<String, String>) -> rusqlite::Result<()> {
        let (status, result, error) = match outcome {
            Ok(r) => ("ok", Some(r.as_str()), None),
            Err(e) => ("error", None, Some(e.as_str())),
        };
        self.conn().execute(
            "UPDATE job_runs SET status = ?2, result = ?3, error = ?4, finished_at = datetime('now')
             WHERE id = ?1",
            params![id, status, result, error],
        )?;
        Ok(())
    }

    pub fn recent_runs(&self, limit: u32) -> rusqlite::Result<Vec<JobRun>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, serial, action, status, error, started_at, finished_at
             FROM job_runs ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit], |r| {
            Ok(JobRun {
                id: r.get(0)?,
                serial: r.get(1)?,
                action: r.get(2)?,
                status: r.get(3)?,
                error: r.get(4)?,
                started_at: r.get(5)?,
                finished_at: r.get(6)?,
            })
        })?;
        rows.collect()
    }
}

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", i as i64 + 1)?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_persist_and_apply_only_to_assigned_accounts() {
        let path = std::env::temp_dir().join(format!("tapfleet-groups-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        db.upsert_account("A", "tiktok", "one", AccountEvent::Seen).unwrap();
        db.upsert_account("B", "tiktok", "one", AccountEvent::Seen).unwrap();
        let id = db.accounts(Some("A")).unwrap()[0].id;
        db.save_group(None, " Gym ", vec![" fitness ".into(), "FITNESS".into(), "".into()]).unwrap();
        db.save_group(None, "Food", vec!["fitness".into(), "recipes".into()]).unwrap();
        let groups = db.groups().unwrap();
        assert_eq!(groups[0].name, "Gym");
        assert_eq!(groups[0].keywords, vec!["fitness"]);
        assert!(db.save_group(None, "gym", vec![]).is_err());
        assert!(db.save_group(None, "   ", vec![]).is_err());
        for g in &groups { db.set_group_member(g.id, id, true).unwrap(); }
        db.set_group_member(groups[0].id, id, true).unwrap();
        db.upsert_account("A", "tiktok", "one", AccountEvent::Seen).unwrap();
        drop(db);
        let db = Db::open(&path).unwrap();
        assert_eq!(db.groups().unwrap()[0].account_ids, vec![id]);
        let make_job = || serde_json::json!({"action":"warmup", "platform":"tiktok", "username":"one", "keywords":["global"]}).as_object().unwrap().clone();
        let mut job = make_job();
        db.apply_group_keywords("A", &mut job).unwrap();
        assert_eq!(job["keywords"], serde_json::json!(["fitness", "recipes"]));
        let mut other_phone = make_job();
        db.apply_group_keywords("B", &mut other_phone).unwrap();
        assert_eq!(other_phone["keywords"], serde_json::json!(["global"]));
        db.save_group(Some(groups[0].id), "Renamed", vec![]).unwrap();
        db.delete_group(groups[1].id).unwrap();
        let mut fallback = make_job();
        db.apply_group_keywords("A", &mut fallback).unwrap();
        assert_eq!(fallback["keywords"], serde_json::json!(["global"]));
        assert_eq!(db.accounts(None).unwrap().len(), 2);
        db.set_group_member(groups[0].id, id, false).unwrap();
        assert!(db.groups().unwrap()[0].account_ids.is_empty());
        assert!(db.set_group_member(groups[1].id, id, true).is_err());
        db.set_group_member(groups[0].id, id, true).unwrap();
        db.delete_account(id).unwrap();
        assert!(db.groups().unwrap()[0].account_ids.is_empty());
        drop(db);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn groups_migration_preserves_existing_accounts() {
        let mut conn = Connection::open_in_memory().unwrap();
        for sql in &MIGRATIONS[..3] { conn.execute_batch(sql).unwrap(); }
        conn.pragma_update(None, "user_version", 3).unwrap();
        conn.execute("INSERT INTO accounts(serial, platform, username) VALUES ('A','tiktok','existing')", []).unwrap();
        migrate(&mut conn).unwrap();
        migrate(&mut conn).unwrap();
        let count: i64 = conn.query_row("SELECT count(*) FROM accounts", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        let count: i64 = conn.query_row("SELECT count(*) FROM account_groups", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn snapshots_persist_and_belong_to_the_account() {
        let db = Db::open(Path::new(":memory:")).unwrap();
        db.upsert_account("A", "tiktok", "one", AccountEvent::Seen).unwrap();
        db.upsert_account("B", "tiktok", "two", AccountEvent::Seen).unwrap();
        db.save_account_snapshot("A", "tiktok", "one", 10, 3, 100).unwrap();
        db.save_account_snapshot("A", "tiktok", "one", 12, 4, 105).unwrap();
        let rows = db.account_snapshots().unwrap();
        let account = db.accounts(Some("A")).unwrap().remove(0);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].account_id, account.id);
        assert_eq!(rows[0].followers, 10);
        assert_eq!(rows[1].followers, 12);
        assert_eq!(rows[1].following, 4);
        assert_eq!(rows[1].likes, 105);
        assert!(rows[0].captured_at.ends_with('Z'));
        assert!(db.save_account_snapshot("A", "tiktok", "one", -1, 0, 0).is_err());
        db.delete_account(account.id).unwrap();
        assert!(db.account_snapshots().unwrap().is_empty());
    }

    #[test]
    fn counts_warmup_minutes_per_day() {
        let db = Db::open(Path::new(":memory:")).unwrap();
        let run = |minutes: i64, error: Option<&str>| {
            let id = db.start_run("A", "warmup", r#"{"username":"ana","minutes":10}"#).unwrap();
            db.finish_run(id, &error.map_or(Ok("{}".into()), |e| Err(e.into()))).unwrap();
            db.backdate_run_start(id, minutes).unwrap();
            id
        };
        run(0, None);
        // Finished late: capped. Cut off by closing the app: unknown, so not counted.
        let late = run(0, None);
        db.conn().execute("UPDATE job_runs SET finished_at = datetime('now', '+20 hours') WHERE id = ?1", [late]).unwrap();
        let cut = run(0, Some("App closed before the job finished"));
        db.conn().execute("UPDATE job_runs SET finished_at = datetime('now', '+20 hours') WHERE id = ?1", [cut]).unwrap();
        let old = run(0, None);
        db.conn().execute("UPDATE job_runs SET started_at = datetime('now', '-3 days'), finished_at = datetime('now', '-3 days', '+5 minutes') WHERE id = ?1", [old]).unwrap();
        let days = db.warmup_days(7).unwrap();
        assert_eq!(days.len(), 7);
        assert_eq!(days.iter().map(|d| d.minutes).collect::<Vec<_>>(), vec![0, 0, 0, 5, 0, 0, 13]);
        assert!(days.windows(2).all(|w| w[0].date < w[1].date));
    }

    #[test]
    fn counts_captchas_and_failures_per_account() {
        let db = Db::open(Path::new(":memory:")).unwrap();
        db.upsert_account("A", "tiktok", "ana", AccountEvent::Seen).unwrap();
        db.upsert_account("A", "tiktok", "bob", AccountEvent::Seen).unwrap();
        let fail = |error: &str| {
            let id = db.start_run("A", "warmup", r#"{"platform":"tiktok","username":"ana"}"#).unwrap();
            db.finish_run(id, &Err(error.into())).unwrap();
        };
        let alert = |kind: &str, message: &str| {
            db.add_alert(&serde_json::json!({ "serial": "A", "platform": "tiktok", "username": "ana", "kind": kind, "message": message })).unwrap()
        };
        fail("@ana is not logged in");
        fail("App closed before the job finished");
        fail("Unable to connect to 127.0.0.1");
        alert("captcha", "Looks like a captcha");
        fail("Looks like a captcha");
        let wrong = alert("captcha", "other");
        db.label_alert(wrong, "false_alarm").unwrap();
        let relabelled = alert("unknown", "odd");
        db.label_alert(relabelled, "captcha").unwrap();
        let old = alert("captcha", "old");
        db.conn().execute("UPDATE alerts SET created_at = datetime('now', '-8 days') WHERE id = ?1", [old]).unwrap();
        let a = db.accounts(None).unwrap();
        assert_eq!((a[0].captchas_7d, a[0].errors_7d), (2, 1));
        assert_eq!((a[1].captchas_7d, a[1].errors_7d), (0, 0));
    }

    #[test]
    fn lists_accounts_for_one_phone_or_all() {
        let path = std::env::temp_dir().join(format!("tapfleet-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        db.upsert_account("A", "tiktok", "one", AccountEvent::Seen).unwrap();
        db.upsert_account("B", "tiktok", "two", AccountEvent::WarmedUp).unwrap();

        assert_eq!(db.accounts(None).unwrap().len(), 2);
        let b = db.accounts(Some("B")).unwrap();
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].username, "two");
        assert!(b[0].last_warmup_at.is_some());

        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
