//! Shelf: zona de archivos temporales. Se llena con los eventos de drag&drop
//! del WebView (event-driven, sin polling) y guarda los archivos en un
//! directorio temporal propio para que sigan disponibles tras cerrar la app
//! origen. Los archivos se limpian tras 24 h en el arranque.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Listener, Manager};

#[derive(Clone, serde::Serialize)]
pub struct ShelfItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
}

fn shelf_dir(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let dir = base.join("shelf");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn copy_into_shelf(app: &AppHandle, src: &Path, id: &str) -> Option<ShelfItem> {
    let dir = shelf_dir(app);
    let name = src.file_name()?.to_string_lossy().to_string();
    let dest = dir.join(format!("{id}-{name}"));
    let meta = std::fs::metadata(src).ok()?;

    if meta.is_dir() {
        // Directorios: guardamos la ruta original (copiar árboles enteros sería costoso).
        let item = ShelfItem { id: id.into(), name, path: src.to_string_lossy().to_string(), size: 0, is_dir: true };
        return Some(item);
    }
    if std::fs::copy(src, &dest).is_err() {
        return None;
    }
    Some(ShelfItem { id: id.into(), name, path: dest.to_string_lossy().to_string(), size: meta.len(), is_dir: false })
}

pub fn watch(app: AppHandle) -> tauri::Result<()> {
    // Limpieza de archivos del shelf con más de 24 h (una vez por arranque).
    {
        let dir = shelf_dir(&app);
        if let Ok(entries) = std::fs::read_dir(&dir) {
            let cutoff = SystemTime::now() - Duration::from_secs(60 * 60 * 24);
            for e in entries.flatten() {
                if let Ok(meta) = e.metadata() {
                    if let Ok(modified) = meta.modified() {
                        if modified < cutoff {
                            let _ = std::fs::remove_file(e.path());
                        }
                    }
                }
            }
        }
    }

    let app_handle = app.clone();
    let id = app.listen("tauri://drag-drop", move |event| {
        let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) else { return };
        let paths = payload["paths"].as_array().cloned().unwrap_or_default();
        let mut items = Vec::new();
        let mut n = 0usize;
        for p in paths.iter().take(6) {
            if let Some(s) = p.as_str() {
                let id = format!("{}", SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(n as u128) + n as u128);
                if let Some(item) = copy_into_shelf(&app_handle, Path::new(s), &id) {
                    items.push(item);
                }
            }
            n += 1;
        }
        if !items.is_empty() {
            let _ = app_handle.emit("shelf-items", &items);
        }
    });
    let _keep: &'static u32 = {
        static KEEP: std::sync::OnceLock<u32> = std::sync::OnceLock::new();
        KEEP.get_or_init(|| id)
    };
    Ok(())
}

// Async: spawns de procesos y copias de archivos, siempre fuera del hilo principal.
#[tauri::command]
pub async fn open_path(path: String) {
    let target = PathBuf::from(&path);
    if !target.is_absolute() || !target.exists() {
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::{w, PCWSTR};
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let mut wide: Vec<u16> = target.as_os_str().encode_wide().collect();
        if wide.contains(&0) {
            return;
        }
        wide.push(0);
        // Pass the filename directly to Windows: shell metacharacters remain
        // part of the filename, rather than being interpreted by cmd.exe.
        unsafe {
            let _ = ShellExecuteW(
                HWND::default(),
                w!("open"),
                PCWSTR(wide.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            );
        }
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(&target).spawn();
    }
}

#[tauri::command]
pub async fn reveal_path(path: String) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .creation_flags(0x08000000)
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let target = PathBuf::from(&path);
        if target.is_absolute() && target.exists() {
            let directory = if target.is_dir() { target.as_path() } else { target.parent().unwrap_or(&target) };
            let _ = std::process::Command::new("xdg-open").arg(directory).spawn();
        }
    }
}

/// "Drag out": copia el archivo del shelf a la carpeta Descargas y abre el
/// explorador seleccionándolo (el drag-out real del WebView hacia otras apps
/// no es fiable en Windows; la exportación explícita es el sustituto robusto).
#[tauri::command]
pub async fn save_to_downloads(app: AppHandle, path: String) -> Result<String, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let src = PathBuf::from(&path);
        if !src.exists() {
            return Err("file not found".into());
        }
        let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let dest = dirs_downloads(&app).join(&name);
        std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
        Ok(dest.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn dirs_downloads(app: &AppHandle) -> PathBuf {
    // Tauri resolves localized/XDG download directories on Linux and Windows.
    app.path().download_dir().ok().filter(|d| d.is_dir()).unwrap_or_else(|| shelf_dir(app))
}
