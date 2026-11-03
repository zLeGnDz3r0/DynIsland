// dock.js — Ciclo de vida de la isla.
//
// Principios de bajo consumo:
//  * La hora se repinta SOLO cuando cambia el minuto (un setTimeout alineado,
//    no un setInterval de 1 s). En reposo: 1 wakeup/min, 0% CPU.
//  * Las animaciones son CSS (GPU); no hay requestAnimationFrame permanente.
//  * Los módulos de widgets se cargan con import() dinámico al mostrarse y su
//    lógica de fondo se detiene al cambiar de página (cada widget implementa
//    mount() / unmount()).
//
// Guard anti-arrastre de ventanas: al arrastrar una ventana hacia la parte
// superior, el cursor pasa por encima de la isla con el botón primario pulsado
// (e.buttons !== 0). Solo expandimos si NO hay botones pulsados y el puntero
// realmente "habita" la isla (dwell de 120 ms), así nunca interfieren ni con
// Aero Snap ni con las pestañas maximizadas de Windows.

import { invoke, listen, onWindowFocusChanged, store } from './ipc.js';
import { initOrder, getOrder, loadPage, REGISTRY } from './pages.js';

const panel = document.getElementById('panel');
const clockEl = document.getElementById('clock');
const pageHost = document.getElementById('page-host');
const pageTitle = document.getElementById('page-title');
const dotsEl = document.getElementById('dots');

// Máquina de estados: 'hidden' | 'pill' | 'expanding' | 'expanded' | 'collapsing'.
//   hidden  = isla invisible (solo franja de detección arriba).
//   pill    = píldora pequeña visible (hover) — clic para el panel completo.
//   expanded = panel completo. Sin interacción 30 s => vuelve a plegarse.
let state = 'hidden';
let pageIndex = 0;
let currentPage = null; // { id, instance }
let hoverTimer = 0;
let hovering = false;
let hidePillTimer = 0;
let collapseTimer = 0;
let idleTimer = 0;

// Sin interacción durante 30 s con el panel abierto => se pliega solo.
const IDLE_MS = 30_000;

const setState = (s) => { state = s; };

const pill = document.getElementById('pill');

/* ---------------- Mini-reproductor en la píldora -------------------------- */
// Visible si suena ahora mismo o hubo reproducción en las últimas 2 h
// (el backend recuerda last_play_ms incluso entre reinicios).
const ppRoot = document.getElementById('pill-player');
const ppCover = document.getElementById('pp-cover');
const ppTitle = document.getElementById('pp-title');
const ppUse = document.getElementById('pp-use');
const PP_PLAY = '#i-play';
const PP_PAUSE = '#i-pause';

let lastSource = ''; // app que está sonando ("Spotify", "Chrome", ...) para el título

function applyPillTrack(t) {
  const RECENT_MS = 2 * 60 * 60 * 1000; // 2 h
  const recent = t && t.title && (t.playing || (t.last_play_ms && Date.now() - t.last_play_ms < RECENT_MS));
  if (t && t.source) {
    lastSource = t.source;
    // Título vivo: mientras la página de música está abierta, muestra la app.
    if (state === 'expanded' && currentPage && currentPage.id === 'music') {
      pageTitle.textContent = lastSource;
    }
  }
  if (!recent) {
    ppRoot.classList.add('hidden');
    return;
  }
  ppRoot.classList.remove('hidden');
  ppTitle.textContent = t.title + (t.artist ? ' · ' + t.artist : '');
  if (t.thumb) ppCover.src = t.thumb;
  ppUse.setAttribute('href', t.playing ? PP_PAUSE : PP_PLAY);
}

listen('media-track', (e) => applyPillTrack(e.payload)).catch(() => {});
invoke('pill_snapshot').then(applyPillTrack).catch(() => {});
document.getElementById('pp-toggle').addEventListener('click', (e) => {
  e.stopPropagation(); // el botón controla la música; NO despliega el panel
  invoke('media_control', { action: 'playpause' }).catch(() => {});
});

/* ---------------- Hora (repintado por minuto, no por segundo) ------------- */
function tickClock() {
  const now = new Date();
  clockEl.textContent =
    String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const next = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 20;
  setTimeout(tickClock, next); // un solo wakeup por minuto
}

