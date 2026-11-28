mod posting;
mod rename;
mod video_analytics;
mod adb;
mod db;
mod live;
mod mirror;
mod safety;
mod alerts;
mod scheduler;
mod setup;
mod stats;
mod viewer;
mod web;
mod worker;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, RunEvent, State};

use std::time::Duration;

use db::{Account, AccountEvent, Db, JobRun};
use worker::{JobError, Worker, WorkerStatus};

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceView {
    serial: String,
    name: Option<String>,
    model: Option<String>,
    /// adb state ("device" = ready) or "disconnected" for phones seen before.
    state: String,
}

// Commands marked `async` run off the UI thread: they shell out to adb or touch
// SQLite, and a slow disk must never freeze the window.

/// Connected phones first, then phones seen before that are unplugged now.
#[tauri::command(async)]
fn list_devices(db: State<'_, Db>) -> CmdResult<Vec<DeviceView>> {
    let connected = adb::list()?;
    for d in &connected {
        db.touch_device(&d.serial, d.model.as_deref()).map_err(err)?;
    }
    let known = db.known_devices().map_err(err)?;
    let mut out: Vec<DeviceView> = connected
        .into_iter()
        .map(|d| {
            let k = known.iter().find(|k| k.serial == d.serial);
            DeviceView {
                name: k.and_then(|k| k.name.clone()),
                model: d.model.or_else(|| k.and_then(|k| k.model.clone())),
                serial: d.serial,
                state: d.state,
            }
        })
        .collect();
    for k in known {
        if !out.iter().any(|d| d.serial == k.serial) {
            out.push(DeviceView { serial: k.serial, name: k.name, model: k.model, state: "disconnected".into() });
        }
    }
    Ok(out)
}

#[tauri::command(async)]
fn rename_device(db: State<'_, Db>, serial: String, name: String) -> CmdResult<()> {
    let name = name.trim();
    db.rename_device(&serial, (!name.is_empty()).then_some(name)).map_err(err)
}

#[tauri::command]
fn worker_status(worker: State<'_, Worker>) -> WorkerStatus {
    worker.status()
}

/// Stopping the old worker can block for a few seconds, so keep it off the UI thread.
#[tauri::command]
async fn restart_worker(app: AppHandle) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Worker>().start(&app))
        .await
        .map_err(err)
}

/// Runs one job on one phone, records it in `job_runs`, and updates the
/// account it was about (if any).
/// `job` is e.g. `{ "action": "warmup", "platform": "tiktok", "username": "x", "minutes": 10 }`.
#[tauri::command]
async fn run_job(app: AppHandle, serial: String, job: Value) -> CmdResult<Value> {
    execute_job(&app, serial, job).await
}

/// What `run_job` does; the scheduler calls it too, so its jobs get the same groups,
/// safety limits, logging and live status as clicks in the UI.
pub(crate) async fn execute_job(app: &AppHandle, serial: String, job: Value) -> CmdResult<Value> {
    let db = app.state::<Db>();
    let worker = app.state::<Worker>();
    let live = app.state::<live::Live>();
    let mut job = match job {
        Value::Object(map) => map,
        _ => return Err("job must be an object".into()),
    };
    let action = job.get("action").and_then(Value::as_str).ok_or("job.action is required")?.to_string();
    db.check_hold(&serial)?;
    db.apply_group_keywords(&serial, &mut job)?;
    safety::apply(&db, &serial, &mut job)?;
    job.insert("serial".into(), Value::String(serial.clone()));
    let job = Value::Object(job);

    let run_id = db.start_run(&serial, &action, &job.to_string()).map_err(err)?;
    live.start(&serial, run_id, &action, job["username"].as_str());
    let reply = worker.run(job.clone(), job_timeout(&job)).await;
    live.finish(&serial, run_id);
    let reply = if action == "video_analytics" {
        reply.and_then(|result| {
            video_analytics::record(&db, &serial, &job, &result)
                .map(|()| result)
                .map_err(|message| JobError { message, code: None })
        })
    } else { reply };
    let outcome = reply.as_ref().map(Value::to_string).map_err(|e| e.message.clone());
    db.finish_run(run_id, &outcome).map_err(err)?;
    record_accounts(&db, &serial, &job, &reply).map_err(err)?;
    if action == "account_analytics" {
        if let Ok(result) = &reply {
            let count = |key: &str| result[key].as_i64().filter(|v| *v >= 0).ok_or_else(|| format!("Invalid account metric: {key}"));
            db.save_account_snapshot(&serial, job["platform"].as_str().ok_or("Missing platform")?,
                job["username"].as_str().ok_or("Missing username")?, count("followers")?, count("following")?, count("likes")?).map_err(err)?;
        }
    }
    reply.map_err(|e| e.message)
}

