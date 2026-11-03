// Widget: Reproductor de música (SMTC del sistema, vía Rust).
// Al abrirse llama a media_set_active(true); al desmontarse (false), el hilo
// de Rust duerme en un Condvar => 0 CPU cuando no está visible.
import { invoke, listen } from '../../core/ipc.js';

// Inyecta la hoja de estilos del widget solo cuando este se carga por primera vez.
if (!document.querySelector('link[data-w="music"]')) {
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'widgets/music/music.css'; l.dataset.w = 'music';
  document.head.appendChild(l);
}

export function create(host) {
  host.innerHTML = `
    <div class="music">
      <img class="cover" alt="cover" src="" />
      <div class="meta">
        <div class="date" id="m-date"></div>
        <div class="title" id="m-title">Sin reproducción</div>
        <div class="artist" id="m-artist">Abre Spotify o cualquier reproductor</div>
        <div class="bar"><div class="bar-fill" id="m-bar"></div></div>
        <div class="times"><span id="m-pos">00:00</span><span id="m-rem">-00:00</span></div>
        <div class="controls">
          <button class="icon-btn" id="m-prev" title="Anterior">
            <svg class="ic"><use href="#i-backward-step"/></svg>
          </button>
          <button class="icon-btn big" id="m-play" title="Pausa/Reproducir">
            <svg class="ic"><use id="m-play-use" href="#i-play"/></svg>
          </button>
          <button class="icon-btn" id="m-next" title="Siguiente">
            <svg class="ic"><use href="#i-forward-step"/></svg>
          </button>
        </div>
      </div>
    </div>`;

  const $ = (id) => host.querySelector('#' + id);

  // Interpolación de la posición ENTRE snapshots (cada 2 s): un timeout de 1 s
  // que solo existe mientras el widget está montado.
  let pos = 0, dur = 0, playing = false, interpTimer = 0, running = true;

  const fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };

  function render(t) {
    if (!running) return;
    pos = t.position; dur = t.duration; playing = t.playing;
    $('m-title').textContent = t.title || 'Sin reproducción';
    $('m-artist').textContent = t.artist || '';
    const img = host.querySelector('.cover');
    if (t.thumb) { img.src = t.thumb; img.style.visibility = 'visible'; }
    else img.style.visibility = 'hidden';
    $('m-play-use').setAttribute('href', t.playing ? '#i-pause' : '#i-play');
    paint();
  }

  function paint() {
    $('m-pos').textContent = fmt(pos);
    $('m-rem').textContent = '-' + fmt(Math.max(0, dur - pos));
    const p = dur ? Math.min(100, (pos / dur) * 100) : 0;
    $('m-bar').style.width = p.toFixed(1) + '%';
  }

  function interp() {
    if (!running) return;
    if (playing) { pos += 1000; paint(); }
    interpTimer = setTimeout(interp, 1000);
  }

  const d = new Date();
  $('m-date').textContent = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  let unlisten = () => {};
  listen('media-track', (e) => render(e.payload)).then((u) => { unlisten = u; });
  invoke('media_set_active', { active: true }).catch(() => {});
  invoke('media_snapshot').then(render).catch(() => {});
  interpTimer = setTimeout(interp, 1000);

  $('m-play').addEventListener('click', () => {
    invoke('media_control', { action: 'playpause' });
    setTimeout(() => invoke('media_snapshot').then(render), 350);
  });
  $('m-next').addEventListener('click', () => {
    invoke('media_control', { action: 'next' });
    setTimeout(() => invoke('media_snapshot').then(render), 350);
  });
  $('m-prev').addEventListener('click', () => {
    invoke('media_control', { action: 'prev' });
    setTimeout(() => invoke('media_snapshot').then(render), 350);
  });

  return {
    unmount() {
      running = false;
      clearTimeout(interpTimer);
      unlisten();
      invoke('media_set_active', { active: false }).catch(() => {});
    },
  };
}
