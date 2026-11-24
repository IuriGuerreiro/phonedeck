//! Scheduled warm-ups. A schedule names its target (all accounts or one group), days of
//! the week, start times, minutes per account and a random delay ("jitter").
//!
//! A background loop checks every 30s. When a slot is due it warms up every target
//! account: phones in parallel, accounts on one phone one after another. Each warm-up
//! goes through `execute_job`, so groups, safety limits and logging all apply.
//! Every slot runs at most once (`schedule_runs` has one row per slot), and only within
//! 30 minutes of its time: opening the app at 15:00 doesn't replay the 09:00 slot.
use std::{collections::HashSet, sync::Mutex, time::Duration};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::db::Db;

/// How late a slot may still start (minutes).
const GRACE_MIN: u32 = 30;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: Option<i64>,
    pub name: String,
    pub enabled: bool,
    /// None = every account.
    pub group_id: Option<i64>,
    /// 0 = Sunday … 6 = Saturday.
    pub days: Vec<u8>,
    /// "HH:MM", local time.
    pub times: Vec<String>,
    /// Warm-up length per account.
    pub minutes: u32,
    /// Start up to this many minutes after each time (random, fixed per day and slot).
    pub jitter_min: u32,
}

impl Schedule {
    /// Validated copy, or why it can't be saved.
    pub fn cleaned(mut self) -> Result<Self, String> {
        self.name = self.name.trim().to_string();
        if self.name.is_empty() {
            return Err("Give the schedule a name.".into());
        }
        self.days.retain(|d| *d < 7);
        self.days.sort_unstable();
        self.days.dedup();
        if self.days.is_empty() {
            return Err("Pick at least one day.".into());
        }
        let mut times = Vec::new();
        for t in &self.times {
            let m = parse_hm(t.trim()).ok_or_else(|| format!("\"{t}\" isn't a time like 09:30."))?;
            times.push(fmt_hm(m));
        }
        times.sort();
        times.dedup();
        if times.is_empty() {
            return Err("Add at least one start time.".into());
        }
        self.times = times;
        self.minutes = self.minutes.clamp(1, 120);
        self.jitter_min = self.jitter_min.min(120);
        Ok(self)
    }

    fn day_mask(&self) -> i64 {
        self.days.iter().fold(0, |m, d| m | (1 << d))
    }
}

pub fn parse_hm(t: &str) -> Option<u32> {
    let (h, m) = t.split_once(':')?;
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

fn fmt_hm(m: u32) -> String {
    format!("{:02}:{:02}", m / 60, m % 60)
}

/// Random-looking but fixed delay for one slot on one day, so restarts don't move it.
fn jitter(schedule_id: i64, date: &str, time: &str, max: u32) -> u32 {
    if max == 0 {
        return 0;
    }
    // FNV-1a: stable across runs (std's hasher is randomly seeded).
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in format!("{schedule_id}|{date}|{time}").bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    (h % u64::from(max + 1)) as u32
}

/// When a slot actually starts (minutes after midnight), jitter included, kept within the day.
fn due_minute(s: &Schedule, id: i64, date: &str, time: &str) -> Option<u32> {
    parse_hm(time).map(|t| (t + jitter(id, date, time, s.jitter_min)).min(23 * 60 + 59))
}

/// A planned slot, for the "Next runs" list.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Upcoming {
    pub schedule_id: i64,
    pub name: String,
    /// "YYYY-MM-DD"
    pub date: String,
    /// Start time with jitter, "HH:MM".
    pub at: String,
}

/// One scheduled (or "Run now") run and what it did.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRun {
    pub id: i64,
    pub schedule_id: i64,
    pub name: String,
    /// "YYYY-MM-DD HH:MM", or "now" for Run now.
    pub slot: String,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    /// One entry per account: `{account, serial, result: ok|skipped|error, note}`.
    pub results: Value,
}

// ---------- database ----------