/// Asks the job running on this phone to stop. Not recorded as a run.
#[tauri::command]
async fn stop_job(worker: State<'_, Worker>, serial: String) -> CmdResult<()> {
    let job = serde_json::json!({ "action": "stop", "serial": serial });
    worker.run(job, Duration::from_secs(10)).await.map(|_| ()).map_err(|e| e.message)
}

#[tauri::command(async)]
fn list_schedules(db: State<'_, Db>) -> CmdResult<Vec<scheduler::Schedule>> {
    db.schedules()
}

#[tauri::command(async)]
fn save_schedule(db: State<'_, Db>, schedule: scheduler::Schedule) -> CmdResult<scheduler::Schedule> {
    db.save_schedule(schedule)
}

#[tauri::command(async)]
fn delete_schedule(db: State<'_, Db>, id: i64) -> CmdResult<()> {
    db.delete_schedule(id)
}

#[tauri::command(async)]
fn upcoming_runs(db: State<'_, Db>, limit: Option<usize>) -> CmdResult<Vec<scheduler::Upcoming>> {
    scheduler::upcoming(&db, limit.unwrap_or(10))
}

#[tauri::command(async)]
fn schedule_runs(db: State<'_, Db>, limit: Option<u32>) -> CmdResult<Vec<scheduler::ScheduleRun>> {
    db.schedule_runs(limit.unwrap_or(20))
}

/// Runs a schedule right away. Returns the new run's id.
#[tauri::command(async)]
fn run_schedule_now(app: AppHandle, id: i64) -> CmdResult<i64> {
    scheduler::run_now(&app, id)
}

#[tauri::command]
async fn stop_schedule_run(app: AppHandle, id: i64) -> CmdResult<()> {
    scheduler::stop(&app, id).await;
    Ok(())
}

/// Settings → Warm-up as the UI saved it (`{form, options}`), or null.
#[tauri::command(async)]
fn get_warmup(db: State<'_, Db>) -> CmdResult<Value> {
    db.warmup_settings()
}

#[tauri::command(async)]
fn set_warmup(db: State<'_, Db>, value: Value) -> CmdResult<()> {
    db.set_warmup_settings(&value)
}

#[tauri::command(async)]
fn get_safety(db: State<'_, Db>) -> CmdResult<safety::Safety> {
    db.safety()
}

/// Saves the limits (cleaned up) and returns what was saved.
#[tauri::command(async)]
fn set_safety(db: State<'_, Db>, safety: safety::Safety) -> CmdResult<safety::Safety> {
    let s = safety.cleaned();
    db.set_safety(&s)?;
    Ok(s)
}

/// Today's warm-up use for one account, for showing "12 / 45 min".
#[tauri::command(async)]
fn usage_today(db: State<'_, Db>, serial: String, username: String) -> CmdResult<safety::Usage> {
    db.usage_today(&serial, &username)
}

