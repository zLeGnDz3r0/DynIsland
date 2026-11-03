//! Integración con SMTC (System Media Transport Controls) de Windows:
//! lee la pista que reproduce CUALQUIER app (Spotify, Chrome, etc.) y controla
//! play/pause/siguiente/anterior de forma centralizada.
//!
//! Regla anti-cuelgues: en Tauri 2 los comandos síncronos se ejecutan en el
//! HILO PRINCIPAL. Una llamada WinRT bloqueante ahí interbloquea el proceso.
//! Por eso TODO el WinRT vive en hilos propios y los comandos son async con
//! timeout.
//!
//! Bajo consumo: nos suscribimos a los eventos PUSH de SMTC
//! (PlaybackInfoChanged / MediaPropertiesChanged / SessionsChanged). Windows
//! nos avisa solo cuando algo cambia: 0 CPU en reposo, sin polling. El último
//! estado se persiste en disco para recordar "hubo reproducción en las
//! últimas 2 h" aunque se reinicie la app.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct Track {
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub position: u64, // ms
    #[serde(default)]
    pub duration: u64, // ms
    #[serde(default)]
    pub playing: bool,
    #[serde(default)]
    pub thumb: Option<String>, // data: URL
    #[serde(default)]
    pub last_play_ms: u64, // epoch ms de la última vez que estuvo sonando
    #[serde(default)]
    pub source: String,    // app que reproduce ("Spotify", "Chrome", ...)
}

/// Convierte el AppUserModelId de la sesión en un nombre legible.
fn friendly_source(aumid: &str) -> String {
    let lower = aumid.to_lowercase();
    if lower.contains("spotify") {
        "Spotify".into()
    } else if lower.contains("ytmusic") || lower.contains("youtubemusic") {
        "YouTube Music".into()
    } else if lower.contains("youtube") {
        "YouTube".into()
    } else if lower.contains("twitch") {
        "Twitch".into()
    } else if lower.contains("msedge") || lower.contains("microsoftedge") {
        "Edge".into()
    } else if lower.contains("chrome") {
        "Chrome".into()
    } else if lower.contains("firefox") {
        "Firefox".into()
    } else if lower.contains("brave") {
        "Brave".into()
    } else if lower.contains("vivaldi") {
        "Vivaldi".into()
    } else if lower.contains("vlc") {
        "VLC".into()
    } else if lower.contains("foobar2000") {
        "foobar2000".into()
    } else if lower.contains("winamp") {
        "Winamp".into()
    } else if lower.contains("mediaplayer") || lower.contains("wmplayer") {
        "Reproductor multimedia".into()
    } else {
        // Última oportunidad: quitar .exe y rutas, capitalizar.
        let tail = aumid.rsplit(['!', '\\', '/']).next().unwrap_or(aumid);
        let tail = tail.trim_end_matches(".exe");
        if tail.is_empty() { return String::new(); }
        let mut c = tail.chars();
        match c.next() {
            Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            None => String::new(),
        }
    }
}

static ACTIVE: AtomicBool = AtomicBool::new(false);
static APP: OnceLock<AppHandle> = OnceLock::new();
static STATE: OnceLock<Mutex<Track>> = OnceLock::new();

fn state() -> &'static Mutex<Track> {
    STATE.get_or_init(|| Mutex::new(Track::default()))
}
static WAKE_TX: OnceLock<Sender<()>> = OnceLock::new();

