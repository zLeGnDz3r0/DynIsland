import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
let count = 0;
for (const directory of ['src', 'tools']) {
  for (const name of readdirSync(join(root, directory), { recursive: true })) {
    if (!/\.(js|mjs)$/.test(name)) continue;
    const path = join(root, directory, name);
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (result.status !== 0) {
      console.error(path, result.stderr || result.error);
      process.exit(1);
    }
    count++;
  }
}
console.log(`${count} JavaScript modules passed syntax checks.`);
