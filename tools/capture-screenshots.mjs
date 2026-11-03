// Capture the real frontend in Chromium with an in-memory Tauri IPC fixture.
// Install Playwright separately, then run:
//   node tools/capture-screenshots.mjs [absolute-path-to-playwright/index.mjs]
// These are browser previews, not evidence of native platform integration.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'docs', 'screenshots');
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, [join(root, 'tools', 'serve.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  await Promise.race([
    once(server.stdout, 'data'),
    once(server, 'exit').then(([code]) => { throw new Error(`Preview exited: ${code}`); }),
    new Promise((_, reject) => { setTimeout(() => reject(new Error('Preview startup timeout')), 10000).unref(); }),
  ]);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 760, height: 440 }, deviceScaleFactor: 2, locale: 'es-ES', timezoneId: 'Europe/Madrid', colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const fixed = new Date('2026-11-03T15:24:00Z').getTime();
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixed])); }
      static now() { return fixed; }
    };
    const day = '2026-11-03';
    const values = {
      lastPage: 0, islandScale: 1,
      pageOrder: ['music', 'pomodoro', 'water', 'shelf', 'todo'],
      pomodoro: { mode: 'focus', remaining: 18 * 60 + 42, deadline: 0 },
      water: { date: day, ml: 1250, goalMl: 2000, remind: false },
      ['todo:' + day]: [
        { text: 'Revisar el concepto de la nueva interfaz', done: true },
        { text: 'Preparar la presentación del proyecto', done: false },
        { text: 'Reservar 25 minutos para leer', done: false },
      ],
    };
    const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#241749"/><stop offset="1" stop-color="#a861b3"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="280" cy="130" r="92" fill="#f7b5a3"/><path d="M0 300L150 155L260 300L400 200V400H0Z" fill="#18172d"/><path d="M0 360L180 230L340 400H0" fill="#4c3d71"/><text x="30" y="52" fill="#fff" font-family="sans-serif" font-size="24" letter-spacing="4">NIGHT DRIVE</text><text x="30" y="365" fill="#d7c8e8" font-family="sans-serif" font-size="14" letter-spacing="3">NOVA · DEMO ALBUM</text></svg>`;
    const track = { title: 'Midnight Signals', artist: 'Nova · Night Drive', position: 83000, duration: 224000, playing: false, thumb: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(artwork))), last_play_ms: fixed, source: 'Demo Player' };
    const listeners = new Map();
    window.__demoEmit = (name, payload) => { for (const fn of listeners.get(name) || []) fn({ payload }); };
    window.__TAURI__ = {
      core: { invoke: async (name, payload = {}) => {
        if (name === 'store_get') return structuredClone(values[payload.key] ?? null);
        if (name === 'store_set') { values[payload.key] = structuredClone(payload.value); return null; }
        if (name === 'get_status') return { battery: 82, charging: false, wifi: 91 };
        if (name === 'pill_snapshot' || name === 'media_snapshot') return structuredClone(track);
        return null;
      } },
      event: { listen: async (name, fn) => {
        const set = listeners.get(name) || new Set(); listeners.set(name, set); set.add(fn);
        return () => set.delete(fn);
      } },
      window: { getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }) },
    };
  });
  await page.goto('http://127.0.0.1:8763/', { waitUntil: 'networkidle' });
  await page.mouse.move(380, 10);
  await page.locator('#pill.shown').waitFor();
  await page.locator('#pill').screenshot({ path: join(output, 'pill.png'), omitBackground: true, animations: 'disabled' });
  await page.locator('#pill').click({ position: { x: 20, y: 22 } });
  const panel = page.locator('#panel');
  const captures = [
    ['music', '#m-title', 'Midnight Signals'],
    ['pomodoro', '#p-time', '18:42'],
    ['water', '#w-pct', '63%'],
    ['shelf', '#s-grid', null],
    ['todo', '#t-count', '1/3 Task Done Today'],
  ];
  for (let i = 0; i < captures.length; i++) {
    const [name, selector, expected] = captures[i];
    if (i) await page.locator('#nav-next').click();
    await page.locator(`[data-page="${name}"]`).waitFor();
    if (name === 'shelf') {
      await page.evaluate(() => window.__demoEmit('shelf-items', [
        { id: 'demo-1', name: 'Brief creativo.pdf', path: '/demo/Brief creativo.pdf', size: 1240000, is_dir: false },
        { id: 'demo-2', name: 'Ideas.md', path: '/demo/Ideas.md', size: 8400, is_dir: false },
        { id: 'demo-3', name: 'Referencias', path: '/demo/Referencias', size: 0, is_dir: true },
      ]));
    }
    await page.locator(selector).waitFor({ state: 'visible' });
    if (expected) await page.waitForFunction(({ selector, expected }) => document.querySelector(selector).textContent === expected, { selector, expected });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(740, 400);
    await page.waitForTimeout(350);
    await panel.screenshot({ path: join(output, `${name}.png`), omitBackground: true, animations: 'disabled' });
    console.log(`Captured ${name}`);
  }
  await page.locator('#gear').click();
  await page.locator('#o-list .order-item').first().waitFor();
  await page.mouse.move(740, 400);
  await page.waitForTimeout(350);
  await panel.screenshot({ path: join(output, 'settings.png'), omitBackground: true, animations: 'disabled' });
  assert.deepEqual(errors, [], 'Frontend page errors');
  await writeFile(join(output, 'README.md'), '# Capturas de demostración\n\nInterfaz real de DynIsland renderizada en Chromium mediante el frontend del proyecto, con un puente IPC de demostración en memoria. No son mockups ni pruebas de la integración nativa Windows/Linux. La música, portada, archivos, tareas, batería, WiFi, fecha y progreso son ficticios. No se leen ni escriben datos del usuario.\n\nRegeneración: instala Playwright y Chromium fuera del proyecto, y ejecuta `node tools/capture-screenshots.mjs /ruta/a/playwright/index.mjs`.\n');
  console.log(`Seven real interface screenshots saved to ${output}`);
} finally {
  await browser?.close();
  server.kill();
}