#[cfg(windows)]
mod smtc {
    use super::Track;
    use std::sync::{Mutex, OnceLock};
    use windows::Foundation::TypedEventHandler;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Mgr, MediaPropertiesChangedEventArgs,
        PlaybackInfoChangedEventArgs, SessionsChangedEventArgs,
    };
    use windows::Storage::Streams::DataReader;

    // Referencias mantenidas vivas para que los eventos sigan llegando.
    pub static MGR: OnceLock<Mgr> = OnceLock::new();
    pub static KEEP: Mutex<Vec<Session>> = Mutex::new(Vec::new());

    /// Snapshot WinRT de una sesión concreta (bloqueante: llamar SIEMPRE desde
    /// un hilo de fondo, jamás desde el hilo principal de Tauri).
    pub fn snapshot_of(session: &Session) -> Track {
        let mut result = Track::default();
        let mut read = || -> Option<()> {
            let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
            result.title = props.Title().map(|s| s.to_string()).unwrap_or_default();
            result.artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
            if let Ok(tl) = session.GetTimelineProperties() {
                result.position = (tl.Position().map(|t| t.Duration).unwrap_or(0) / 10_000) as u64;
                let end = (tl.EndTime().map(|t| t.Duration).unwrap_or(0) / 10_000) as u64;
                if end > 0 { result.duration = end; }
            }
            result.playing = session.GetPlaybackInfo().ok()
                .and_then(|i| i.PlaybackStatus().ok())
                .map(|s| s == windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
                .unwrap_or(false);
            result.source = session.SourceAppUserModelId()
                .map(|s| super::friendly_source(&s.to_string()))
                .unwrap_or_default();
            if let Ok(thumb) = props.Thumbnail() {
                if let Ok(op) = thumb.OpenReadAsync() {
                    if let Ok(stream) = op.get() {
                        let size = stream.Size().unwrap_or(0);
                        if size > 0 && size < 2_000_000 {
                            if let Ok(input) = stream.GetInputStreamAt(0) {
                                if let Ok(reader) = DataReader::CreateDataReader(&input) {
                                    if reader.LoadAsync(size as u32).and_then(|o| o.get()).is_ok() {
                                        let mut buf = vec![0u8; size as usize];
                                        if reader.ReadBytes(&mut buf).is_ok() {
                                            let b64 = super::b64(&buf);
                                            result.thumb = Some(format!("data:image/jpeg;base64,{b64}"));
                                        }
                                    }
                                    let _ = reader.DetachStream();
                                }
                            }
                        }
                    }
                }
            }
            Some(())
        };
        read();
        result
    }

    pub fn snapshot() -> Track {
        match MGR.get() {
            Some(mgr) => match mgr.GetCurrentSession() {
                Ok(s) => snapshot_of(&s),
                Err(_) => Track::default(),
            },
            None => Track::default(),
        }
    }

    /// Suscripción push a cambios de SMTC (cero polling). Solo notifica
    /// `note()` cuando Windows detecta un cambio real.
    pub fn subscribe(mgr: &Mgr) -> windows::core::Result<()> {
        // Cambios de sesión (app abre/cierra, cambia la sesión activa):
        let _ = mgr.SessionsChanged(&TypedEventHandler::new(
            |sender: &Option<Mgr>, _: &Option<SessionsChangedEventArgs>| {
                if let Some(m) = sender {
                    if let Ok(s) = m.GetCurrentSession() {
                        subscribe_session(&s);
                        super::note(snapshot_of(&s));
                    }
                }
                Ok(())
            },
        ));
        if let Ok(s) = mgr.GetCurrentSession() {
            subscribe_session(&s);
        }
        Ok(())
    }

    fn subscribe_session(s: &Session) {
        let s1 = s.clone();
        let _ = s.PlaybackInfoChanged(&TypedEventHandler::new(
            move |_: &Option<Session>, _: &Option<PlaybackInfoChangedEventArgs>| {
                super::note(snapshot_of(&s1));
                Ok(())
            },
        ));
        let s2 = s.clone();
        let _ = s.MediaPropertiesChanged(&TypedEventHandler::new(
            move |_: &Option<Session>, _: &Option<MediaPropertiesChangedEventArgs>| {
                super::note(snapshot_of(&s2));
                Ok(())
            },
        ));
        KEEP.lock().unwrap().push(s.clone());
    }
}

#[cfg(windows)]
use smtc::{snapshot, snapshot_of};

#[cfg(windows)]
fn control(cmd: &'static str) {
    std::thread::spawn(move || {
        let Some(mgr) = smtc::MGR.get() else { return };
        let Ok(s) = mgr.GetCurrentSession() else { return };
        let fire = |r: windows::core::Result<windows::Foundation::IAsyncOperation<bool>>| {
            if let Ok(op) = r { let _ = op.get(); }
        };
        match cmd {
            "playpause" => {
                let t = snapshot_of(&s);
                if t.playing { fire(s.TryPauseAsync()); } else { fire(s.TryPlayAsync()); }
            }
            "next" => fire(s.TrySkipNextAsync()),
            "prev" => fire(s.TrySkipPreviousAsync()),
            _ => {}
        }
    });
}

