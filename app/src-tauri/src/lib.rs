mod adb;
mod db;
mod setup;
mod worker;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, RunEvent, State};

use db::{Db, JobRun};
use worker::{Worker, WorkerStatus};

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

/// Connected phones first, then phones seen before that are unplugged now.
#[tauri::command]
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

#[tauri::command]
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

/// Runs one job on one phone and records it in `job_runs`.
/// `job` is e.g. `{ "action": "open_app", "package": "com.instagram.android" }`.
#[tauri::command]
async fn run_job(
    db: State<'_, Db>,
    worker: State<'_, Worker>,
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
    let reply = worker.run(job).await;
    db.finish_run(run_id, &reply.as_ref().map(Value::to_string).map_err(Clone::clone))
        .map_err(err)?;
    reply
}

#[tauri::command]
fn recent_runs(db: State<'_, Db>, limit: Option<u32>) -> CmdResult<Vec<JobRun>> {
    db.recent_runs(limit.unwrap_or(50)).map_err(err)
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

            let worker = Worker::new();
            worker.start(app.handle());
            app.manage(worker);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_devices,
            rename_device,
            worker_status,
            restart_worker,
            run_job,
            recent_runs,
            setup::setup_status,
            setup::setup_install,
            setup::phone::install_udev_rule,
            setup::phone::phone_info,
            setup::phone::install_helper_apks,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Worker>().stop();
            }
        });
}
