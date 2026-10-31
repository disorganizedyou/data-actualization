#!/usr/bin/env node
// Збірка двох самодостатніх HTML-файлів без залежностей:
//   dist/anketa.html      — анкета для підрозділів
//   dist/medsluzhba.html  — інструмент медслужби (плакати зі звітів)
//
// Модулі з src/ склеюються в один класичний <script>: рядки import видаляються, слово export — прибирається.
// Правила для модулів: лише іменовані export-и, унікальні імена на верхньому рівні, import тільки з ./ шляхів.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(resolve(ROOT, p), 'utf8');

const shared = (...names) => ['text', 'icons', 'schema', 'validate', 'codec', 'pdfkit', 'report', ...names].map(n => `src/shared/${n}.mjs`);
// В анкеті модуля плаката немає взагалі — підрозділи плакат не генерують
export const TARGETS = {
  'anketa.html': { template: 'src/form/index.html', css: 'src/form/form.css', modules: [...shared(), 'src/form/app.mjs'] },
  'medsluzhba.html': { template: 'src/med/index.html', css: 'src/med/med.css', modules: [...shared('poster'), 'src/med/app.mjs'] },
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

// Звірка сторонніх файлів із vendor/MANIFEST.json (що саме вбудовано і чи не підмінено)
export function checkVendor({ update = false } = {}) {
  const mp = resolve(ROOT, 'vendor/MANIFEST.json');
  const manifest = JSON.parse(readFileSync(mp, 'utf8'));
  const bad = [];
  for (const it of manifest.items) {
    const actual = createHash('sha256').update(readFileSync(resolve(ROOT, it.file))).digest('hex');
    if (actual !== it.sha256) { if (update) it.sha256 = actual; else bad.push(`${it.file}: sha256 ${actual} ≠ ${it.sha256} у маніфесті`); }
  }
  if (update) writeFileSync(mp, JSON.stringify(manifest, null, 2) + '\n');
  if (bad.length) throw new Error('Сторонні файли не збігаються з vendor/MANIFEST.json:\n' + bad.join('\n') + '\nЯкщо оновлення навмисне: node build/build.mjs --update-manifest');
  const pm = read('vendor/pdfmake.min.js').match(/pdfmake v([\d.]+[\w.-]*)/);
  const declared = manifest.items.find(i => i.file === 'vendor/pdfmake.min.js').version;
  if (!pm || pm[1] !== declared) throw new Error(`Версія pdfmake у файлі (${pm && pm[1]}) ≠ у маніфесті (${declared})`);
  return manifest;
}

const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsString = s => JSON.stringify(s).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, c => '\\u' + c.charCodeAt(0).toString(16));

export function build({ version = process.env.BUILD_VERSION || gitVersion(), outDir = resolve(ROOT, 'dist') } = {}) {
  checkVendor();
  if (!/^[\w.\-+]{1,40}$/.test(version)) throw new Error(`Недопустимий рядок версії: ${version}`);
  mkdirSync(outDir, { recursive: true });
  const vendor = read('vendor/pdfmake.min.js');
  const fonts = `const FONT_DATA = ${JSON.stringify(fontData())};${FONT_SETUP}`;
  const results = {};
  for (const [name, t] of Object.entries(TARGETS)) {
    const out = resolve(outDir, name);
    checkDuplicates(t.modules);
    const app = `(() => {\n'use strict';\nconst BUILD_VERSION = ${jsString(version)};\n${t.modules.map(m => stripModule(read(m), m)).join('\n')}\n})();`;
    syntaxCheck(app, name);
    const scripts = [vendor, fonts, app];
    for (const sc of scripts) if (/<\/script/i.test(sc) || (/<!--/.test(sc) && /<script/i.test(sc))) throw new Error(`${name}: тіло скрипта зламає HTML-парсер (</script або <!-- … <script)`);
    const csp = [
      "default-src 'none'",
      `script-src ${scripts.map(sha).join(' ')}`,
      "style-src 'unsafe-inline'",
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; ');
    const html = read(t.template)
      .replace('<!--CSP-->', () => `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
      .replace('<!--CSS-->', () => `<style>\n${read(t.css)}\n</style>`)
      .replace('<!--SCRIPTS-->', () => scripts.map(s => `<script>${s}</script>`).join('\n'))   // функції-замінники: у pdfmake є «$&»-подібні послідовності
      .replace(/<!--VERSION-->/g, () => escHtml(version));
    if (/<!--(CSP|CSS|SCRIPTS)-->/.test(html)) throw new Error(`${t.template}: не всі плейсхолдери замінено`);
    writeFileSync(out, html);
    results[out] = html.length;
  }
  return results;
}

// Класичний скрипт із залишком import/export не розпарситься — перевіряємо синтаксис до запису
function syntaxCheck(code, name) {
  try { new Script(code, { filename: name }); } catch (e) { throw new Error(`${name}: зібраний скрипт не парситься: ${e.message}`); }
}

// Модулі склеюються в одну область видимості — однакові імена на верхньому рівні перекриють одне одного
function checkDuplicates(modules) {
  const seen = new Map();
  for (const m of modules) {
    const src = read(m);
    const names = [...src.matchAll(/^(?:export\s+)?(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(x => x[1]);
    for (const m2 of src.matchAll(/^(?:export\s+)?(?:const|let|var)\s+\{([^}]*)\}/gm)) names.push(...m2[1].split(',').map(x => x.split(':').pop().trim()).filter(Boolean));
    for (const n of names) {
      if (seen.has(n)) throw new Error(`Дубль імені «${n}» у ${m} та ${seen.get(n)}`);
      seen.set(n, m);
    }
  }
}

// Версія збірки: дата + 7 знаків хешу вихідних файлів (детерміновано, не залежить від git)
function gitVersion() {
  const h = createHash('sha256');
  const files = ['src/shared', 'src/form', 'src/med', 'build', 'vendor'].flatMap(dir => readdirSync(resolve(ROOT, dir), { withFileTypes: true, recursive: true })
    .filter(e => e.isFile()).map(e => resolve(e.parentPath ?? e.path, e.name))).sort();
  for (const f of files) h.update(f.slice(ROOT.length)).update(readFileSync(f));
  return `v2-${h.digest('hex').slice(0, 7)}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--update-manifest')) { checkVendor({ update: true }); console.log('vendor/MANIFEST.json оновлено'); }
  const r = build();
  for (const [f, n] of Object.entries(r)) console.log(`${f}  ${(n / 1024).toFixed(0)} KB`);
}