#[cfg(any(target_os = "linux", test))]
mod mpris {
    use super::Track;
    use std::io::Read;
    use std::process::{Command, Stdio};

    // Ubuntu/Debian provide GNU timeout in coreutils. No shell is involved;
    // every argument (including player names) is passed literally.
    fn query(args: &[&str]) -> Option<String> {
        let mut child = Command::new("timeout")
            .args(["--kill-after=1s", "1s", "playerctl"])
            .args(args)
            .stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().ok()?;
        let mut output = Vec::new();
        let read = child.stdout.take()?.take(16_385).read_to_end(&mut output);
        let status = child.wait().ok()?;
        if read.is_err() || !status.success() || output.len() > 16_384 {
            return None;
        }
        String::from_utf8(output).ok()
            .map(|s| s.trim_end_matches(['\r', '\n']).to_owned())
    }

    fn microseconds_to_ms(value: &str) -> u64 {
        value.parse::<f64>().ok()
            .filter(|n| n.is_finite() && *n >= 0.0)
            .map(|n| (n / 1000.0) as u64)
            .unwrap_or(0)
    }

    fn parse_header(text: &str) -> Option<Track> {
        let parts: Vec<&str> = text.split('\t').collect();
        if parts.len() != 4 || parts[0].is_empty()
            || !matches!(parts[1], "Playing" | "Paused" | "Stopped") {
            return None;
        }
        Some(Track {
            source: parts[0].into(),
            playing: parts[1] == "Playing",
            position: microseconds_to_ms(parts[2]),
            duration: microseconds_to_ms(parts[3]),
            ..Track::default()
        })
    }

    pub fn snapshot() -> Track {
        let Some(header) = query(&[
            "metadata", "--format",
            "{{playerName}}\t{{status}}\t{{position}}\t{{mpris:length}}",
        ]) else { return Track::default() };
        let Some(mut track) = parse_header(&header) else { return Track::default() };
        // Text fields are queried separately: tabs/newlines in a title or artist
        // cannot be mistaken for structural metadata. Pin the selected player.
        let player = track.source.clone();
        track.title = query(&["--player", &player, "metadata", "--format", "{{trunc(title, 512)}}"])
            .unwrap_or_default();
        track.artist = query(&["--player", &player, "metadata", "--format", "{{trunc(artist, 512)}}"])
            .unwrap_or_default();
        track.source = super::friendly_source(&player);
        track
    }

    pub fn control(action: &'static str) {
        let command = match action {
            "playpause" => "play-pause",
            "next" => "next",
            "prev" => "previous",
            _ => return,
        };
        std::thread::spawn(move || { let _ = query(&[command]); });
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn parses_mpris_microseconds_and_status() {
            let t = parse_header("spotify\tPlaying\t1250000\t180000000").unwrap();
            assert_eq!(t.source, "spotify");
            assert!(t.playing);
            assert_eq!(t.position, 1250);
            assert_eq!(t.duration, 180000);
            assert!(!parse_header("vlc\tPaused\t0\t").unwrap().playing);
        }

        #[test]
        fn rejects_malformed_headers_and_invalid_times() {
            assert!(parse_header("spotify\tPlaying\t0").is_none());
            assert!(parse_header("spotify\tUnknown\t0\t0").is_none());
            assert!(parse_header("\tPlaying\t0\t0").is_none());
            assert_eq!(microseconds_to_ms("NaN"), 0);
            assert_eq!(microseconds_to_ms("-1"), 0);
            assert_eq!(microseconds_to_ms(""), 0);
        }
    }
}

#[cfg(target_os = "linux")]
use mpris::{snapshot, control};

