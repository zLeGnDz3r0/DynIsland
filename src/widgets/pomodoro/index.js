// Widget: Pomodoro / Focus Timer.
// Tres modos SIEMPRE accesibles: Focus (25), Short Break (5) y Long Break (15),
// con un botón de play/pausa separado (no cambia de modo).
// Sin setInterval por segundo: guarda deadline absoluta y repinta SOLO cuando
// cambia el segundo mostrado (setTimeout alineado). Pausado => 0 timers.
import { store } from '../../core/ipc.js';

if (!document.querySelector('link[data-w="pomodoro"]')) {
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'widgets/pomodoro/pomodoro.css'; l.dataset.w = 'pomodoro';
  document.head.appendChild(l);
}

const DUR = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
const LABEL = { focus: 'Focus time', short: 'Short Break', long: 'Long Break' };

export function create(host) {
  host.innerHTML = `
    <div class="pomo">
      <div class="pomo-head">
        <svg class="ic pomo-clock"><use href="#i-clock"/></svg>
        <div>
          <div class="pomo-label" id="p-mode">Focus time</div>
          <div class="pomo-big" id="p-time">25:00</div>
        </div>
      </div>
      <div class="pomo-btns">
        <button class="btn" id="p-short">Short Break</button>
        <button class="btn" id="p-long">Long Break</button>
        <button class="pomo-play" id="p-toggle" title="Pausa/Reanudar">
          <svg class="ic"><use id="p-toggle-use" href="#i-play"/></svg>
        </button>
        <button class="btn" id="p-focus">Focus Time</button>
      </div>
    </div>`;

  const $ = (id) => host.querySelector('#' + id);
  let mode = 'focus';          // 'focus' | 'short' | 'long'
  let deadline = 0;            // epoch ms; 0 = detenido
  let remaining = DUR.focus;   // segundos restantes cuando está detenido
  let timer = 0, running = true;

  const mmss = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

  function paint(sec) {
    $('p-time').textContent = mmss(sec);
    $('p-toggle-use').setAttribute('href', deadline ? '#i-pause' : '#i-play');
  }

  function tick() {
    if (!running || !deadline) return;
    const sec = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    paint(sec);
    if (sec <= 0) {
      // Fin de sesión: focus -> short break; cualquier pausa -> focus.
      setMode(mode === 'focus' ? 'short' : 'focus');
      return;
    }
    // Siguiente repaint exactamente cuando vence el segundo mostrado.
    const ms = ((deadline - Date.now()) % 1000) + 30;
    timer = setTimeout(tick, ms || 1000);
  }

  function persist() {
    store.set('pomodoro', { mode, remaining, deadline }).catch(() => {});
  }

  function setMode(m) {
    deadline = 0;
    clearTimeout(timer);
    mode = m;
    remaining = DUR[m];
    $('p-mode').textContent = LABEL[m];
    paint(remaining);
    persist();
  }

  $('p-toggle').addEventListener('click', () => {
    if (deadline) { // pausar
      remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      deadline = 0;
      clearTimeout(timer);
    } else {        // reanudar/iniciar
      deadline = Date.now() + remaining * 1000;
      tick();
    }
    paint(remaining);
    persist();
  });

  $('p-short').addEventListener('click', () => setMode('short'));
  $('p-long').addEventListener('click', () => setMode('long'));
  $('p-focus').addEventListener('click', () => setMode('focus'));

  // Restaura estado previo (con corrección del tiempo transcurrido si corría).
  store.get('pomodoro').then((s) => {
    if (!running || !s) return;
    mode = DUR[s.mode] ? s.mode : 'focus';
    remaining = Math.max(0, s.remaining ?? DUR[mode]);
    if (s.deadline) {
      const left = Math.ceil((s.deadline - Date.now()) / 1000);
      if (left > 0) {
        deadline = s.deadline;
        remaining = left;
        tick();
      } else { remaining = DUR[mode]; }
    }
    $('p-mode').textContent = LABEL[mode];
    if (!deadline) paint(remaining);
  }).catch(() => paint(DUR.focus));
  paint(DUR.focus);

  return {
    unmount() {
      running = false;
      clearTimeout(timer);
      persist();
    },
  };
}
