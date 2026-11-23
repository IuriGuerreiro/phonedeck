//! SQLite storage. One file in the app data folder.
use std::{path::Path, sync::Mutex};

use rusqlite::{params, Connection};
use serde::Serialize;

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
        migrate(&mut conn)?;
        // Runs left 'running' by a crash or forced quit can never finish now.
        conn.execute(
            "UPDATE job_runs SET status = 'error', error = 'App closed before the job finished',
             finished_at = datetime('now') WHERE status = 'running'",
            [],
        )?;
        Ok(Self(Mutex::new(conn)))
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        // A panic while holding the lock leaves the connection usable; keep going.
        self.0.lock().unwrap_or_else(|e| e.into_inner())
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

    pub fn accounts(&self, serial: &str) -> rusqlite::Result<Vec<Account>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, serial, platform, username, status, note, last_warmup_at
             FROM accounts WHERE serial = ?1 ORDER BY platform, username COLLATE NOCASE",
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
            })
        })?;
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