impl Db {
    pub fn schedules(&self) -> Result<Vec<Schedule>, String> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare("SELECT id, name, enabled, group_id, days, times, minutes, jitter_min FROM schedules ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                let mask: i64 = r.get(4)?;
                let times: String = r.get(5)?;
                Ok(Schedule {
                    id: Some(r.get(0)?),
                    name: r.get(1)?,
                    enabled: r.get(2)?,
                    group_id: r.get(3)?,
                    days: (0..7).filter(|d| mask & (1 << d) != 0).collect(),
                    times: serde_json::from_str(&times).unwrap_or_default(),
                    minutes: r.get(6)?,
                    jitter_min: r.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn save_schedule(&self, s: Schedule) -> Result<Schedule, String> {
        let s = s.cleaned()?;
        let times = serde_json::to_string(&s.times).map_err(|e| e.to_string())?;
        let conn = self.conn();
        let id = match s.id {
            Some(id) => {
                let n = conn
                    .execute(
                        "UPDATE schedules SET name=?2, enabled=?3, group_id=?4, days=?5, times=?6, minutes=?7, jitter_min=?8
                         WHERE id=?1",
                        params![id, s.name, s.enabled, s.group_id, s.day_mask(), times, s.minutes, s.jitter_min],
                    )
                    .map_err(|e| e.to_string())?;
                if n == 0 {
                    return Err("That schedule no longer exists.".into());
                }
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO schedules (name, enabled, group_id, days, times, minutes, jitter_min)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![s.name, s.enabled, s.group_id, s.day_mask(), times, s.minutes, s.jitter_min],
                )
                .map_err(|e| e.to_string())?;
                conn.last_insert_rowid()
            }
        };
        Ok(Schedule { id: Some(id), ..s })
    }

    pub fn delete_schedule(&self, id: i64) -> Result<(), String> {
        self.conn().execute("DELETE FROM schedules WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Claims a slot; false if it already ran (or is running).
    fn claim_slot(&self, schedule_id: i64, slot: &str) -> Result<Option<i64>, String> {
        let conn = self.conn();
        let n = conn
            .execute(
                "INSERT OR IGNORE INTO schedule_runs (schedule_id, slot, status) VALUES (?1, ?2, 'running')",
                params![schedule_id, slot],
            )
            .map_err(|e| e.to_string())?;
        Ok((n == 1).then(|| conn.last_insert_rowid()))
    }

    fn finish_schedule_run(&self, id: i64, status: &str, results: &Value) -> Result<(), String> {
        self.conn()
            .execute(
                "UPDATE schedule_runs SET status=?2, results=?3, finished_at=datetime('now') WHERE id=?1",
                params![id, status, results.to_string()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn schedule_runs(&self, limit: u32) -> Result<Vec<ScheduleRun>, String> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare(
                "SELECT r.id, r.schedule_id, COALESCE(s.name, '(deleted)'), r.slot, r.status, r.started_at,
                        r.finished_at, r.results
                 FROM schedule_runs r LEFT JOIN schedules s ON s.id = r.schedule_id
                 ORDER BY r.id DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([limit], |r| {
                let results: Option<String> = r.get(7)?;
                Ok(ScheduleRun {
                    id: r.get(0)?,
                    schedule_id: r.get(1)?,
                    name: r.get(2)?,
                    slot: r.get(3)?,
                    status: r.get(4)?,
                    started_at: r.get(5)?,
                    finished_at: r.get(6)?,
                    results: results.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(json!([])),
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Local date, weekday (0 = Sunday) and minute of the day, `days_ahead` days from now.
    fn local_day(&self, days_ahead: u32) -> Result<(String, u8, u32), String> {
        let offset = format!("+{days_ahead} days");
        self.conn()
            .query_row(
                "SELECT date('now', 'localtime', ?1), CAST(strftime('%w', 'now', 'localtime', ?1) AS INTEGER),
                        CAST(strftime('%H', 'now', 'localtime') AS INTEGER) * 60
                          + CAST(strftime('%M', 'now', 'localtime') AS INTEGER)",
                [offset],
                |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as u8, r.get::<_, i64>(2)? as u32)),
            )
            .map_err(|e| e.to_string())
    }

    /// Global warm-up options (Settings → Warm-up), as the worker takes them.
    pub fn warmup_options(&self) -> Result<Value, String> {
        let saved: Option<String> = self
            .conn()
            .query_row("SELECT value FROM settings WHERE key = 'warmup'", [], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        let saved: Value = saved.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
        let mut opts = json!({
            "watchMinSec": 5, "watchMaxSec": 20, "likeChance": 0.1, "followChance": 0.02, "keywords": [],
        });
        if let Some(o) = saved["options"].as_object() {
            for k in ["watchMinSec", "watchMaxSec", "likeChance", "followChance", "keywords"] {
                if let Some(v) = o.get(k) {
                    opts[k] = v.clone();
                }
            }
        }
        Ok(opts)
    }

    /// The warm-up form as the UI saved it, or null.
    pub fn warmup_settings(&self) -> Result<Value, String> {
        let saved: Option<String> = self
            .conn()
            .query_row("SELECT value FROM settings WHERE key = 'warmup'", [], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(saved.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null))
    }

    /// Saves `{form, options}` from Settings → Warm-up.
    pub fn set_warmup_settings(&self, v: &Value) -> Result<(), String> {
        if !v["options"].is_object() {
            return Err("Warm-up settings need `options`.".into());
        }
        self.conn()
            .execute(
                "INSERT INTO settings (key, value) VALUES ('warmup', ?1)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                [v.to_string()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// The next `limit` slots of enabled schedules over the coming week.
pub fn upcoming(db: &Db, limit: usize) -> Result<Vec<Upcoming>, String> {
    let schedules = db.schedules()?;
    let mut out = Vec::new();
    for ahead in 0..8 {
        let (date, weekday, now_min) = db.local_day(ahead)?;
        for s in schedules.iter().filter(|s| s.enabled && s.days.contains(&weekday)) {
            let id = s.id.unwrap_or(0);
            for t in &s.times {
                let Some(due) = due_minute(s, id, &date, t) else { continue };
                if ahead == 0 && due + GRACE_MIN <= now_min {
                    continue;
                }
                out.push(Upcoming { schedule_id: id, name: s.name.clone(), date: date.clone(), at: fmt_hm(due) });
            }
        }
    }
    out.sort_by(|a, b| (&a.date, &a.at).cmp(&(&b.date, &b.at)));
    out.truncate(limit);
    Ok(out)
}

/// Slots that should start now: `(schedule, "YYYY-MM-DD HH:MM")`.
fn due_now(db: &Db) -> Result<Vec<(Schedule, String)>, String> {
    let (date, weekday, now_min) = db.local_day(0)?;
    let mut due = Vec::new();
    for s in db.schedules()?.into_iter().filter(|s| s.enabled && s.days.contains(&weekday)) {
        let id = s.id.unwrap_or(0);
        for t in s.times.clone() {
            if let Some(at) = due_minute(&s, id, &date, &t) {
                if now_min >= at && now_min < at + GRACE_MIN {
                    due.push((s.clone(), format!("{date} {t}")));
                }
            }
        }
    }
    Ok(due)
}

// ---------- running ----------

/// Run ids the user asked to stop.
#[derive(Default)]
pub struct Scheduler {
    cancelled: Mutex<HashSet<i64>>,
}

impl Scheduler {
    fn is_cancelled(&self, run: i64) -> bool {
        self.cancelled.lock().unwrap_or_else(|e| e.into_inner()).contains(&run)
    }
}

/// Starts the background loop. Call once, after the database and worker are managed.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Let the worker come up before the first check.
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            let a = app.clone();
            let due = tauri::async_runtime::spawn_blocking(move || due_now(&a.state::<Db>()))
                .await
                .unwrap_or_else(|e| Err(e.to_string()));
            match due {
                Ok(due) => {
                    for (schedule, slot) in due {
                        let id = schedule.id.unwrap_or(0);
                        match app.state::<Db>().claim_slot(id, &slot) {
                            Ok(Some(run)) => {
                                tauri::async_runtime::spawn(run_schedule(app.clone(), schedule, run));
                            }
                            Ok(None) => {}
                            Err(e) => eprintln!("[scheduler] {e}"),
                        }
                    }
                }
                Err(e) => eprintln!("[scheduler] {e}"),
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}

/// "Run now": same as a due slot, recorded with slot "now <timestamp>".
pub fn run_now(app: &AppHandle, schedule_id: i64) -> Result<i64, String> {
    let db = app.state::<Db>();
    let schedule = db
        .schedules()?
        .into_iter()
        .find(|s| s.id == Some(schedule_id))
        .ok_or("That schedule no longer exists.")?;
    let slot = format!("now {}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
    let run = db.claim_slot(schedule_id, &slot)?.ok_or("Already running.")?;
    tauri::async_runtime::spawn(run_schedule(app.clone(), schedule, run));
    Ok(run)
}

/// Stops a run: no new accounts start, and the phones' current warm-ups are asked to stop.
pub async fn stop(app: &AppHandle, run: i64) {
    app.state::<Scheduler>().cancelled.lock().unwrap_or_else(|e| e.into_inner()).insert(run);
    let busy: Vec<String> = app.state::<crate::live::Live>().all().into_iter().map(|j| j.serial).collect();
    for serial in busy {
        let _ = crate::stop_job(app.state(), serial).await;
    }
}

fn result(account: &str, serial: &str, kind: &str, note: impl Into<String>) -> Value {
    json!({ "account": account, "serial": serial, "result": kind, "note": note.into() })
}

async fn run_schedule(app: AppHandle, schedule: Schedule, run: i64) {
    let results = plan_and_run(&app, &schedule, run).await;
    let ran = results.iter().any(|r| r["result"] == "ok" || r["result"] == "error");
    let status = if app.state::<Scheduler>().is_cancelled(run) {
        "stopped"
    } else if ran {
        "done"
    } else {
        "skipped"
    };
    if let Err(e) = app.state::<Db>().finish_schedule_run(run, status, &Value::Array(results)) {
        eprintln!("[scheduler] {e}");
    }
}

async fn plan_and_run(app: &AppHandle, schedule: &Schedule, run: i64) -> Vec<Value> {
    let db = app.state::<Db>();
    let (accounts, groups, options) = match (db.accounts(None), db.groups(), db.warmup_options()) {
        (Ok(a), Ok(g), Ok(o)) => (a, g, o),
        (a, g, o) => {
            let e = a.err().map(|e| e.to_string()).or(g.err()).or(o.err()).unwrap_or_default();
            return vec![result("", "", "error", e)];
        }
    };
    let targets: Vec<_> = match schedule.group_id {
        None => accounts,
        Some(gid) => match groups.iter().find(|g| g.id == gid) {
            Some(g) => accounts.into_iter().filter(|a| g.account_ids.contains(&a.id)).collect(),
            None => return vec![result("", "", "skipped", "Its group was deleted")],
        },
    };
    if targets.is_empty() {
        return vec![result("", "", "skipped", "No accounts to warm up")];
    }

    let connected: HashSet<String> = tauri::async_runtime::spawn_blocking(crate::adb::list)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default()
        .into_iter()
        .filter(|d| d.state == "device")
        .map(|d| d.serial)
        .collect();

    let mut out = Vec::new();
    let mut per_phone: Vec<(String, Vec<crate::db::Account>)> = Vec::new();
    for a in targets {
        if a.platform != "tiktok" {
            continue;
        }
        if a.status != "ok" {
            out.push(result(&a.username, &a.serial, "skipped", "Needs attention"));
        } else if !connected.contains(&a.serial) {
            out.push(result(&a.username, &a.serial, "skipped", "Phone not connected"));
        } else if let Some(p) = per_phone.iter_mut().find(|(s, _)| *s == a.serial) {
            p.1.push(a);
        } else {
            per_phone.push((a.serial.clone(), vec![a]));
        }
    }

    // Phones in parallel, accounts on one phone in turn.
    let tasks: Vec<_> = per_phone
        .into_iter()
        .map(|(serial, accounts)| {
            let app = app.clone();
            let options = options.clone();
            let minutes = schedule.minutes;
            tauri::async_runtime::spawn(async move {
                let mut res = Vec::new();
                for a in accounts {
                    if app.state::<Scheduler>().is_cancelled(run) {
                        res.push(result(&a.username, &serial, "skipped", "Stopped"));
                        continue;
                    }
                    if app.state::<crate::live::Live>().all().iter().any(|j| j.serial == serial) {
                        res.push(result(&a.username, &serial, "skipped", "Phone busy with another job"));
                        continue;
                    }
                    let mut job = options.clone();
                    job["action"] = json!("warmup");
                    job["platform"] = json!(a.platform);
                    job["username"] = json!(a.username);
                    job["minutes"] = json!(minutes);
                    res.push(match crate::execute_job(&app, serial.clone(), job).await {
                        Ok(r) => {
                            let note = format!(
                                "{} videos, {} likes, {} follows",
                                r["videos"].as_u64().unwrap_or(0),
                                r["likes"].as_u64().unwrap_or(0),
                                r["follows"].as_u64().unwrap_or(0)
                            );
                            result(&a.username, &serial, "ok", note)
                        }
                        // Safety refusals (quiet hours, daily limit) are skips, not failures.
                        Err(e) if e.contains("Quiet hours") || e.contains("today's warm-up limit") => {
                            result(&a.username, &serial, "skipped", e)
                        }
                        Err(e) => result(&a.username, &serial, "error", e),
                    });
                }
                res
            })
        })
        .collect();
    for t in tasks {
        if let Ok(mut r) = t.await {
            out.append(&mut r);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schedule() -> Schedule {
        Schedule {
            id: None,
            name: " Morning ".into(),
            enabled: true,
            group_id: None,
            days: vec![1, 3, 3, 9],
            times: vec!["9:05".into(), "08:00".into()],
            minutes: 500,
            jitter_min: 15,
        }
    }

    #[test]
    fn cleans_schedules() {
        let s = schedule().cleaned().unwrap();
        assert_eq!(s.name, "Morning");
        assert_eq!(s.days, vec![1, 3]);
        assert_eq!(s.times, vec!["08:00", "09:05"]);
        assert_eq!(s.minutes, 120);
        assert!(Schedule { times: vec!["25:00".into()], ..schedule() }.cleaned().is_err());
        assert!(Schedule { days: vec![], ..schedule() }.cleaned().is_err());
        assert!(Schedule { name: "  ".into(), ..schedule() }.cleaned().is_err());
    }

    #[test]
    fn jitter_is_stable_and_bounded() {
        let a = jitter(1, "2026-11-24", "09:00", 15);
        assert_eq!(a, jitter(1, "2026-11-24", "09:00", 15));
        assert!(a <= 15);
        assert_eq!(jitter(1, "2026-11-24", "09:00", 0), 0);
        // Spread out across days.
        let days: HashSet<u32> = (1..=28).map(|d| jitter(1, &format!("2026-11-{d:02}"), "09:00", 30)).collect();
        assert!(days.len() > 5);
        // Never past the end of the day.
        let late = Schedule { jitter_min: 120, ..schedule() };
        assert!(due_minute(&late, 1, "2026-11-24", "23:50").unwrap() <= 23 * 60 + 59);
    }

    #[test]
    fn saves_claims_and_plans() {
        let path = std::env::temp_dir().join(format!("sma-sched-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();

        let all_days = Schedule { days: (0..7).collect(), jitter_min: 0, ..schedule() };
        let saved = db.save_schedule(all_days).unwrap();
        let id = saved.id.unwrap();
        assert_eq!(db.schedules().unwrap(), vec![saved.clone()]);

        // A slot runs once.
        assert!(db.claim_slot(id, "2026-11-24 08:00").unwrap().is_some());
        assert!(db.claim_slot(id, "2026-11-24 08:00").unwrap().is_none());
        let run = db.schedule_runs(10).unwrap();
        assert_eq!(run[0].status, "running");

        // Next runs: sorted, at most `limit`, only enabled schedules.
        let next = upcoming(&db, 5).unwrap();
        assert_eq!(next.len(), 5);
        assert!(next.windows(2).all(|w| (&w[0].date, &w[0].at) <= (&w[1].date, &w[1].at)));
        db.save_schedule(Schedule { enabled: false, ..saved.clone() }).unwrap();
        assert!(upcoming(&db, 5).unwrap().is_empty());

        // Due now: a slot at the current minute is due; one an hour ago is past its grace window.
        let (_, weekday, now) = db.local_day(0).unwrap();
        let at = |m: u32| fmt_hm(m);
        let now_s = Schedule { id: Some(id), days: vec![weekday], times: vec![at(now)], enabled: true, ..saved.clone() };
        db.save_schedule(now_s).unwrap();
        assert_eq!(due_now(&db).unwrap().len(), 1);
        if now >= 60 {
            let old = Schedule { id: Some(id), days: vec![weekday], times: vec![at(now - 60)], enabled: true, ..saved };
            db.save_schedule(old).unwrap();
            assert!(due_now(&db).unwrap().is_empty());
        }

        // Warm-up options: defaults, then what Settings saved.
        assert_eq!(db.warmup_options().unwrap()["watchMaxSec"], 20);
        db.set_warmup_settings(&json!({ "form": {}, "options": { "watchMaxSec": 30, "minutes": 99 } })).unwrap();
        let o = db.warmup_options().unwrap();
        assert_eq!(o["watchMaxSec"], 30);
        assert!(o.get("minutes").is_none(), "per-schedule minutes win");

        db.delete_schedule(id).unwrap();
        assert!(db.schedules().unwrap().is_empty());
        assert_eq!(db.schedule_runs(10).unwrap()[0].name, "(deleted)");

        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
