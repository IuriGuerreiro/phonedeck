//! Web access: the same UI and commands over HTTP, so a browser on another device
//! (e.g. over Tailscale) can use the app.
//!
//! - `POST /api/cmd/<name>` runs a command. JSON args in, JSON out (raw bytes for screenshots).
//! - `GET  /api/events` is a WebSocket with the same events the window gets.
//! - Everything else serves the UI.
//!
//! The UI is public; every `/api` call needs the token from Settings → Web access.
//! `SMA_WEB_ADDR` changes the address (default `0.0.0.0:1440`); `SMA_WEB=0` turns it off.
use std::{
    net::SocketAddr,
    path::{Path as FsPath, PathBuf},
    sync::Arc,
};

use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Listener, Manager};
use tokio::sync::broadcast;

use crate::{setup, stats};

/// Events forwarded to web clients. Same names as the Tauri events.
const EVENTS: [&str; 3] = ["job-progress", "worker-status", "setup-progress"];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebInfo {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
    /// e.g. "http://100.101.102.103:1440". Empty when off.
    pub urls: Vec<String>,
    /// Address the desktop window itself uses (screen mirroring goes through the server).
    pub local_url: Option<String>,
    /// Why the server isn't running, if it isn't.
    pub error: Option<String>,
}

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
    token: Arc<String>,
    events: broadcast::Sender<String>,
}

/// Starts the server in the background. Never fails the app: problems end up in `WebInfo.error`.
pub fn start(app: &AppHandle, data_dir: &FsPath) -> WebInfo {
    let token = load_or_create_token(data_dir);
    let addr = std::env::var("SMA_WEB_ADDR").unwrap_or_else(|_| "0.0.0.0:1440".into());
    let port = addr.rsplit(':').next().and_then(|p| p.parse().ok()).unwrap_or(1440);
    let off = |error: Option<String>| WebInfo {
        enabled: false,
        port,
        token: token.clone(),
        urls: vec![],
        local_url: None,
        error,
    };

    if std::env::var("SMA_WEB").as_deref() == Ok("0") {
        return off(None);
    }
    let addr: SocketAddr = match addr.parse() {
        Ok(a) => a,
        Err(e) => return off(Some(format!("Bad SMA_WEB_ADDR {addr:?}: {e}"))),
    };
    // Bind now so a busy port shows up as an error instead of failing silently later.
    let listener = match std::net::TcpListener::bind(addr).and_then(|l| l.set_nonblocking(true).map(|_| l)) {
        Ok(l) => l,
        Err(e) => return off(Some(format!("Could not listen on {addr}: {e}"))),
    };

    let (events, _) = broadcast::channel(256);
    for name in EVENTS {
        let tx = events.clone();
        app.listen_any(name, move |e| {
            let payload: Value = serde_json::from_str(e.payload()).unwrap_or(Value::Null);
            let _ = tx.send(json!({ "event": name, "payload": payload }).to_string());
        });
    }

    let ctx = Ctx { app: app.clone(), token: Arc::new(token.clone()), events };
    let router = Router::new()
        .route("/api/ping", get(ping))
        .route("/api/cmd/{name}", post(command))
        .route("/api/events", get(events_ws))
        .route("/api/mirror/{serial}", get(mirror_ws))
        .fallback(get(static_file))
        .with_state(ctx);

    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(l) => {
                if let Err(e) = axum::serve(l, router).await {
                    eprintln!("[web] server stopped: {e}");
                }
            }
            Err(e) => eprintln!("[web] could not start: {e}"),
        }
    });

    let urls = if addr.ip().is_unspecified() {
        local_ips().into_iter().map(|ip| format!("http://{ip}:{port}")).collect()
    } else {
        vec![format!("http://{addr}")]
    };
    println!("[web] PhoneDeck web access on {}", urls.join(", "));
    let local_ip = if addr.ip().is_unspecified() { "127.0.0.1".to_string() } else { addr.ip().to_string() };
    let local_url = Some(format!("http://{local_ip}:{port}"));
    WebInfo { enabled: true, port, token, urls, local_url, error: None }
}

