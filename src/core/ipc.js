// Puente IPC con Rust (sin bundler: usamos el runtime global de Tauri).
// Tolerante a ejecutarse fuera de Tauri (navegador): los invoke devuelven null
// y los listen son no-ops, para poder depurar la UI sin WebView.
const T = window.__TAURI__;

export const invoke = (cmd, payload) =>
  T ? T.core.invoke(cmd, payload) : Promise.resolve(null);

export const listen = (ev, handler) =>
  T ? T.event.listen(ev, handler) : Promise.resolve(() => {});

// Notifica cambios de foco de la ventana (clic fuera => blur => plegado).
export const onWindowFocusChanged = (cb) =>
  T ? T.window.getCurrentWindow().onFocusChanged(cb) : Promise.resolve(() => {});

// Persistencia clave/valor en %APPDATA%\DynIsland\store.json
export const store = {
  get: (key) => invoke('store_get', { key }),
  set: (key, value) => invoke('store_set', { key, value }),
};
