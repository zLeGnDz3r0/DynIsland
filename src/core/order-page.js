// Vista "Ajustes": reordena las páginas del carrusel (↑/↓) y cambia el tamaño
// del panel desplegado (para pantallas pequeñas). Todo persistido al instante.
import { getOrder, movePage, REGISTRY, DEFAULT_ORDER } from './pages.js';
import { applyIslandScale, getIslandScale } from './dock.js';

const SIZES = [
  { v: 0.8, label: '80%' },
  { v: 0.9, label: '90%' },
  { v: 1.0, label: '100%' },
  { v: 1.1, label: '110%' },
];

export function create(host, onDone) {
  host.innerHTML = `
    <div class="order-page">
      <div class="order-hint">Reordena las páginas del carrusel. Se guarda automáticamente.</div>
      <ul class="order-list" id="o-list"></ul>
      <div class="size-row">
        <div class="size-label">Tamaño desplegado</div>
        <div class="size-btns" id="o-sizes"></div>
        <div class="size-hint">Reduce en pantallas pequeñas; se aplica y guarda al instante.</div>
      </div>
      <div class="order-btns">
        <button class="btn" id="o-reset">Restablecer</button>
        <button class="btn primary" id="o-done">Hecho</button>
      </div>
    </div>`;

  if (!document.querySelector('link[data-w="order"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'core/order-page.css'; l.dataset.w = 'order';
    document.head.appendChild(l);
  }

  const list = host.querySelector('#o-list');
  const sizesEl = host.querySelector('#o-sizes');
  let alive = true;

  function renderOrder() {
    if (!alive) return;
    const order = getOrder();
    list.textContent = '';
    order.forEach((id, i) => {
      const li = document.createElement('li');
      li.className = 'order-item';
      li.innerHTML = `<span class="order-name">${REGISTRY[id].title}</span>
        <span class="order-pos">${i + 1}</span>`;
      const up = mkBtn('↑', i > 0, () => { movePage(id, -1).then(renderOrder); });
      const down = mkBtn('↓', i < order.length - 1, () => { movePage(id, 1).then(renderOrder); });
      li.append(up, down);
      list.appendChild(li);
    });
  }

  function mkBtn(label, enabled, onClick) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.disabled = !enabled;
    if (enabled) b.addEventListener('click', onClick);
    return b;
  }

  function renderSizes() {
    if (!alive) return;
    const current = getIslandScale();
    sizesEl.textContent = '';
    for (const { v, label } of SIZES) {
      const b = document.createElement('button');
      b.className = 'size-btn' + (Math.abs(current - v) < 0.001 ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        applyIslandScale(v);
        renderSizes();
      });
      sizesEl.appendChild(b);
    }
  }

  host.querySelector('#o-reset').addEventListener('click', async () => {
    const { setOrder } = await import('./pages.js');
    setOrder([...DEFAULT_ORDER]);
    applyIslandScale(1.0);
    renderOrder();
    renderSizes();
  });
  host.querySelector('#o-done').addEventListener('click', onDone);

  renderOrder();
  renderSizes();
  return {
    unmount() { alive = false; },
  };
}
