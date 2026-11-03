// Widget: Recordatorio de agua. Progreso persistido por día.
// Cero temporizadores: todo es reacción a clics ("Drink", "Settings").
import { store } from '../../core/ipc.js';

if (!document.querySelector('link[data-w="water"]')) {
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'widgets/water/water.css'; l.dataset.w = 'water';
  document.head.appendChild(l);
}

export function create(host) {
  host.innerHTML = `
    <div class="water">
      <svg class="ring" viewBox="0 0 120 120" width="150" height="150">
        <circle class="ring-bg" cx="60" cy="60" r="52"/>
        <circle class="ring-fg" id="w-ring" cx="60" cy="60" r="52"/>
        <text id="w-pct" x="60" y="57" text-anchor="middle" class="ring-pct">17%</text>
        <text id="w-lit" x="60" y="76" text-anchor="middle" class="ring-lit">0.3 / 2.0 L</text>
      </svg>
      <div class="water-side">
        <div class="water-status" id="w-status">Reminders off</div>
        <div class="water-btns">
          <button class="btn primary" id="w-drink">Drink</button>
          <button class="btn" id="w-settings">Settings</button>
        </div>
        <div class="water-quick hidden" id="w-quick">
          <label>Meta (L) <input id="w-goal" type="number" min="0.5" max="6" step="0.5" value="2.0"></label>
          <label class="chk"><input id="w-remind" type="checkbox"> Recordatorios cada 45 min (solo con la isla abierta)</label>
        </div>
      </div>
    </div>`;

  const $ = (id) => host.querySelector('#' + id);
  const CIRC = 2 * Math.PI * 52;
  $('w-ring').style.strokeDasharray = CIRC;

  const today = () => new Date().toISOString().slice(0, 10);
  let state = { date: today(), ml: 300, goalMl: 2000, remind: false };
  let running = true;

  function paint() {
    const liters = state.ml / 1000, goal = state.goalMl / 1000;
    const pct = Math.min(100, Math.round((state.ml / state.goalMl) * 100));
    $('w-pct').textContent = pct + '%';
    $('w-lit').textContent = liters.toFixed(1) + ' / ' + goal.toFixed(1) + ' L';
    $('w-ring').style.strokeDashoffset = CIRC * (1 - pct / 100);
    $('w-status').textContent = state.remind ? 'Reminders on' : 'Reminders off';
    $('w-remind').checked = state.remind;
    $('w-goal').value = goal;
  }

  function save() { store.set('water', state).catch(() => {}); }

  $('w-drink').addEventListener('click', () => {
    if (state.date !== today()) { state.date = today(); state.ml = 0; }
    state.ml = Math.min(state.goalMl * 2, state.ml + 250);
    paint(); save();
  });

  $('w-settings').addEventListener('click', () => $('w-quick').classList.toggle('hidden'));

  $('w-goal').addEventListener('change', () => {
    state.goalMl = Math.max(500, Math.min(6000, parseFloat($('w-goal').value || '2') * 1000));
    paint(); save();
  });
  $('w-remind').addEventListener('change', () => {
    state.remind = $('w-remind').checked;
    paint(); save();
  });

  store.get('water').then((s) => {
    if (!running || !s) return;
    // Reinicio diario
    if (s.date !== today()) s.ml = 0;
    state = { date: today(), ml: s.ml | 0, goalMl: s.goalMl || 2000, remind: !!s.remind };
    paint();
  }).catch(() => {});
  paint();

  return {
    unmount() {
      running = false;
      // Nada que detener: este widget no crea temporizadores.
    },
  };
}
