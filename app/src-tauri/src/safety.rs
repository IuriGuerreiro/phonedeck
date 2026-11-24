//! Safety limits (Settings → Safety), saved in SQLite and enforced on every warm-up:
//! quiet hours, daily likes / follows / minutes per account, and random breaks.
//! "Used today" comes from the warm-up runs already recorded in `job_runs`.
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::db::Db;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Safety {
    pub max_likes_per_day: u32,
    pub max_follows_per_day: u32,
    pub max_minutes_per_day: u32,
    pub quiet_hours_on: bool,
    /// "HH:MM", local time.
    pub quiet_start: String,
    pub quiet_end: String,
    pub breaks_on: bool,
    /// A break comes after a random number of minutes in this range.
    pub break_every_min: u32,
    pub break_every_max: u32,
    /// Break length range, minutes.
    pub break_length_min: u32,
    pub break_length_max: u32,
}

impl Default for Safety {
    fn default() -> Self {
        Self {
            max_likes_per_day: 60,
            max_follows_per_day: 10,
            max_minutes_per_day: 45,
            quiet_hours_on: true,
            quiet_start: "23:00".into(),
            quiet_end: "07:30".into(),
            breaks_on: true,
            break_every_min: 8,
            break_every_max: 15,
            break_length_min: 2,
            break_length_max: 6,
        }
    }
}

impl Safety {
    /// Clamp to sane ranges so a typo can't disable a limit by accident.
    pub fn cleaned(mut self) -> Self {
        let d = Self::default();
        self.max_likes_per_day = self.max_likes_per_day.min(1000);
        self.max_follows_per_day = self.max_follows_per_day.min(200);
        self.max_minutes_per_day = self.max_minutes_per_day.clamp(1, 600);
        if parse_hm(&self.quiet_start).is_none() {
            self.quiet_start = d.quiet_start;
        }
        if parse_hm(&self.quiet_end).is_none() {
            self.quiet_end = d.quiet_end;
        }
        self.break_every_min = self.break_every_min.clamp(1, 120);
        self.break_every_max = self.break_every_max.clamp(self.break_every_min, 120);
        self.break_length_min = self.break_length_min.clamp(1, 60);
        self.break_length_max = self.break_length_max.clamp(self.break_length_min, 60);
        self
    }

    /// Is `now` ("HH:MM", local) inside quiet hours? Handles windows past midnight.
    pub fn is_quiet(&self, now: &str) -> bool {
        let (Some(n), Some(s), Some(e)) = (parse_hm(now), parse_hm(&self.quiet_start), parse_hm(&self.quiet_end)) else {
            return false;
        };
        self.quiet_hours_on && if s <= e { n >= s && n < e } else { n >= s || n < e }
    }
}

fn parse_hm(t: &str) -> Option<u32> {
    let (h, m) = t.split_once(':')?;
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// What one account has used today (local day).
#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub likes: u32,
    pub follows: u32,
    pub minutes: u32,
}

