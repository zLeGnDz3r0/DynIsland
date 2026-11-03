// Servidor estático mínimo para probar el frontend fuera de Tauri.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const candidate = resolve(root, `.${p}`);
    const rel = relative(root, candidate);
    if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    const file = await readFile(candidate);
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    res.end(file);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(8763, '127.0.0.1', () => console.log('http://localhost:8763'));