/* ---------------- Batería / WiFi (push desde Rust, solo si cambian) ------- */
async function initSysIcons() {
  const apply = (s) => {
    const b = document.getElementById('battery');
    if (s.battery == null) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    document.getElementById('battery-text').textContent = s.battery + '%';
    document.getElementById('battery-fill').setAttribute('width', String((s.battery / 100) * 18));
  };
  const wifi = document.getElementById('ic-wifi');
  const applyWifi = (s) => {
    wifi.style.opacity = s.wifi == null ? '0.3' : String(0.35 + (s.wifi / 100) * 0.65);
  };
  await listen('sys-status', (e) => { apply(e.payload); applyWifi(e.payload); });
  invoke('get_status').then((s) => { apply(s); applyWifi(s); }).catch(() => {});
}

/* ---------------- Fase 1: píldora pequeña ------------------------------- */
function showPill() {
  if (state !== 'hidden') return;
  setState('pill');
  clearTimeout(hidePillTimer);
  invoke('set_island_bounds', { mode: 'pill' }).catch(() => {});
  pill.classList.add('shown');
  // Refresca el mini-player (lectura del cache en Rust: instantánea).
  invoke('pill_snapshot').then(applyPillTrack).catch(() => {});
}

function hidePill() {
  if (state !== 'pill') return;
  setState('hidden');
  pill.classList.remove('shown');
  invoke('set_island_bounds', { mode: 'hidden' }).catch(() => {});
}

/* ---------------- Fase 2: panel completo --------------------------------- */
// Escala del panel desplegado (para pantallas pequeñas). Persistida en store.
let islandScale = 1;

export function getIslandScale() {
  return islandScale;
}

export function applyIslandScale(s) {
  islandScale = Math.min(1.5, Math.max(0.6, s));
  panel.style.zoom = islandScale;
  store.set('islandScale', islandScale).catch(() => {});
  if (state === 'expanded') {
    invoke('set_island_bounds', { mode: 'expanded', scale: islandScale }).catch(() => {});
  }
}

async function expand() {
  if (state !== 'pill' && state !== 'hidden') return;
  clearTimeout(hidePillTimer);
  setState('expanding');
  pill.classList.remove('shown'); // la píldora se recoge al crecer el panel
  panel.classList.remove('hidden');
  panel.classList.remove('leaving');
  panel.style.zoom = islandScale;
  panel.setAttribute('aria-expanded', 'true');
  // Fire-and-forget: la UI nunca espera al redimensionado del backend.
  invoke('set_island_bounds', { mode: 'expanded', scale: islandScale }).catch(() => {});
  setState('expanded');
  armIdleTimer();
  await showPage(pageIndex);
}

function collapse() {
  if (state !== 'expanded') return;
  setState('collapsing');
  clearTimeout(idleTimer);
  unmountCurrent();
  panel.classList.add('leaving');
  collapseTimer = setTimeout(() => {
    panel.classList.add('hidden');
    panel.classList.remove('leaving');
    // Si el ratón sigue por la zona, volvemos a la píldora; si no, ocultamos.
    if (hovering) {
      setState('pill');
      invoke('set_island_bounds', { mode: 'pill' }).catch(() => {});
      pill.classList.add('shown');
    } else {
      setState('hidden');
      invoke('set_island_bounds', { mode: 'hidden' }).catch(() => {});
    }
  }, 300); // dura lo mismo que el slide-out (0,26 s) + margen
}

/* ---------------- Auto-plegado por inactividad (30 s) -------------------- */
function armIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (state === 'expanded') collapse();
  }, IDLE_MS);
}
['pointermove', 'pointerdown', 'wheel', 'keydown', 'input'].forEach((ev) =>
  panel.addEventListener(ev, armIdleTimer, { passive: true })
);

function unmountCurrent() {
  if (currentPage && currentPage.instance && currentPage.instance.unmount) {
    currentPage.instance.unmount();
  }
  currentPage = null;
  pageHost.textContent = '';
}

async function showPage(i) {
  if (state === 'collapsing' || state === 'hidden') return; // se plegó mientras cargaba
  const order = getOrder();
  pageIndex = ((i % order.length) + order.length) % order.length;
  const id = order[pageIndex];

  unmountCurrent();

  let mod;
  try {
    mod = await loadPage(id); // lazy: primera visita => import() dinámico
  } catch (err) {
    pageHost.innerHTML = `<div class="page"><div class="empty">No se pudo cargar el widget.</div></div>`;
    return;
  }
  if (state === 'collapsing' || state === 'hidden') return; // guard tras el await
  const host = document.createElement('div');
  host.className = 'page';
  host.dataset.page = id;
  pageHost.appendChild(host);
  currentPage = { id, instance: mod.create(host) };
  pageTitle.textContent =
    id === 'order' ? 'Ajustes'
    : id === 'music' && lastSource ? lastSource
    : REGISTRY[id].title;
  renderDots();
  store.set('lastPage', pageIndex).catch(() => {});
}

