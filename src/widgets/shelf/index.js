// Widget: Shelf (zona de archivos temporales).
// Los drops llegan como evento push `shelf-items` desde Rust (sin polling).
import { invoke, listen } from '../../core/ipc.js';

if (!document.querySelector('link[data-w="shelf"]')) {
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'widgets/shelf/shelf.css'; l.dataset.w = 'shelf';
  document.head.appendChild(l);
}

export function create(host) {
  host.innerHTML = `
    <div class="shelf">
      <div class="shelf-empty" id="s-empty">
        <svg class="ic shelf-ic"><use href="#i-arrow-down-tray"/></svg>
        <div class="shelf-hint">Drop files here · Drag out anytime · click to open</div>
      </div>
      <div class="shelf-grid hidden" id="s-grid"></div>
    </div>`;

  const $ = (id) => host.querySelector('#' + id);
  const grid = $('s-grid');
  let items = [];
  let running = true;
  let unlisten = () => {};

  function render() {
    if (!items.length) { $('s-empty').classList.remove('hidden'); grid.classList.add('hidden'); return; }
    $('s-empty').classList.add('hidden');
    grid.classList.remove('hidden');
    grid.textContent = '';
    for (const it of items) {
      const card = document.createElement('div');
      card.className = 'shelf-card';
      card.title = it.path;
      card.innerHTML = `
        <div class="shelf-icon">${it.is_dir ? '📁' : '📄'}</div>
        <div class="shelf-name">${escapeHtml(it.name)}</div>
        <div class="shelf-sub">${it.is_dir ? '' : fmtSize(it.size)}</div>`;
      // Click = abrir; exportar a Descargas con el botón secundario.
      card.addEventListener('click', () => invoke('open_path', { path: it.path }));
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        invoke('save_to_downloads', { path: it.path })
          .then((p) => invoke('reveal_path', { path: p }))
          .catch(() => {});
      });
      grid.appendChild(card);
    }
  }

  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtSize = (n) => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? (n / 1e3).toFixed(0) + ' KB' : n + ' B';

  listen('shelf-items', (e) => {
    if (!running) return;
    const incoming = Array.isArray(e.payload) ? e.payload : [];
    for (const it of incoming) if (!items.some((x) => x.path === it.path)) items.push(it);
    render();
  }).then((u) => { unlisten = u; });

  // Si el WebView entrega los drops directamente (fallback sin evento Rust):
  document.addEventListener('drop', (e) => e.preventDefault());
  document.addEventListener('dragover', (e) => e.preventDefault());

  render();
  return {
    unmount() { running = false; unlisten(); },
  };
}
