// Widget: Lista de tareas del día. Persistida en store; cero timers.
import { store } from '../../core/ipc.js';

if (!document.querySelector('link[data-w="todo"]')) {
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'widgets/todo/todo.css'; l.dataset.w = 'todo';
  document.head.appendChild(l);
}

export function create(host) {
  host.innerHTML = `
    <div class="todo">
      <div class="todo-head">
        <span id="t-count">0/0 Task Done Today</span>
        <span class="todo-actions">
          <button class="btn" id="t-add"><svg class="ic"><use href="#i-plus"/></svg> Add Task</button>
          <button class="btn" id="t-edit"><svg class="ic"><use href="#i-pencil-square"/></svg> Edit Task</button>
        </span>
      </div>
      <div class="todo-form hidden" id="t-form">
        <input id="t-input" type="text" placeholder="¿Qué hay que hacer?" maxlength="120" />
        <button class="btn primary" id="t-save">Add</button>
      </div>
      <ul class="todo-list" id="t-list"></ul>
      <div class="empty" id="t-empty">No tasks.</div>
    </div>`;

  const $ = (id) => host.querySelector('#' + id);
  let tasks = [];
  let editing = false;
  let running = true;

  const today = () => new Date().toISOString().slice(0, 10);

  function render() {
    const done = tasks.filter((t) => t.done).length;
    $('t-count').textContent = `${done}/${tasks.length} Task Done Today`;
    $('t-empty').classList.toggle('hidden', tasks.length > 0);
    const list = $('t-list');
    list.textContent = '';
    for (const t of tasks) {
      const li = document.createElement('li');
      li.className = 'todo-item' + (t.done ? ' done' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = t.done;
      cb.addEventListener('change', () => { t.done = cb.checked; save(); render(); });
      const span = document.createElement('span');
      span.textContent = t.text;
      span.addEventListener('dblclick', () => { t.done = !t.done; save(); render(); });
      const del = document.createElement('button');
      del.className = 'todo-del'; del.title = 'Eliminar';
      del.innerHTML = '<svg class="ic"><use href="#i-trash"/></svg>';
      del.addEventListener('click', () => { tasks = tasks.filter((x) => x !== t); save(); render(); });
      li.append(cb, span, del);
      list.appendChild(li);
    }
  }

  function save() { store.set('todo:' + today(), tasks).catch(() => {}); }

  function load() {
    store.get('todo:' + today()).then((s) => {
      if (!running) return;
      tasks = Array.isArray(s) ? s : [];
      render();
    }).catch(() => render());
  }

  $('t-add').addEventListener('click', () => {
    $('t-form').classList.toggle('hidden');
    $('t-input').focus();
  });
  $('t-edit').addEventListener('click', () => {
    editing = !editing;
    $('t-list').classList.toggle('editing', editing);
  });
  $('t-save').addEventListener('click', commit);
  $('t-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });

  function commit() {
    const text = $('t-input').value.trim();
    if (!text) return;
    tasks.push({ text, done: false });
    $('t-input').value = '';
    $('t-form').classList.add('hidden');
    save(); render();
  }

  load();
  return {
    unmount() {
      running = false;
      // Sin timers ni listeners de backend que detener.
    },
  };
}