function renderDots() {
  const order = getOrder();
  dotsEl.textContent = '';
  order.forEach((id, i) => {
    const d = document.createElement('span');
    d.className = 'dot' + (i === pageIndex ? ' on' : '');
    d.title = REGISTRY[id].title;
    d.addEventListener('click', () => showPage(i));
    dotsEl.appendChild(d);
  });
}

/* ---------------- Eventos de usuario ------------------------------------- */
// Franja de detección: al pasar el ratón cerca del borde superior aparece la
// PÍLDORA. Guards:
//  * e.buttons !== 0 => arrastre de ventana (Aero Snap): ignorar SIEMPRE.
//  * Dwell de 1,2 s: mover el ratón hacia arriba para cambiar de pestaña del
//    navegador (o cruzar de paso) NO despliega; detenerse arriba sí.
const HOVER_DWELL_MS = 1200;
document.body.addEventListener('pointerenter', (e) => {
  if (e.buttons !== 0) return;
  hovering = true;
  clearTimeout(hidePillTimer);
  if (state === 'hidden') {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (hovering && state === 'hidden') showPill();
    }, HOVER_DWELL_MS);
  }
});
document.body.addEventListener('pointerleave', () => {
  hovering = false;
  clearTimeout(hoverTimer);
  // La píldora se esconde al alejar el ratón (con un pequeño margen anti-parpadeo).
  if (state === 'pill') {
    hidePillTimer = setTimeout(() => { if (!hovering && state === 'pill') hidePill(); }, 350);
  }
});

// Fase 2: clic en la píldora => panel completo.
pill.addEventListener('click', (e) => {
  if (e.button === 0 && state === 'pill') expand();
});

document.getElementById('nav-prev').addEventListener('click', () => showPage(pageIndex - 1));
document.getElementById('nav-next').addEventListener('click', () => showPage(pageIndex + 1));
document.getElementById('close-panel').addEventListener('click', collapse);

// Clic fuera de la isla => colapsar (evento pasivo desde Rust)
document.addEventListener('mousedown', (e) => {
  if (state === 'expanded' && !panel.contains(e.target)) collapse();
});

// Clic en OTRA aplicación => la ventana pierde el foco => plegar.
// Fiable porque el panel solo se abre tras un clic en la píldora, que ya
// enfoca nuestra ventana; cualquier clic fuera dispara el blur.
onWindowFocusChanged(({ payload: focused }) => {
  if (!focused && state === 'expanded') collapse();
}).catch(() => {});

// Orden de páginas: botón engranaje abre la vista de reordenación
document.getElementById('gear').addEventListener('click', async () => {
  const mod = await import('../core/order-page.js');
  unmountCurrent();
  const host = document.createElement('div');
  host.className = 'page';
  pageHost.appendChild(host);
  currentPage = { id: 'order', instance: mod.create(host, () => showPage(0)) };
  pageTitle.textContent = 'Ajustes';
});

/* ---------------- Teclado mínimo (accesibilidad) -------------------------- */
document.addEventListener('keydown', (e) => {
  if (state !== 'expanded') return;
  if (e.key === 'Escape') collapse();
  if (e.key === 'ArrowLeft') showPage(pageIndex - 1);
  if (e.key === 'ArrowRight') showPage(pageIndex + 1);
});

/* ---------------- Arranque ----------------------------------------------- */
(async function main() {
  tickClock(); // sigue actualizando la hora (queda visible en el futuro header)
  await initSysIcons();
  await initOrder();
  // Restaura la última página vista y la escala del panel.
  const last = await store.get('lastPage');
  if (typeof last === 'number') pageIndex = last;
  const savedScale = await store.get('islandScale');
  if (typeof savedScale === 'number') islandScale = Math.min(1.5, Math.max(0.6, savedScale));
  await invoke('set_island_bounds', { mode: 'hidden' }); // franja de detección
})();
