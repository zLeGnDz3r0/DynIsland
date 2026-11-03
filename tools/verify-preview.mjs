import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url))], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  await Promise.race([
    once(server.stdout, 'data'),
    once(server, 'exit').then(([code]) => { throw new Error(`Server exited: ${code}`); }),
    new Promise((_, reject) => { setTimeout(() => reject(new Error('Server startup timed out')), 5000).unref(); }),
  ]);
  const base = 'http://127.0.0.1:8763';
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/core/ipc.js`)).status, 200);
  for (const path of ['/..%2fsrc-tauri%2fCargo.toml', '/..%5cREADME.md']) {
    assert.equal((await fetch(base + path)).status, 403, path);
  }
  assert.equal((await fetch(`${base}/missing-file`)).status, 404);
  console.log('Preview checks passed: HTML, modules, traversal rejection and 404.');
} finally {
  server.kill();
}
