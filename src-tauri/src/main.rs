// DynIsland — Dynamic Island de escritorio ultraligera.
// Sin bucles de animación en CPU: todo evento-driven, la UI anima con la GPU (CSS transforms).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod media;
mod shelf;
mod store;
mod sysinfo;
mod winctl;

/// Garantiza una ÚNICA instancia: mutex con nombre de Windows. Si ya hay una
/// isla corriendo, el segundo proceso sale silenciosamente. Sin crates extra.
#[cfg(windows)]
fn ensure_single_instance() {
    use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows::Win32::System::Threading::CreateMutexW;
    use windows::core::w;
    let created = unsafe { CreateMutexW(None, false, w!("Local\\DynIsland.Singleton")) };
    let already = created.is_err() || unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
    if already {
        std::process::exit(0);
    }
    // El handle del mutex vive mientras viva el proceso (nunca se cierra).
}

#[cfg(not(windows))]
fn ensure_single_instance() {}

fn main() {
    // Window placement is available through X11/XWayland. Native Wayland
    // compositors do not allow a regular application to position its island.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("DISPLAY").is_none() {
            eprintln!("DynIsland requires X11 or XWayland (DISPLAY is not set).");
            std::process::exit(1);
        }
        if std::env::var_os("GDK_BACKEND").is_none() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
    }
    ensure_single_instance();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            winctl::set_island_bounds,
            winctl::quit_app,
            sysinfo::get_status,
            media::media_snapshot,
            media::media_control,
            media::media_set_active,
            media::pill_snapshot,
            store::store_get,
            store::store_set,
            shelf::open_path,
            shelf::reveal_path,
            shelf::save_to_downloads,
        ])
        .setup(|app| {
            // Arranque: isla oculta (solo franja de detección superior).
            winctl::apply_bounds(app.handle(), "hidden");
            // Estado del sistema (batería/WiFi): 1 llamada por minuto, emite solo si cambió.
            sysinfo::spawn(app.handle().clone());
            // Hilo SMTC dormido en un Condvar: 0 wakeups hasta que el widget de música se abre.
            media::start(app.handle().clone());
            // Zona de archivos: eventos de drag&drop del WebView.
            shelf::watch(app.handle().clone())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DynIsland");
}
