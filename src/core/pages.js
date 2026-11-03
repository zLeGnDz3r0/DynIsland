// Registro de páginas y orden configurable por el usuario.
// Cada página se carga con import() dinámico LA PRIMERA VEZ que se muestra
// (lazy loading real: mientras no se haya visitado, su JS ni se evalúa).

import { store } from './ipc.js';

export const DEFAULT_ORDER = ['music', 'pomodoro', 'water', 'shelf', 'todo'];

export const REGISTRY = {
  music:    { title: 'Music',        loader: () => import('../widgets/music/index.js') },
  pomodoro: { title: 'Focus Timer',  loader: () => import('../widgets/pomodoro/index.js') },
  water:    { title: 'Water',        loader: () => import('../widgets/water/index.js') },
  shelf:    { title: 'Shelf',        loader: () => import('../widgets/shelf/index.js') },
  todo:     { title: 'Tasks',        loader: () => import('../widgets/todo/index.js') },
};

let order = [...DEFAULT_ORDER];
const loaded = new Map(); // id -> módulo

export async function initOrder() {
  const saved = await store.get('pageOrder');
  if (Array.isArray(saved)) {
    const valid = saved.filter((id) => REGISTRY[id]);
    for (const id of DEFAULT_ORDER) if (!valid.includes(id)) valid.push(id);
    order = valid;
  }
  return order;
}

export function getOrder() {
  return [...order];
}

export async function movePage(id, dir) {
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return order;
  [order[i], order[j]] = [order[j], order[i]];
  await store.set('pageOrder', order);
  return getOrder();
}

export function setOrder(newOrder) {
  order = [...newOrder];
  return store.set('pageOrder', order);
}

// Devuelve el módulo de una página, cargándolo bajo demanda (una sola vez).
export async function loadPage(id) {
  if (!loaded.has(id)) {
    const mod = await REGISTRY[id].loader();
    loaded.set(id, mod);
  }
  return loaded.get(id);
}