#[tauri::command(async)]
fn list_groups(db: State<'_, Db>) -> CmdResult<Vec<db::Group>> { db.groups() }

#[tauri::command(async)]
fn save_group(db: State<'_, Db>, id: Option<i64>, name: String, keywords: Vec<String>) -> CmdResult<()> {
    db.save_group(id, &name, keywords)
}

#[tauri::command(async)]
fn delete_group(db: State<'_, Db>, id: i64) -> CmdResult<()> { db.delete_group(id) }

#[tauri::command(async)]
fn set_group_member(db: State<'_, Db>, group_id: i64, account_id: i64, member: bool) -> CmdResult<()> {
    db.set_group_member(group_id, account_id, member)
}

/// Warm-up minutes per day, for the dashboard chart.
#[tauri::command(async)]
fn warmup_days(db: State<'_, Db>, days: Option<u32>) -> CmdResult<Vec<db::DayMinutes>> {
    db.warmup_days(days.unwrap_or(7))
}

/// Accounts on one phone, or on every phone when `serial` is omitted.
#[tauri::command(async)]
fn list_accounts(db: State<'_, Db>, serial: Option<String>) -> CmdResult<Vec<Account>> {
    db.accounts(serial.as_deref()).map_err(err)
}

#[tauri::command(async)]
fn delete_account(db: State<'_, Db>, id: i64) -> CmdResult<()> {
    db.delete_account(id).map_err(err)
}

#[tauri::command(async)]
fn account_snapshots(db: State<'_, Db>) -> CmdResult<Vec<db::AccountSnapshot>> {
    db.account_snapshots().map_err(err)
}

/// Warm-ups run for minutes; everything else should finish within a few.
fn job_timeout(job: &Value) -> Duration {
    let base = 180;
    match job["action"].as_str() {
        Some("prepare_post") => Duration::from_secs(1200),
        // Must outlast the worker's own wait for the largest video (confirmMs).
        Some("publish_post") | Some("post_video") => Duration::from_secs(3600),
        Some("video_analytics") => Duration::from_secs(900),
        Some("warmup") => {
            let minutes = job["minutes"].as_f64().unwrap_or(10.0).clamp(1.0, 120.0);
            Duration::from_secs(base + (minutes * 60.0) as u64)
        }
        _ => Duration::from_secs(base),
    }
}

fn record_accounts(
    db: &Db,
    serial: &str,
    job: &Value,
    reply: &Result<Value, JobError>,
) -> rusqlite::Result<()> {
    let Some(platform) = job["platform"].as_str() else { return Ok(()) };
    if let (Some("list_accounts"), Ok(result)) = (job["action"].as_str(), reply) {
        for name in result["accounts"].as_array().into_iter().flatten().filter_map(Value::as_str) {
            db.upsert_account(serial, platform, name, AccountEvent::Seen)?;
        }
        return Ok(());
    }
    let Some(username) = job["username"].as_str() else { return Ok(()) };
    let event = match reply {
        Ok(_) if job["action"] == "warmup" => AccountEvent::WarmedUp,
        Ok(_) => AccountEvent::Seen,
        Err(e) if e.code.as_deref() == Some("needs_attention") => AccountEvent::NeedsAttention(&e.message),
        Err(_) => return Ok(()),
    };
    db.upsert_account(serial, platform, username, event)
}

/// The job running on each phone right now, with its latest progress line.
#[tauri::command]
fn live_jobs(live: State<'_, live::Live>) -> Vec<live::LiveJob> {
    live.all()
}

#[tauri::command(async)]
fn recent_runs(db: State<'_, Db>, limit: Option<u32>) -> CmdResult<Vec<JobRun>> {
    db.recent_runs(limit.unwrap_or(50)).map_err(err)
}

/// Opens a live, view-only scrcpy window of the phone's screen.
#[tauri::command(async)]
fn view_phone(viewers: State<'_, viewer::Viewers>, serial: String, title: String) -> CmdResult<()> {
    viewers.open(&serial, &title)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Before the window opens: its webview data lives in this dir too.
            let data_dir = rename::data_dir(app.path().app_data_dir()?);
            std::fs::create_dir_all(&data_dir)?;
            if let Some(config) = app.config().app.windows.first() {
                tauri::WebviewWindowBuilder::from_config(app.handle(), config)?.build()?;
            }
            setup::init(&data_dir);
            app.manage(posting::Media::new(data_dir.join("posting"))?);
            app.manage(Db::open(&rename::db_path(&data_dir))?);

            // Before the worker: its progress events update this.
            app.manage(live::Live::default());
            let worker = Worker::new();
            worker.start(app.handle());
            app.manage(worker);
            app.manage(viewer::Viewers::default());
            // Last: it serves the state managed above.
            let web = web::start(app.handle(), &data_dir);
            app.manage(web);
            app.manage(scheduler::Scheduler::default());
            scheduler::start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_devices,
            rename_device,
            worker_status,
            restart_worker,
            run_job,
            stop_job,
            list_groups,
            get_safety,
            set_safety,
            alerts::list_alerts,
            alerts::resolve_alert,
            alerts::label_alert,
            alerts::alert_screenshot,
            list_schedules,
            save_schedule,
            delete_schedule,
            upcoming_runs,
            schedule_runs,
            run_schedule_now,
            stop_schedule_run,
            get_warmup,
            set_warmup,
            usage_today,
            warmup_days,
            save_group,
            delete_group,
            set_group_member,
            list_accounts,
            account_snapshots,
            video_analytics::video_readings,
            posting::list_posts,
            posting::create_post,
            posting::upload_post_chunk,
            posting::finish_post_upload,
            posting::delete_post,
            posting::prepare_post,
            posting::publish_post,
            posting::post_now,
            delete_account,
            recent_runs,
            setup::setup_status,
            setup::setup_install,
            setup::phone::install_udev_rule,
            setup::phone::phone_info,
            setup::phone::install_helper_apks,
            view_phone,
            live_jobs,
            stats::device_stats,
            stats::screenshot,
            stats::wake_screen,
            web::web_info,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Worker>().stop();
                app.state::<viewer::Viewers>().close_all();
            }
        });
}
