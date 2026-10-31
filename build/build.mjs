#!/usr/bin/env node
// Збірка двох самодостатніх HTML-файлів без залежностей:
//   dist/anketa.html      — анкета для підрозділів
//   dist/medsluzhba.html  — інструмент медслужби (плакати зі звітів)
//
// Модулі з src/ склеюються в один класичний <script>: рядки import видаляються, слово export — прибирається.
// Правила для модулів: лише іменовані export-и, унікальні імена на верхньому рівні, import тільки з ./ шляхів.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(resolve(ROOT, p), 'utf8');

export const SHARED = ['text', 'icons', 'schema', 'validate', 'codec', 'pdfkit', 'report', 'poster'].map(n => `src/shared/${n}.mjs`);
export const TARGETS = {
  'dist/anketa.html': { template: 'src/form/index.html', css: 'src/form/form.css', modules: [...SHARED, 'src/form/app.mjs'] },
  'dist/medsluzhba.html': { template: 'src/med/index.html', css: 'src/med/med.css', modules: [...SHARED, 'src/med/app.mjs'] },
};

export function stripModule(src, name) {
  let out = src
    .replace(/^import\s[^]*?from\s+['"][^'"]+['"];?\s*$/gm, '')   // import { a, b } from './x.mjs';
    .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')               // import './x.mjs';
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '')                    // export { a, b };
    .replace(/^export\s+(const|let|function|async function|class)\s/gm, '$1 ');
  if (/^\s*export\s/m.test(out)) throw new Error(`${name}: непідтримувана форма export`);
  if (/\bimport\s*\(/.test(out)) throw new Error(`${name}: динамічний import не підтримується`);
  return `// ---- ${name} ----\n${out.trim()}\n`;
}

const fontData = () => {
  const dir = resolve(ROOT, 'vendor/fonts');
  return Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.otf')).sort()
    .map(f => [f, readFileSync(resolve(dir, f)).toString('base64')]));
};

const FONT_SETUP = `
pdfMake.addVirtualFileSystem(FONT_DATA);
pdfMake.setFonts({
  eU:{ normal:'eU-Regular.otf', bold:'eU-Medium.otf', italics:'eU-Regular.otf', bolditalics:'eU-Medium.otf' },
  eUH:{ normal:'eUH-Medium.otf', bold:'eUH-Bold.otf', italics:'eUH-Medium.otf', bolditalics:'eUH-Bold.otf' },
});
(function(){
  const buf = f => Uint8Array.from(atob(FONT_DATA[f]), c => c.charCodeAt(0)).buffer;
  [['eUkraine','eU-Regular.otf','400'], ['eUkraine','eU-Medium.otf','600'], ['eUkraineHead','eUH-Medium.otf','500'], ['eUkraineHead','eUH-Bold.otf','700']]
    .forEach(([fam, f, weight]) => document.fonts.add(new FontFace(fam, buf(f), { weight })));
})();`;

const sha = s => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

export function build({ version = process.env.BUILD_VERSION || gitVersion() } = {}) {
  mkdirSync(resolve(ROOT, 'dist'), { recursive: true });
  const vendor = read('vendor/pdfmake.min.js');
  const fonts = `const FONT_DATA = ${JSON.stringify(fontData())};${FONT_SETUP}`;
  const results = {};
  for (const [out, t] of Object.entries(TARGETS)) {
    checkDuplicates(t.modules);
    const app = `(() => {\n'use strict';\nconst BUILD_VERSION = ${JSON.stringify(version)};\n${t.modules.map(m => stripModule(read(m), m)).join('\n')}\n})();`;
    const scripts = [vendor, fonts, app];
    const csp = [
      "default-src 'none'",
      `script-src ${scripts.map(sha).join(' ')}`,
      "style-src 'unsafe-inline'",
      'img-src data: blob:',
      'font-src data:',
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; ');
    const html = read(t.template)
      .replace('<!--CSP-->', () => `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
      .replace('<!--CSS-->', () => `<style>\n${read(t.css)}\n</style>`)
      .replace('<!--SCRIPTS-->', () => scripts.map(s => `<script>${s}</script>`).join('\n'))   // функції-замінники: у pdfmake є «$&»-подібні послідовності
      .replace(/<!--VERSION-->/g, () => version);
    if (/<!--(CSP|CSS|SCRIPTS)-->/.test(html)) throw new Error(`${t.template}: не всі плейсхолдери замінено`);
    writeFileSync(resolve(ROOT, out), html);
    results[out] = html.length;
  }
  return results;
}

// Модулі склеюються в одну область видимості — однакові імена на верхньому рівні перекриють одне одного
function checkDuplicates(modules) {
  const seen = new Map();
  for (const m of modules) {
    const names = [...read(m).matchAll(/^(?:export\s+)?(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(x => x[1]);
    for (const n of names) {
      if (seen.has(n)) throw new Error(`Дубль імені «${n}» у ${m} та ${seen.get(n)}`);
      seen.set(n, m);
    }
  }
}

function gitVersion() {
  try {
    const { execSync } = require('node:child_process');
    return execSync('git describe --always --dirty', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { return 'dev'; }
}
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = build();
  for (const [f, n] of Object.entries(r)) console.log(`${f}  ${(n / 1024).toFixed(0)} KB`);
}