/// Web address and token, for Settings → Web access.
#[tauri::command]
pub fn web_info(info: tauri::State<'_, WebInfo>) -> WebInfo {
    info.inner().clone()
}

// ---------- auth ----------

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

#[derive(Deserialize)]
struct MirrorQuery {
    token: Option<String>,
    /// Longest side of the video in pixels.
    max: Option<u32>,
    /// `0`: control only, no video frames (the page shows screenshots instead).
    video: Option<u8>,
    /// `1`: also stream the phone's sound.
    audio: Option<u8>,
}

fn authorized(ctx: &Ctx, headers: &HeaderMap, query: Option<&str>) -> bool {
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    bearer.or(query).is_some_and(|t| same(t.as_bytes(), ctx.token.as_bytes()))
}

/// Compare without stopping at the first difference, so timing doesn't leak the token.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn unauthorized() -> Response {
    (StatusCode::UNAUTHORIZED, "Missing or wrong token").into_response()
}

async fn ping(State(ctx): State<Ctx>, headers: HeaderMap) -> Response {
    if authorized(&ctx, &headers, None) { "ok".into_response() } else { unauthorized() }
}

// ---------- commands ----------

async fn command(State(ctx): State<Ctx>, Path(name): Path<String>, headers: HeaderMap, body: Bytes) -> Response {
    if !authorized(&ctx, &headers, None) {
        return unauthorized();
    }
    let args: Value = if body.is_empty() {
        json!({})
    } else {
        match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => return (StatusCode::BAD_REQUEST, format!("Bad JSON: {e}")).into_response(),
        }
    };
    match dispatch(&ctx.app, &name, args).await {
        Ok(Reply::Json(v)) => Json(v).into_response(),
        Ok(Reply::Bytes(b)) => ([(header::CONTENT_TYPE, "application/octet-stream")], b).into_response(),
        // Same as the window: errors are plain strings.
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

enum Reply {
    Json(Value),
    Bytes(Vec<u8>),
}

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null)).map_err(|e| format!("Bad argument `{key}`: {e}"))
}

fn to_json<T: Serialize>(r: Result<T, String>) -> Result<Reply, String> {
    r.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string())).map(Reply::Json)
}

/// Runs blocking work (adb, SQLite) off the async threads.
async fn blocking<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(&AppHandle) -> T + Send + 'static) -> Result<T, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || f(&app)).await.map_err(|e| e.to_string())
}

