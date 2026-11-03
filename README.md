# DynIsland

**Una Dynamic Island para tu escritorio Windows y Linux.** Música, concentración, agua,
tareas y archivos temporales en una isla flotante hecha con **Tauri 2, Rust y
JavaScript nativo**. Sin Electron, frameworks de frontend ni bundler.

> Versión 0.1.0 · Proyecto en desarrollo · Windows 10/11 y Linux X11/XWayland.

[![Build](https://github.com/zLeGnDz3r0/DynIsland/actions/workflows/build.yml/badge.svg)](https://github.com/zLeGnDz3r0/DynIsland/actions/workflows/build.yml)

## Funciones

| Widget | Qué ofrece |
| --- | --- |
| **Music** | Información y controles multimedia mediante SMTC en Windows y MPRIS/playerctl en Linux. |
| **Focus Timer** | Pomodoro con trabajo, descanso y persistencia del temporizador. |
| **Water** | Registro de agua, objetivo configurable y reinicio diario. |
| **Shelf** | Archivos por arrastrar y soltar, apertura y exportación a Descargas. |
| **Tasks** | Creación, edición y eliminación de tareas organizadas por día. |

La ventana transparente permanece encima de otras ventanas, adapta su tamaño
al estado de la interfaz y permite reorganizar los widgets.

## Compilar y ejecutar

### Windows

Necesitas Windows 10/11, **Rust estable reciente con toolchain MSVC**, Visual
Studio Build Tools con **Desktop development with C++** y Windows SDK, y
**Microsoft Edge WebView2 Runtime**. Node.js solo se utiliza en las herramientas
opcionales; no hace falta `npm install`.

```powershell
git clone https://github.com/zLeGnDz3r0/DynIsland.git
cd DynIsland
cargo run --locked --manifest-path src-tauri/Cargo.toml
```

Ejecutable optimizado:

```powershell
cargo build --release --locked --manifest-path src-tauri/Cargo.toml
.\src-tauri\target\release\dynisland.exe
```

Para generar un instalador NSIS:

```powershell
cargo install tauri-cli --version "^2" --locked
cd src-tauri
cargo tauri build
```

Los instaladores se generan en `src-tauri/target/release/bundle/nsis/`. El código
publicado no implica que exista una release con instalador. Los compilados se
excluyen de Git.

### Linux: Ubuntu y Debian

La versión Linux utiliza **X11 o XWayland**. El posicionamiento arbitrario de
la isla no está soportado en Wayland nativo. En una sesión Wayland necesitas
XWayland y una variable `DISPLAY` válida; DynIsland selecciona el backend X11
si no has configurado `GDK_BACKEND`.

Base de compilación: **Ubuntu 22.04+ o Debian 12+**, con WebKitGTK 4.1 y Rust
estable reciente. Las versiones anteriores que solo ofrecen WebKitGTK 4.0 no
son un objetivo de esta versión. Dependencias según los
[requisitos oficiales de Tauri](https://v2.tauri.app/start/prerequisites/):

```bash
sudo apt update
sudo apt install build-essential curl wget file pkg-config libssl-dev \
  libwebkit2gtk-4.1-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev \
  playerctl coreutils xdg-utils
```

Instala Rust estable desde [rustup](https://rustup.rs/) si aún no lo tienes.
Después:

```bash
git clone https://github.com/zLeGnDz3r0/DynIsland.git
cd DynIsland
cargo run --locked --manifest-path src-tauri/Cargo.toml
```

Para generar paquetes `.deb` y AppImage **desde Linux**:

```bash
cargo install tauri-cli --version '^2' --locked
cd src-tauri
cargo tauri build --bundles deb,appimage
```

Los resultados están en `src-tauri/target/release/bundle/`. Para instalarlos:

```bash
sudo apt install ./DynIsland_*.deb
# Alternativa portátil: requiere las herramientas de integración instaladas.
chmod +x ./DynIsland_*.AppImage
./DynIsland_*.AppImage
```

Ejecuta esos comandos desde la carpeta del paquete correspondiente y usa su
nombre real. Si FUSE no está disponible, una AppImage admite
`./DynIsland_*.AppImage --appimage-extract-and-run`.

GitHub Actions compila Windows, Ubuntu y Debian, y conserva los paquetes de
Ubuntu como artefactos del run. Descárgalos en
[Actions](https://github.com/zLeGnDz3r0/DynIsland/actions). Los artefactos de CI
no son una release firmada. No se garantiza compatibilidad de binarios con una
distribución más antigua que la utilizada para compilarlos; consulta las
[limitaciones de AppImage](https://v2.tauri.app/distribute/appimage/).

| Integración | Linux |
| --- | --- |
| Música | Reproductores MPRIS con `playerctl` y D-Bus de sesión. Metadatos y controles; sin carátulas en esta versión. |
| Batería | Lectura de `/sys/class/power_supply`; sin batería reconocida no se muestra porcentaje. |
| WiFi | `nmcli` de NetworkManager, opcional. Sin él, el indicador queda atenuado. |
| Shelf | `xdg-open` y carpeta Descargas resuelta mediante XDG/Tauri. |
| Ventana | Centrada sobre el área de trabajo bajo X11/XWayland; el gestor de ventanas puede restringir posición o siempre encima. |

Puedes instalar `network-manager` si quieres el indicador WiFi y tu sistema
ya usa ese gestor de red. La música se consulta cada 2 segundos con el widget
abierto y cada 15 segundos al estar cerrado; no se promete el mismo consumo
que el backend SMTC de Windows.

## Uso

- Lleva el puntero a la zona superior de la pantalla para interactuar con la isla.
- Navega entre widgets con los controles del panel.
- Abre la configuración de orden de páginas para reorganizarlos.
- Arrastra archivos sobre la isla para añadirlos a Shelf.
- En Shelf, un clic abre el elemento y el menú contextual permite exportarlo.

**Shelf es temporal:** copia archivos al almacenamiento local de la app, pero
las carpetas conservan una referencia a su ubicación original. Las copias de
más de 24 horas se limpian al arrancar. La lista visible no es un catálogo
persistente ni una copia de seguridad. La exportación usa la carpeta Descargas
del sistema cuando existe; un archivo con el mismo nombre puede ser reemplazado.

## Desarrollo

Previsualización del frontend:

```powershell
node tools/serve.mjs
```

Abre `http://localhost:8763`. Fuera de Tauri, el puente IPC devuelve valores
vacíos: la integración multimedia, información nativa, persistencia y operaciones
de archivos requieren ejecutar la aplicación de escritorio.

Regenerar el sprite después de modificar los SVG:

```powershell
node tools/build-sprite.mjs
```

Los iconos de la aplicación se generan con `tools/make-icons.ps1` (PowerShell y
GDI+ en Windows).

Comprobación del backend:

```powershell
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
node tools/check-syntax.mjs
node tools/verify-preview.mjs
```

## Arquitectura

```text
src/
  index.html                 Interfaz y sprite SVG
  assets/                    CSS e iconos
  core/                      IPC, navegación, ventana y orden de páginas
  widgets/                   Music, Pomodoro, Water, Shelf y Tasks
src-tauri/
  src/main.rs                Inicio y comandos Tauri
  src/winctl.rs              Geometría y estados de ventana
  src/media.rs               SMTC en Windows, MPRIS/playerctl en Linux
  src/sysinfo.rs             Batería y WiFi
  src/store.rs               Persistencia JSON
  src/shelf.rs               Archivos temporales
  capabilities/              Permisos Tauri
  Cargo.lock                 Versiones resueltas del backend
tools/                       Previsualización y generación de iconos
```

El frontend usa módulos ES e `import()` para cargar widgets bajo demanda. Las
transiciones usan CSS. Rust gestiona la ventana, archivos y APIs de Windows.
La información del sistema se consulta periódicamente y emite eventos cuando
cambia. El perfil release habilita LTO y optimiza el tamaño.

El consumo de memoria, CPU y tamaño del binario dependen del equipo, WebView2 y
el uso. El repositorio no incluye un benchmark reproducible que garantice cifras
concretas.

## Datos locales

La configuración se guarda como JSON sin cifrar en el directorio de datos de
Tauri para **`com.dynisland.desktop`**, normalmente
`%APPDATA%\com.dynisland.desktop\store.json` en Windows. Shelf utiliza el
directorio local, normalmente `%LOCALAPPDATA%\com.dynisland.desktop\shelf\`.
Las rutas las resuelve Tauri según el sistema. No se necesita una cuenta ni
una clave de API para ejecutar la aplicación.

En Linux, el directorio de datos suele ser
`~/.local/share/com.dynisland.desktop/` (o `$XDG_DATA_HOME/com.dynisland.desktop/`).
Contiene `store.json`, el último estado de música y `shelf/`. No se activa inicio
automático ni se instala un servicio de sistema.

## Estado y contribuciones

El proyecto no incluye actualmente una suite automatizada completa. Antes de
distribuir un binario, comprueba el funcionamiento con tu resolución, escala de
pantalla y reproductor multimedia. Una compilación correcta no sustituye esas
pruebas de escritorio.

Limitaciones conocidas: Shelf pierde su lista visible al plegar la isla o
cambiar de widget, aunque las copias permanecen en disco; los recordatorios de
agua aún no están implementados; Water y Tasks calculan el cambio de día en UTC.

Para informar de un fallo, incluye sistema/distribución, escritorio, X11/Wayland, escala de pantalla y
pasos para reproducirlo. Las pull requests deben explicar el cambio y cómo se
ha verificado.

## Licencias y créditos

Los iconos [Heroicons](https://github.com/tailwindlabs/heroicons) se distribuyen
bajo licencia MIT de Tailwind Labs; consulta
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Las dependencias conservan sus
respectivas licencias.

El código propio todavía no tiene una licencia de uso otorgada. La visibilidad
pública no concede por sí sola permiso para reutilizarlo o redistribuirlo.