#[cfg(not(any(windows, target_os = "linux")))]
fn snapshot() -> Track { Track::default() }
#[cfg(not(any(windows, target_os = "linux")))]
fn control(_: &'static str) {}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Registra un nuevo estado de reproducción: actualiza memoria, emite a la UI
/// y persiste en disco SOLO si algo relevante cambió (escrituras raras).
pub fn note(t: Track) {
    let mut st = state().lock().unwrap();
    let mut t = t;
    if t.last_play_ms == 0 { t.last_play_ms = st.last_play_ms; }
    let changed = st.title != t.title || st.artist != t.artist
        || st.playing != t.playing || st.thumb != t.thumb;
    if t.playing { t.last_play_ms = now_ms(); }
    let is_new_play = t.playing && !st.playing;
    *st = t;
    let snapshot = st.clone();
    drop(st);
    if changed || is_new_play {
        persist(&snapshot);
    }
    if let Some(app) = APP.get() {
        let _ = app.emit("media-track", &snapshot);
    }
}

fn persist(t: &Track) {
    use std::io::Write;
    if let Some(app) = APP.get() {
        if let Ok(dir) = app.path().app_data_dir() {
            let _ = std::fs::create_dir_all(&dir);
            if let Ok(mut f) = std::fs::File::create(dir.join("lasttrack.json")) {
                let _ = f.write_all(serde_json::to_string(t).unwrap_or_default().as_bytes());
            }
        }
    }
}

fn load_persisted() {
    if let Some(app) = APP.get() {
        if let Ok(dir) = app.path().app_data_dir() {
            if let Ok(txt) = std::fs::read_to_string(dir.join("lasttrack.json")) {
                if let Ok(t) = serde_json::from_str::<Track>(&txt) {
                    *state().lock().unwrap() = t;
                }
            }
        }
    }
}

/// Estado cacheado para la píldora pequeña: SIN llamadas WinRT (instantáneo,
/// seguro incluso en el hilo principal). `recent` = sonando ahora o hubo
/// reproducción en las últimas 2 h.
#[tauri::command]
pub fn pill_snapshot() -> Track {
    state().lock().unwrap().clone()
}

/// Marca el widget de música como visible/no (activa el polling de 2 s solo
/// mientras está desplegado).
#[tauri::command]
pub fn media_set_active(active: bool) {
    ACTIVE.store(active, Ordering::SeqCst);
    if active {
        if let Some(tx) = WAKE_TX.get() {
            let _ = tx.send(());
        }
    }
}

/// Consulta puntual de la pista actual. Async (hilo del runtime, no el
/// principal) y con timeout: si SMTC tarda >1,5 s se devuelve el cache.
#[tauri::command]
pub async fn media_snapshot() -> Track {
    let cached = state().lock().unwrap().clone();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || { let _ = tx.send(snapshot()); });
    match rx.recv_timeout(Duration::from_millis(1500)) {
        Ok(t) => { note(t.clone()); t }
        Err(_) => cached,
    }
}

#[tauri::command]
pub fn media_control(action: String) {
    match action.as_str() {
        "playpause" => control("playpause"),
        "next" => control("next"),
        "prev" => control("prev"),
        _ => {}
    }
}

pub fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for c in data.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Hilo de arranque de SMTC + bucle de polling del widget.
pub fn start(app: AppHandle) {
    let _ = APP.set(app.clone());
    load_persisted();
    let (tx, rx) = mpsc::channel::<()>();
    let _ = WAKE_TX.set(tx);
    std::thread::spawn(move || {
        #[cfg(windows)]
        {
            // Inicializa COM/WinRT en este hilo (MTA) y suscribe los eventos.
            use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
            unsafe { let _ = RoInitialize(RO_INIT_MULTITHREADED); }
            loop {
                if let Ok(op) = windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
                    if let Ok(mgr) = op.get() {
                        let _ = smtc::subscribe(&mgr);
                        let _ = smtc::MGR.set(mgr);
                        break;
                    }
                }
                std::thread::sleep(Duration::from_secs(30)); // SMTC aún no listo
            }
        }
        // Linux MPRIS is sampled every 15 s while collapsed to keep the pill
        // current, and every 2 s while visible. Windows retains push events.
        loop {
            if !ACTIVE.load(Ordering::SeqCst) {
                #[cfg(target_os = "linux")]
                {
                    note(snapshot());
                    let _ = rx.recv_timeout(Duration::from_secs(15));
                }
                #[cfg(not(target_os = "linux"))]
                {
                // Espera pasiva hasta activación (sin wakeups).
                let _ = rx.recv();
                }
                continue;
            }
            note(snapshot());
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}