/// The same commands the window can call (see `generate_handler!` in lib.rs).
async fn dispatch(app: &AppHandle, name: &str, a: Value) -> Result<Reply, String> {
    match name {
        "list_devices" => to_json(blocking(app, |x| crate::list_devices(x.state())).await?),
        "rename_device" => {
            let (serial, n): (String, String) = (arg(&a, "serial")?, arg(&a, "name")?);
            to_json(blocking(app, move |x| crate::rename_device(x.state(), serial, n)).await?)
        }
        "worker_status" => to_json(Ok(crate::worker_status(app.state()))),
        "restart_worker" => to_json(crate::restart_worker(app.clone()).await),
        "run_job" => to_json(crate::run_job(app.state(), app.state(), app.state(), arg(&a, "serial")?, arg(&a, "job")?).await),
        "stop_job" => to_json(crate::stop_job(app.state(), arg(&a, "serial")?).await),
        "account_snapshots" => to_json(blocking(app, |x| crate::account_snapshots(x.state())).await?),
        "list_groups" => to_json(blocking(app, |x| crate::list_groups(x.state())).await?),
        "save_group" => {
            let (id, name, keywords) = (arg(&a, "id")?, arg(&a, "name")?, arg(&a, "keywords")?);
            to_json(blocking(app, move |x| crate::save_group(x.state(), id, name, keywords)).await?)
        }
        "delete_group" => {
            let id = arg(&a, "id")?;
            to_json(blocking(app, move |x| crate::delete_group(x.state(), id)).await?)
        }
        "set_group_member" => {
            let (group_id, account_id, member) = (arg(&a, "groupId")?, arg(&a, "accountId")?, arg(&a, "member")?);
            to_json(blocking(app, move |x| crate::set_group_member(x.state(), group_id, account_id, member)).await?)
        }
        "list_accounts" => {
            let serial: Option<String> = arg(&a, "serial")?;
            to_json(blocking(app, move |x| crate::list_accounts(x.state(), serial)).await?)
        }
        "delete_account" => {
            let id: i64 = arg(&a, "id")?;
            to_json(blocking(app, move |x| crate::delete_account(x.state(), id)).await?)
        }
        "recent_runs" => {
            let limit: Option<u32> = arg(&a, "limit")?;
            to_json(blocking(app, move |x| crate::recent_runs(x.state(), limit)).await?)
        }
        "live_jobs" => to_json(Ok(crate::live_jobs(app.state()))),
        "view_phone" => {
            let (serial, title): (String, String) = (arg(&a, "serial")?, arg(&a, "title")?);
            to_json(blocking(app, move |x| crate::view_phone(x.state(), serial, title)).await?)
        }
        "device_stats" => to_json(stats::device_stats(arg(&a, "serial")?).await),
        "screenshot" => {
            let serial: String = arg(&a, "serial")?;
            blocking(app, move |_| stats::screenshot_png(&serial)).await?.map(Reply::Bytes)
        }
        "wake_screen" => to_json(stats::wake_screen(arg(&a, "serial")?).await),
        "setup_status" => to_json(setup::setup_status().await),
        "setup_install" => to_json(setup::setup_install(app.clone(), arg(&a, "tool")?).await),
        "install_udev_rule" => to_json(setup::phone::install_udev_rule().await),
        "phone_info" => to_json(setup::phone::phone_info(arg(&a, "serial")?).await),
        "install_helper_apks" => to_json(setup::phone::install_helper_apks(arg(&a, "serial")?).await),
        "web_info" => to_json(Ok(web_info(app.state()))),
        "get_safety" => to_json(blocking(app, |x| crate::get_safety(x.state())).await?),
        "set_safety" => {
            let safety: crate::safety::Safety = arg(&a, "safety")?;
            to_json(blocking(app, move |x| crate::set_safety(x.state(), safety)).await?)
        }
        "usage_today" => {
            let (serial, username): (String, String) = (arg(&a, "serial")?, arg(&a, "username")?);
            to_json(blocking(app, move |x| crate::usage_today(x.state(), serial, username)).await?)
        }
        other => Err(format!("Unknown command: {other}")),
    }
}

// ---------- events ----------

async fn events_ws(
    State(ctx): State<Ctx>,
    headers: HeaderMap,
    Query(q): Query<TokenQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    // Browsers can't set headers on a WebSocket, so the token comes in the query.
    if !authorized(&ctx, &headers, q.token.as_deref()) {
        return unauthorized();
    }
    let rx = ctx.events.subscribe();
    ws.on_upgrade(move |socket| forward_events(socket, rx))
}

/// Live, controllable screen for one phone (see `mirror.rs`).
async fn mirror_ws(
    State(ctx): State<Ctx>,
    Path(serial): Path<String>,
    headers: HeaderMap,
    Query(q): Query<MirrorQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    if !authorized(&ctx, &headers, q.token.as_deref()) {
        return unauthorized();
    }
    let max = q.max.unwrap_or(1024).clamp(240, 2400);
    let opts = crate::mirror::Options { max_size: max, video: q.video != Some(0), audio: q.audio == Some(1) };
    ws.on_upgrade(move |socket| crate::mirror::serve(socket, serial, opts))
}

async fn forward_events(mut socket: WebSocket, mut rx: broadcast::Receiver<String>) {
    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Ok(text) => {
                    if socket.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                // Too slow to keep up: skip what was missed, keep going.
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            },
            // The browser closed the socket (or sent something we ignore).
            incoming = socket.recv() => if !matches!(incoming, Some(Ok(_))) { break },
        }
    }
}

// ---------- UI files ----------

