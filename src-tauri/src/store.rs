//! Persistencia mínima: un JSON plano en %APPDATA%\DynIsland\store.json.
//! Solo se escribe cuando el usuario actúa (añadir tarea, beber agua, etc.).

use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

static DB: OnceLock<Mutex<BTreeMap<String, Value>>> = OnceLock::new();
static LOADED: OnceLock<()> = OnceLock::new();

fn db() -> &'static Mutex<BTreeMap<String, Value>> {
    DB.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn store_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("store.json"))
}

fn load_once(app: &AppHandle) {
    LOADED.get_or_init(|| {
        if let Some(path) = store_file(app) {
            if let Ok(txt) = std::fs::read_to_string(&path) {
                if let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<Value>(&txt) {
                    let mut g = db().lock().unwrap();
                    for (k, v) in map {
                        g.entry(k).or_insert(v);
                    }
                }
            }
        }
    });
}

fn persist(app: &AppHandle) {
    if let Some(path) = store_file(app) {
        let snapshot: String = {
            let g = db().lock().unwrap();
            let map: serde_json::Map<String, Value> =
                g.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
            Value::Object(map).to_string()
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, snapshot);
    }
}

// Async => se ejecutan en el pool del runtime, no en el hilo principal:
// un acceso a disco lento nunca puede congelar la ventana.
#[tauri::command]
pub async fn store_get(app: AppHandle, key: String) -> Value {
    load_once(&app);
    db().lock().unwrap().get(&key).cloned().unwrap_or(Value::Null)
}

#[tauri::command]
pub async fn store_set(app: AppHandle, key: String, value: Value) {
    load_once(&app);
    db().lock().unwrap().insert(key, value);
    persist(&app);
}
