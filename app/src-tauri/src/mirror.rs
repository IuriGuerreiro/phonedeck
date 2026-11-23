//! Live, controllable phone screen: runs scrcpy's server on the phone and relays its
//! H.264 stream and control channel over a WebSocket (see `web.rs`, `/api/mirror/<serial>`).
//! The page decodes the video with WebCodecs and sends touches/keys back as JSON.
//!
//! Each WebSocket gets its own scrcpy session; closing the socket ends it.
//!
//! To the page:
//! - text  `{"type":"meta","name":"Pixel 6","codec":"h264"}` once
//! - text  `{"type":"size","width":360,"height":800}` at start and on rotation
//! - binary `[flags][H.264 Annex B bytes]` per packet; flags bit 0 = config (SPS/PPS), bit 1 = keyframe
//! - text  `{"type":"error","message":"..."}` then close, when something fails
//!
//! From the page (text JSON), coordinates in video pixels:
//! - `{"t":"touch","action":"down|move|up","x":10,"y":20,"w":360,"h":800}`
//! - `{"t":"scroll","x":..,"y":..,"w":..,"h":..,"dx":0,"dy":-1}`
//! - `{"t":"key","keycode":3}` (press + release), `{"t":"text","text":"hi"}`, `{"t":"back"}`
use std::{
    process::{Child, Command, Stdio},
    sync::OnceLock,
    time::Duration,
};

use axum::extract::ws::{Message, WebSocket};
use serde::Deserialize;
use serde_json::json;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use crate::adb::{adb_path, run as adb};

/// scrcpy's version, e.g. "5.0.1". The server only talks to a client of the same version.
fn scrcpy_version() -> Result<String, String> {
    static V: OnceLock<Result<String, String>> = OnceLock::new();
    V.get_or_init(|| {
        let out = Command::new(crate::setup::scrcpy_bin())
            .arg("--version")
            .output()
            .map_err(|_| "scrcpy isn't installed. Install it from Setup → This PC.".to_string())?;
        // "scrcpy 5.0.1 <https://github.com/Genymobile/scrcpy>"
        String::from_utf8_lossy(&out.stdout)
            .split_whitespace()
            .nth(1)
            .map(str::to_string)
            .ok_or_else(|| "Could not read the scrcpy version".to_string())
    })
    .clone()
}

/// Server process and adb forward for one session. Cleaned up on drop.
struct Session {
    serial: String,
    port: u16,
    child: Child,
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = adb(&self.serial, &["forward", "--remove", &format!("tcp:{}", self.port)]);
    }
}

/// Blocking: push the server, forward a port, start it. Returns once the process is spawned.
/// `light`: the page can't decode video (control only), so keep the stream tiny.
fn start_server(serial: &str, max_size: u32, light: bool) -> Result<Session, String> {
    let version = scrcpy_version()?;
    let jar = crate::setup::scrcpy_server().ok_or("scrcpy-server is missing. Reinstall scrcpy from Setup.")?;
    // 31-bit id, unique per session so several viewers can run at once.
    let scid = format!("{:08x}", rand_u32() & 0x7fff_ffff);
    // The server deletes its jar on start, so push a fresh copy every time.
    let remote = format!("/data/local/tmp/sma-scrcpy-{scid}.jar");
    adb(serial, &["push", &jar.to_string_lossy(), &remote])?;

    let port = free_port()?;
    adb(serial, &["forward", &format!("tcp:{port}"), &format!("localabstract:scrcpy_{scid}")])?;

    let (fps, bit_rate) = if light { (5, 300_000) } else { (30, 4_000_000) };
    let child = Command::new(adb_path())
        .args(["-s", serial, "shell"])
        .arg(format!(
            "CLASSPATH={remote} app_process / com.genymobile.scrcpy.Server {version} scid={scid} \
             log_level=warn tunnel_forward=true audio=false control=true video_codec=h264 \
             max_size={max_size} max_fps={fps} video_bit_rate={bit_rate} power_off_on_close=false"
        ))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start scrcpy on the phone: {e}"))?;
    Ok(Session { serial: serial.to_string(), port, child })
}

