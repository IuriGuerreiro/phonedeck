//! Runs the Node worker (../../worker) and talks to it with JSON lines.
//! The worker starts Appium itself and owns all phone sessions.
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;


#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum WorkerStatus {
    Starting,
    Ready {
        #[serde(rename = "appiumPort")]
        appium_port: u16,
    },
    Failed {
        error: String,
    },
}

/// A failed job. `code` is set for failures the app treats specially,
/// e.g. "needs_attention" when a person has to look at the phone.
#[derive(Debug, Clone)]
pub struct JobError {
    pub message: String,
    pub code: Option<String>,
}

impl JobError {
    fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), code: None }
    }
}

type Reply = Result<Value, JobError>;
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Reply>>>>;

struct Running {
    child: Child,
    stdin: ChildStdin,
}

pub struct Worker {
    running: Mutex<Option<Running>>,
    status: Arc<Mutex<WorkerStatus>>,
    pending: Pending,
    next_id: AtomicU64,
    /// Bumped on every start so a dead worker's reader thread can't touch the new one's status.
    generation: Arc<AtomicU64>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Worker {
    pub fn new() -> Self {
        Self {
            running: Mutex::new(None),
            status: Arc::new(Mutex::new(WorkerStatus::Starting)),
            pending: Arc::default(),
            next_id: AtomicU64::new(1),
            generation: Arc::default(),
        }
    }

    pub fn status(&self) -> WorkerStatus {
        lock(&self.status).clone()
    }

    pub fn start(&self, app: &AppHandle) {
        self.stop();
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        set_status(app, &self.status, WorkerStatus::Starting);

        let dir = worker_dir();
        let log_dir = app.path().app_log_dir().unwrap_or_else(|_| std::env::temp_dir());
        let node = std::env::var_os("SMA_NODE").unwrap_or_else(|| "node".into());
        let spawned = Command::new(&node)
            .arg(dir.join("src/main.ts"))
            .current_dir(&dir)
            .env("SMA_LOG_DIR", &log_dir)
            .envs(crate::setup::worker_env())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn();
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                let error = format!("Could not start Node ({}): {e}", node.to_string_lossy());
                set_status(app, &self.status, WorkerStatus::Failed { error });
                return;
            }
        };

        let stdout = child.stdout.take().expect("piped stdout");
        let stdin = child.stdin.take().expect("piped stdin");
        *lock(&self.running) = Some(Running { child, stdin });

        let (app, status, pending) = (app.clone(), self.status.clone(), self.pending.clone());
        let current = self.generation.clone();
        std::thread::spawn(move || {
            let is_current = || current.load(Ordering::SeqCst) == generation;
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                    eprintln!("[worker] {line}");
                    continue;
                };
                if is_current() {
                    handle_message(&app, &status, &pending, msg);
                }
            }
            if !is_current() {
                return;
            }
            // stdout closed: the worker is gone. Fail anything still waiting.
            for (_, tx) in lock(&pending).drain() {
                let _ = tx.send(Err(JobError::new("Worker stopped")));
            }
            if !matches!(*lock(&status), WorkerStatus::Failed { .. }) {
                set_status(&app, &status, WorkerStatus::Failed { error: "Worker stopped".into() });
            }
        });
    }

    /// Close stdin so the worker can end its phone sessions and Appium, then force it if needed.
    pub fn stop(&self) {
        let Some(Running { mut child, stdin }) = lock(&self.running).take() else { return };
        drop(stdin);
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = child.kill();
        let _ = child.wait();
    }

    /// Send a job and wait for its reply, up to `timeout`.
    pub async fn run(&self, job: Value, timeout: Duration) -> Reply {
        if !matches!(self.status(), WorkerStatus::Ready { .. }) {
            return Err(JobError::new("Automation engine is not ready yet"));
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        lock(&self.pending).insert(id, tx);

        let line = json!({ "id": id, "job": job }).to_string() + "\n";
        let written = match lock(&self.running).as_mut() {
            Some(r) => r.stdin.write_all(line.as_bytes()).and_then(|_| r.stdin.flush()),
            None => Err(std::io::Error::other("worker not running")),
        };
        if let Err(e) = written {
            lock(&self.pending).remove(&id);
            return Err(JobError::new(format!("Could not reach worker: {e}")));
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(reply)) => reply,
            Ok(Err(_)) => Err(JobError::new("Worker stopped")),
            Err(_) => {
                lock(&self.pending).remove(&id);
                Err(JobError::new(format!("Job timed out after {}s", timeout.as_secs())))
            }
        }
    }
}

fn handle_message(app: &AppHandle, status: &Mutex<WorkerStatus>, pending: &Pending, msg: Value) {
    match msg.get("event").and_then(Value::as_str) {
        Some("ready") => {
            let appium_port = msg["appiumPort"].as_u64().unwrap_or(0) as u16;
            set_status(app, status, WorkerStatus::Ready { appium_port });
        }
        Some("fatal") => {
            let error = msg["error"].as_str().unwrap_or("Worker failed").to_string();
            set_status(app, status, WorkerStatus::Failed { error });
        }
        Some("progress") => {
            if let (Some(serial), Some(message), Some(live)) =
                (msg["serial"].as_str(), msg["message"].as_str(), app.try_state::<crate::live::Live>())
            {
                live.progress(serial, message);
            }
            let _ = app.emit("job-progress", msg);
        }
        Some(other) => eprintln!("[worker] unknown event {other}"),
        None => {
            let Some(id) = msg["id"].as_u64() else { return };
            let Some(tx) = lock(pending).remove(&id) else { return };
            let reply = if msg["ok"].as_bool() == Some(true) {
                Ok(msg["result"].clone())
            } else {
                Err(JobError {
                    message: msg["error"].as_str().unwrap_or("Unknown error").to_string(),
                    code: msg["code"].as_str().map(str::to_string),
                })
            };
            let _ = tx.send(reply);
        }
    }
}

fn set_status(app: &AppHandle, status: &Mutex<WorkerStatus>, next: WorkerStatus) {
    *lock(status) = next.clone();
    let _ = app.emit("worker-status", next);
}

pub(crate) fn worker_dir() -> PathBuf {
    std::env::var_os("SMA_WORKER_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../worker"))
}
