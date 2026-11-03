// Genera el sprite SVG de Heroicons (symbols) y lo inyecta en index.html
// entre los marcadores ICONS-START / ICONS-END.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'assets', 'heroicons');
const htmlPath = join(root, 'src', 'index.html');

function symbol(name, file, solid) {
  const svg = readFileSync(file, 'utf8');
  const inner = svg.replace(/[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').trim();
  const attrs = solid
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="1.5"';
  return `  <symbol id="i-${name}" viewBox="0 0 24 24" ${attrs}>${inner}</symbol>`;
}

const parts = ['<svg xmlns="http://www.w3.org/2000/svg" style="display:none">'];
for (const f of readdirSync(join(src, 'outline')).filter((f) => f.endsWith('.svg'))) {
  parts.push(symbol(f.replace('.svg', ''), join(src, 'outline', f), false));
}
for (const f of readdirSync(join(src, 'solid')).filter((f) => f.endsWith('.svg'))) {
  parts.push(symbol(f.replace('.svg', ''), join(src, 'solid', f), true));
}
parts.push('</svg>');
const sprite = parts.join('\n');

writeFileSync(join(root, 'src', 'assets', 'icons.svg'), sprite);

let html = readFileSync(htmlPath, 'utf8');
const re = /<!-- ICONS-START -->[\s\S]*?<!-- ICONS-END -->/;
const block = `<!-- ICONS-START -->\n${sprite}\n<!-- ICONS-END -->`;
if (re.test(html)) html = html.replace(re, block);
else html = html.replace('<body>', `<body>\n${block}`);
writeFileSync(htmlPath, html);
console.log(`Sprite con ${parts.length - 2} iconos inyectado en index.html`);