/// Video socket: connect until the server answers with its dummy byte (it takes ~1s to start).
async fn connect_video(port: u16) -> Result<TcpStream, String> {
    for _ in 0..50 {
        if let Ok(mut s) = TcpStream::connect(("127.0.0.1", port)).await {
            let mut b = [0u8; 1];
            // Before the server listens, adb accepts and then closes right away.
            if s.read_exact(&mut b).await.is_ok() {
                return Ok(s);
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("The phone's screen server didn't start. Is the phone unlocked and connected?".into())
}

/// Runs one mirror session for `socket` until either side closes.
/// `send_video: false` is control only: the page shows screenshots (it has no WebCodecs,
/// e.g. plain-HTTP pages on another device) but still gets sizes and sends input.
pub async fn serve(mut socket: WebSocket, serial: String, max_size: u32, send_video: bool) {
    if let Err(e) = run(&mut socket, serial, max_size, send_video).await {
        let _ = socket.send(Message::Text(json!({ "type": "error", "message": e }).to_string().into())).await;
    }
    let _ = socket.send(Message::Close(None)).await;
}

async fn run(socket: &mut WebSocket, serial: String, max_size: u32, send_video: bool) -> Result<(), String> {
    let s = serial.clone();
    let session = tauri::async_runtime::spawn_blocking(move || start_server(&s, max_size, !send_video))
        .await
        .map_err(|e| e.to_string())??;

    let mut video = connect_video(session.port).await?;
    let mut control = TcpStream::connect(("127.0.0.1", session.port)).await.map_err(|e| e.to_string())?;

    let mut name = [0u8; 64];
    video.read_exact(&mut name).await.map_err(io)?;
    let mut codec = [0u8; 4];
    video.read_exact(&mut codec).await.map_err(io)?;
    let name = String::from_utf8_lossy(&name).trim_end_matches('\0').to_string();
    let meta = json!({ "type": "meta", "name": name, "codec": String::from_utf8_lossy(&codec) });
    socket.send(Message::Text(meta.to_string().into())).await.map_err(io)?;

    let mut header = [0u8; 12];
    loop {
        tokio::select! {
            r = video.read_exact(&mut header) => {
                r.map_err(|_| "The phone closed the screen stream".to_string())?;
                match parse_header(&header) {
                    Header::Size { width, height } => {
                        let msg = json!({ "type": "size", "width": width, "height": height });
                        socket.send(Message::Text(msg.to_string().into())).await.map_err(io)?;
                    }
                    Header::Packet { config, key, size } => {
                        let mut buf = vec![0u8; size + 1];
                        buf[0] = u8::from(config) | (u8::from(key) << 1);
                        video.read_exact(&mut buf[1..]).await.map_err(io)?;
                        if send_video {
                            socket.send(Message::Binary(buf.into())).await.map_err(io)?;
                        }
                    }
                }
            }
            msg = socket.recv() => match msg {
                Some(Ok(Message::Text(text))) => {
                    if let Ok(input) = serde_json::from_str::<Input>(&text) {
                        for bytes in encode(&input) {
                            control.write_all(&bytes).await.map_err(io)?;
                        }
                    }
                }
                Some(Ok(_)) => {}
                // Page closed: drop the session (kills the server, removes the forward).
                _ => break,
            },
        }
    }
    drop(session);
    Ok(())
}

fn io(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ---------- stream format ----------

#[derive(Debug, PartialEq)]
enum Header {
    /// Top bit set: a new video session (start, rotation): `[u32 flags][u32 width][u32 height]`.
    Size { width: u32, height: u32 },
    /// `[u64 pts + flags][u32 size]`; bit 62 = config, bit 61 = keyframe.
    Packet { config: bool, key: bool, size: usize },
}

fn parse_header(h: &[u8; 12]) -> Header {
    let u32_at = |i: usize| u32::from_be_bytes(h[i..i + 4].try_into().unwrap());
    if h[0] & 0x80 != 0 {
        return Header::Size { width: u32_at(4), height: u32_at(8) };
    }
    let pts_flags = u64::from_be_bytes(h[..8].try_into().unwrap());
    Header::Packet {
        config: pts_flags & (1 << 62) != 0,
        key: pts_flags & (1 << 61) != 0,
        size: u32_at(8) as usize,
    }
}

// ---------- control messages ----------

#[derive(Deserialize, Debug)]
#[serde(tag = "t", rename_all = "lowercase")]
enum Input {
    Touch { action: String, x: i32, y: i32, w: u16, h: u16 },
    Scroll { x: i32, y: i32, w: u16, h: u16, dx: f32, dy: f32 },
    Key { keycode: u32 },
    Text { text: String },
    Back,
}

/// scrcpy's "generic finger" pointer: injected as a touch, not a mouse.
const POINTER_FINGER: u64 = (-2i64) as u64;

/// Binary control messages (big-endian), as scrcpy's client sends them.
fn encode(input: &Input) -> Vec<Vec<u8>> {
    match input {
        Input::Touch { action, x, y, w, h } => {
            let (code, pressure) = match action.as_str() {
                "down" => (0u8, 0xffffu16),
                "up" => (1, 0),
                _ => (2, 0xffff),
            };
            let mut m = vec![2u8, code];
            m.extend(POINTER_FINGER.to_be_bytes());
            m.extend(x.to_be_bytes());
            m.extend(y.to_be_bytes());
            m.extend(w.to_be_bytes());
            m.extend(h.to_be_bytes());
            m.extend(pressure.to_be_bytes());
            m.extend(0u32.to_be_bytes()); // action button
            m.extend(0u32.to_be_bytes()); // buttons
            vec![m]
        }
        Input::Scroll { x, y, w, h, dx, dy } => {
            // Scroll amounts are 16-bit fixed point in [-1, 1].
            let fixed = |v: f32| ((v.clamp(-1.0, 1.0) * 32767.0) as i16).to_be_bytes();
            let mut m = vec![3u8];
            m.extend(x.to_be_bytes());
            m.extend(y.to_be_bytes());
            m.extend(w.to_be_bytes());
            m.extend(h.to_be_bytes());
            m.extend(fixed(*dx));
            m.extend(fixed(*dy));
            m.extend(0u32.to_be_bytes()); // buttons
            vec![m]
        }
        Input::Key { keycode } => [0u8, 1]
            .iter()
            .map(|&action| {
                let mut m = vec![0u8, action];
                m.extend(keycode.to_be_bytes());
                m.extend(0u32.to_be_bytes()); // repeat
                m.extend(0u32.to_be_bytes()); // meta state
                m
            })
            .collect(),
        Input::Text { text } => {
            // scrcpy caps injected text at 300 bytes per message.
            let mut out = vec![];
            let mut chunk = String::new();
            for c in text.chars() {
                if chunk.len() + c.len_utf8() > 300 {
                    out.push(text_msg(&chunk));
                    chunk.clear();
                }
                chunk.push(c);
            }
            if !chunk.is_empty() {
                out.push(text_msg(&chunk));
            }
            out
        }
        // "Back, or turn the screen on": press then release.
        Input::Back => vec![vec![4u8, 0], vec![4u8, 1]],
    }
}

fn text_msg(s: &str) -> Vec<u8> {
    let mut m = vec![1u8];
    m.extend((s.len() as u32).to_be_bytes());
    m.extend(s.as_bytes());
    m
}

// ---------- helpers ----------

fn free_port() -> Result<u16, String> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .map_err(|e| format!("No free port: {e}"))
}

fn rand_u32() -> u32 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    h.finish() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_headers_from_a_real_stream() {
        // Captured from scrcpy 5.0.1 on a Xiaomi phone.
        let size = [0x80, 0, 0, 0, 0, 0, 0x01, 0x68, 0, 0, 0x03, 0x20];
        assert_eq!(parse_header(&size), Header::Size { width: 360, height: 800 });
        let config = [0x40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1f];
        assert_eq!(parse_header(&config), Header::Packet { config: true, key: false, size: 31 });
        let key = [0x20, 0, 0, 0x19, 0xc4, 0x48, 0x56, 0x50, 0, 0, 0x17, 0x40];
        assert_eq!(parse_header(&key), Header::Packet { config: false, key: true, size: 5952 });
    }

    #[test]
    fn encodes_touch_like_scrcpy() {
        let m = encode(&Input::Touch { action: "down".into(), x: 180, y: 400, w: 360, h: 800 });
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].len(), 32);
        assert_eq!(&m[0][..2], &[2, 0]);
        assert_eq!(&m[0][10..14], &180i32.to_be_bytes());
        assert_eq!(&m[0][18..20], &360u16.to_be_bytes());
    }

    #[test]
    fn encodes_key_press_and_release() {
        let m = encode(&Input::Key { keycode: 3 });
        assert_eq!(m.len(), 2);
        assert_eq!(m[0][..6], [0, 0, 0, 0, 0, 3]);
        assert_eq!(m[1][1], 1);
        assert_eq!(m[0].len(), 14);
    }

    #[test]
    fn splits_long_text() {
        let m = encode(&Input::Text { text: "a".repeat(650) });
        assert_eq!(m.len(), 3);
        assert_eq!(m[0][1..5], 300u32.to_be_bytes());
    }

    #[test]
    fn reads_page_input() {
        let i: Input = serde_json::from_str(r#"{"t":"scroll","x":1,"y":2,"w":3,"h":4,"dx":0,"dy":-1}"#).unwrap();
        assert_eq!(encode(&i)[0].len(), 21);
        assert!(serde_json::from_str::<Input>(r#"{"t":"back"}"#).is_ok());
    }
}
