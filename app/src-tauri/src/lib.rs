mod adb;
mod db;
mod live;
mod mirror;
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
async fn run_job(
    db: State<'_, Db>,
    worker: State<'_, Worker>,
    live: State<'_, live::Live>,
    serial: String,
    job: Value,
) -> CmdResult<Value> {
    let mut job = match job {
        Value::Object(map) => map,
        _ => return Err("job must be an object".into()),
    };
    let action = job.get("action").and_then(Value::as_str).ok_or("job.action is required")?.to_string();
    job.insert("serial".into(), Value::String(serial.clone()));
    let job = Value::Object(job);

    let run_id = db.start_run(&serial, &action, &job.to_string()).map_err(err)?;
    live.start(&serial, run_id, &action, job["username"].as_str());
    let reply = worker.run(job.clone(), job_timeout(&job)).await;
    live.finish(&serial, run_id);
    let outcome = reply.as_ref().map(Value::to_string).map_err(|e| e.message.clone());
    db.finish_run(run_id, &outcome).map_err(err)?;
    record_accounts(&db, &serial, &job, &reply).map_err(err)?;
    reply.map_err(|e| e.message)
}

/// Asks the job running on this phone to stop. Not recorded as a run.
#[tauri::command]
async fn stop_job(worker: State<'_, Worker>, serial: String) -> CmdResult<()> {
    let job = serde_json::json!({ "action": "stop", "serial": serial });
    worker.run(job, Duration::from_secs(10)).await.map(|_| ()).map_err(|e| e.message)
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

/// Warm-ups run for minutes; everything else should finish within a few.
fn job_timeout(job: &Value) -> Duration {
    let base = 180;
    match job["action"].as_str() {
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
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            setup::init(&data_dir);
            app.manage(Db::open(&data_dir.join("sma.db"))?);

            // Before the worker: its progress events update this.
            app.manage(live::Live::default());
            let worker = Worker::new();
            worker.start(app.handle());
            app.manage(worker);
            app.manage(viewer::Viewers::default());
            // Last: it serves the state managed above.
            let web = web::start(app.handle(), &data_dir);
            app.manage(web);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_devices,
            rename_device,
            worker_status,
            restart_worker,
            run_job,
            stop_job,
            list_accounts,
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