/// Checks a warm-up against the limits and fits it to what's left today.
/// Errors explain why it can't run. Other jobs pass through untouched.
pub fn apply(db: &Db, serial: &str, job: &mut Map<String, Value>) -> Result<(), String> {
    if job.get("action").and_then(Value::as_str) != Some("warmup") {
        return Ok(());
    }
    let s = db.safety()?;
    let now = db.local_time()?;
    if s.is_quiet(&now) {
        return Err(format!(
            "Quiet hours ({}–{}): warm-ups are paused. Change this in Settings → Safety.",
            s.quiet_start, s.quiet_end
        ));
    }

    // "Warm up current" has no username: today's use can't be counted, so it gets the full day.
    let used = match job.get("username").and_then(Value::as_str) {
        Some(u) => db.usage_today(serial, u)?,
        None => Usage::default(),
    };
    let who = job.get("username").and_then(Value::as_str).map(|u| format!("@{u}")).unwrap_or("This account".into());
    let minutes_left = s.max_minutes_per_day.saturating_sub(used.minutes);
    if minutes_left == 0 {
        return Err(format!("{who} reached today's warm-up limit ({} min).", s.max_minutes_per_day));
    }
    let asked = job.get("minutes").and_then(Value::as_f64).unwrap_or(10.0);
    job.insert("minutes".into(), json!(asked.min(minutes_left as f64)));
    job.insert("maxLikes".into(), json!(s.max_likes_per_day.saturating_sub(used.likes)));
    job.insert("maxFollows".into(), json!(s.max_follows_per_day.saturating_sub(used.follows)));
    if s.breaks_on {
        job.insert(
            "breaks".into(),
            json!({
                "everyMin": s.break_every_min, "everyMax": s.break_every_max,
                "lengthMin": s.break_length_min, "lengthMax": s.break_length_max,
            }),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quiet_hours_wrap_past_midnight() {
        let s = Safety::default(); // 23:00–07:30
        assert!(s.is_quiet("23:00"));
        assert!(s.is_quiet("02:15"));
        assert!(!s.is_quiet("07:30"));
        assert!(!s.is_quiet("12:00"));
        let day = Safety { quiet_start: "12:00".into(), quiet_end: "14:00".into(), ..Safety::default() };
        assert!(day.is_quiet("13:59"));
        assert!(!day.is_quiet("14:00"));
        assert!(!Safety { quiet_hours_on: false, ..Safety::default() }.is_quiet("02:00"));
    }

    #[test]
    fn cleans_bad_values() {
        let s = Safety {
            quiet_start: "25:99".into(),
            max_minutes_per_day: 0,
            break_every_min: 20,
            break_every_max: 5,
            ..Safety::default()
        }
        .cleaned();
        assert_eq!(s.quiet_start, "23:00");
        assert_eq!(s.max_minutes_per_day, 1);
        assert_eq!(s.break_every_max, 20);
    }

    #[test]
    fn enforces_limits_from_recorded_runs() {
        let path = std::env::temp_dir().join(format!("sma-safety-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        // No quiet hours, so the test doesn't depend on the clock.
        db.set_safety(&Safety { quiet_hours_on: false, max_minutes_per_day: 30, max_likes_per_day: 20, ..Safety::default() })
            .unwrap();
        // Two finished warm-ups today: 10 + 10 minutes, 8 + 7 likes, 1 follow.
        for likes in [8, 7] {
            let id = db.start_run("A", "warmup", r#"{"action":"warmup","username":"ana"}"#).unwrap();
            let result = format!(r#"{{"likes":{likes},"follows":{}}}"#, (likes == 8) as u8);
            db.finish_run(id, &Ok(result)).unwrap();
            db.backdate_run_start(id, 10).unwrap();
        }
        assert_eq!(db.usage_today("A", "ana").unwrap(), Usage { likes: 15, follows: 1, minutes: 20 });
        // Another account on the same phone is separate.
        assert_eq!(db.usage_today("A", "bob").unwrap(), Usage::default());

        let mut job = serde_json::from_str::<Map<String, Value>>(r#"{"action":"warmup","username":"ana","minutes":25}"#).unwrap();
        apply(&db, "A", &mut job).unwrap();
        assert_eq!(job["minutes"], json!(10.0));
        assert_eq!(job["maxLikes"], json!(5));
        assert_eq!(job["maxFollows"], json!(9));
        assert!(job.contains_key("breaks"));

        let id = db.start_run("A", "warmup", r#"{"action":"warmup","username":"ana"}"#).unwrap();
        db.finish_run(id, &Ok("{}".into())).unwrap();
        db.backdate_run_start(id, 10).unwrap();
        let mut job = serde_json::from_str::<Map<String, Value>>(r#"{"action":"warmup","username":"ana"}"#).unwrap();
        assert!(apply(&db, "A", &mut job).unwrap_err().contains("today's warm-up limit"));

        // Quiet hours block warm-ups but not other jobs.
        let now = db.local_time().unwrap();
        let (h, _) = now.split_once(':').unwrap();
        let next = format!("{:02}:00", (h.parse::<u32>().unwrap() + 1) % 24);
        db.set_safety(&Safety { quiet_start: format!("{h}:00"), quiet_end: next, ..Safety::default() }).unwrap();
        let mut job = serde_json::from_str::<Map<String, Value>>(r#"{"action":"warmup","username":"bob"}"#).unwrap();
        assert!(apply(&db, "A", &mut job).unwrap_err().contains("Quiet hours"));
        let mut other = serde_json::from_str::<Map<String, Value>>(r#"{"action":"swipe_up"}"#).unwrap();
        assert!(apply(&db, "A", &mut other).is_ok());

        drop(db);
        let _ = std::fs::remove_file(&path);
    }
}
