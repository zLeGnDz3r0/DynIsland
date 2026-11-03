//! Control de la geometría de la ventana-isla.
//!
//! La ventana SIEMPRE mide exactamente lo que se ve:
//!   hidden   = franja invisible de detección (hover cerca del borde superior)
//!   pill     = píldora pequeña (hora/batería/WiFi)
//!   expanded = panel completo con widgets
//! Así nunca hay zonas fantasma que roben clics (p. ej. al arrastrar ventanas
//! hacia arriba para maximizarlas con Aero Snap).
//!
//! Anti-cuelgues (Tauri en Windows: redimensionar una ventana transparente
//! desde un hilo de comandos puede interbloquear el bucle de eventos):
//!  1. TODA operación de geometría se ejecuta en el hilo principal mediante
//!     `run_on_main_thread`, serializada con el resto de eventos.
//!  2. Un guard atómico (RESIZING) deduplica tormentas de redimensionado.
//!  3. Si el tamaño objetivo ya es el actual, no se toca la ventana.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

// Mantener sincronizado con src/core/dock.js y src/assets/css/base.css
pub const HIDDEN: (f64, f64) = (360.0, 26.0);
pub const PILL: (f64, f64) = (360.0, 52.0); // misma anchura que HIDDEN y pegada a y=0: zona de hover continua hasta el borde físico (sin parpadeo)
pub const EXPANDED: (f64, f64) = (700.0, 352.0);

static RESIZING: AtomicBool = AtomicBool::new(false);
// Escala del panel expandido (porcentaje 60-150). La guarda el frontend en
// store ("islandScale") y la pasa en cada set_island_bounds("expanded").
static SCALE: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(100);

pub fn apply_bounds(app: &AppHandle, mode: &str) {
    if RESIZING.swap(true, Ordering::SeqCst) {
        return; // ya hay un redimensionado en vuelo: descartar (anti-storm)
    }
    let mode = mode.to_string();
    let app = app.clone();
    let app_inner = app.clone();
    let scheduled = app.run_on_main_thread(move || {
        let done = |v: bool| RESIZING.store(v, Ordering::SeqCst);
        let Some(win) = app_inner.get_webview_window("island") else {
            done(false);
            return;
        };
        let s = SCALE.load(Ordering::SeqCst) as f64 / 100.0;
        let (lw, lh, y_off) = match mode.as_str() {
            "pill" => (PILL.0, PILL.1, 0.0),
            "expanded" => (EXPANDED.0 * s, EXPANDED.1 * s, 8.0),
            _ => (HIDDEN.0, HIDDEN.1, 0.0),
        };

        let monitor = win
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| win.primary_monitor().ok().flatten());
        let (mx, my, mw, sf) = match monitor {
            Some(m) => {
                // Linux panels (GNOME/KDE/etc.) reserve a work area. Position
                // below them so their input region cannot cover the island.
                // X11/XWayland is required: native Wayland does not permit
                // applications to choose absolute window positions.
                #[cfg(target_os = "linux")]
                let (pos, size) = (m.work_area().position, m.work_area().size);
                #[cfg(not(target_os = "linux"))]
                let (pos, size) = (*m.position(), *m.size());
                (pos.x as f64, pos.y as f64, size.width as f64, m.scale_factor())
            }
            None => (0.0, 0.0, 1920.0, 1.0),
        };

        let w = (lw * sf).round() as u32;
        let h = (lh * sf).round() as u32;
        let x = (mx + (mw - w as f64) / 2.0).round() as i32;
        let y = (my + y_off * sf).round() as i32;

        // Deduplicación: si ya está en el tamaño/posición objetivo, no tocar.
        if let (Ok(cur_pos), Ok(cur_size)) = (win.outer_position(), win.inner_size()) {
            if cur_size.width == w && cur_size.height == h && cur_pos.x == x && cur_pos.y == y {
                done(false);
                return;
            }
        }

        let _ = win.set_position(PhysicalPosition::new(x, y));
        let _ = win.set_size(PhysicalSize::new(w, h));
        done(false);
    });
    if scheduled.is_err() {
        RESIZING.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn set_island_bounds(app: AppHandle, mode: String, scale: Option<f64>) {
    if let Some(s) = scale {
        let clamped = s.clamp(0.6, 1.5);
        SCALE.store((clamped * 100.0).round() as u32, Ordering::SeqCst);
    }
    apply_bounds(&app, &mode);
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