async fn static_file(State(ctx): State<Ctx>, uri: Uri) -> Response {
    let path = match uri.path().trim_start_matches('/') {
        "" => "index.html",
        p => p,
    };
    if path.split('/').any(|seg| seg == "..") {
        return StatusCode::NOT_FOUND.into_response();
    }
    // Release builds embed the UI; dev builds read app/dist (run `npm --prefix app run build`).
    if let Some(asset) = ctx.app.asset_resolver().get(path.to_string()) {
        return ([(header::CONTENT_TYPE, asset.mime_type().to_string())], asset.bytes().to_vec()).into_response();
    }
    let file = dist_dir().join(path);
    match std::fs::read(&file) {
        Ok(bytes) => {
            let mime = mime_guess::from_path(&file).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.to_string())], bytes).into_response()
        }
        Err(_) if path == "index.html" => (
            StatusCode::SERVICE_UNAVAILABLE,
            "The web UI isn't built yet. Run `npm --prefix app run build`, then reload.",
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

fn dist_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")
}

// ---------- helpers ----------

/// Kept in the data dir so bookmarked links keep working across restarts.
fn load_or_create_token(data_dir: &FsPath) -> String {
    let path = data_dir.join("web-token");
    if let Ok(t) = std::fs::read_to_string(&path) {
        let t = t.trim();
        if t.len() >= 32 {
            return t.to_string();
        }
    }
    let token = random_hex(24);
    let _ = std::fs::write(&path, &token);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    token
}

fn random_hex(n: usize) -> String {
    use std::io::Read;
    let mut buf = vec![0u8; n];
    let ok = std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut buf)).is_ok();
    if !ok {
        // No /dev/urandom (not Linux/macOS): fall back to std's randomly seeded hasher.
        use std::hash::{BuildHasher, Hasher};
        for chunk in buf.chunks_mut(8) {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u64(std::time::SystemTime::now().elapsed().map(|d| d.as_nanos() as u64).unwrap_or(0));
            chunk.copy_from_slice(&h.finish().to_le_bytes()[..chunk.len()]);
        }
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// This machine's useful IPv4 addresses: LAN and Tailscale, not Docker or VM bridges.
fn local_ips() -> Vec<String> {
    let out = std::process::Command::new("ip").args(["-o", "-4", "addr", "show"]).output();
    let mut ips = out.map(|o| useful_ips(&String::from_utf8_lossy(&o.stdout))).unwrap_or_default();
    if ips.is_empty() {
        ips.push("127.0.0.1".into());
    }
    ips
}

/// Lines look like `2: eno1    inet 192.168.1.88/24 brd ...`.
fn useful_ips(text: &str) -> Vec<String> {
    const SKIP: [&str; 9] = ["lo", "docker", "br-", "veth", "virbr", "lxc", "cni", "podman", "vmnet"];
    text.lines()
        .filter_map(|l| {
            let mut parts = l.split_whitespace();
            let iface = parts.nth(1)?;
            let ip = parts.nth(1)?.split('/').next()?;
            (!SKIP.iter().any(|p| iface.starts_with(p))).then(|| ip.to_string())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_tokens() {
        assert!(same(b"abc", b"abc"));
        assert!(!same(b"abc", b"abd"));
        assert!(!same(b"abc", b"abcd"));
    }

    #[test]
    fn keeps_lan_and_tailscale_only() {
        let text = "1: lo    inet 127.0.0.1/8 scope host lo\n\
                    2: eno1    inet 192.168.1.88/24 brd 192.168.1.255\n\
                    3: tailscale0    inet 100.102.220.47/32 scope global\n\
                    4: docker0    inet 172.17.0.1/16 brd 172.17.255.255\n\
                    5: br-f9288d46e376    inet 172.23.0.1/16 brd 172.23.255.255\n";
        assert_eq!(useful_ips(text), ["192.168.1.88", "100.102.220.47"]);
    }

    #[test]
    fn makes_random_tokens() {
        let (a, b) = (random_hex(24), random_hex(24));
        assert_eq!(a.len(), 48);
        assert_ne!(a, b);
    }
}
