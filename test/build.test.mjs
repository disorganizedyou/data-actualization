import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripModule, build } from '../build/build.mjs';
import { buildReport, collectNeeds } from '../src/shared/report.mjs';
import { buildPoster, buildContactsSheet, buildNeedsSheet } from '../src/shared/poster.mjs';
import { normalizeData } from '../src/shared/validate.mjs';
import { FULL } from './fixtures.mjs';

test('stripModule прибирає import/export', () => {
  const out = stripModule(`import { a, b } from './x.mjs';\nimport {\n  c,\n} from './y.mjs';\nexport const q = 1;\nexport function f() {}\nexport async function g() {}\nexport { a, b };\nconst z = 2;`, 't');
  assert.ok(!/import|export/.test(out), out);
  assert.match(out, /const q = 1/); assert.match(out, /function f\(\)/); assert.match(out, /async function g\(\)/);
  assert.throws(() => stripModule('export default 1', 't'));
  assert.throws(() => stripModule('const m = await import("x")', 't'));
});

test('збірка: два файли, CSP з хешами, без зовнішніх ресурсів', () => {
  const r = build({ version: 'test', outDir: mkdtempSync(join(tmpdir(), 'anketa-build-')) });
  assert.equal(Object.keys(r).length, 2);
  for (const f of Object.keys(r)) {
    const html = readFileSync(f, 'utf8');
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /script-src 'sha256-[^']+' 'sha256-[^']+' 'sha256-[^']+'/);
    assert.ok(!/unsafe-inline'[^;]*;[^;]*script/.test(html));
    assert.ok(!/<script[^>]+src=/.test(html), 'жодного зовнішнього скрипта');
    assert.ok(!/<link[^>]+href=/.test(html), 'жодного зовнішнього стилю');
    assert.ok(!/https?:\/\/[^"'\s]*\.(js|css)/.test(html.replace(/pdfmake\.org|mozilla\.org/g, '')), 'немає посилань на зовнішні ресурси');
    assert.ok(!/<!--(CSP|CSS|SCRIPTS|VERSION)-->/.test(html));
    assert.ok(html.length < 2.5 * 1024 * 1024);
    if (f.endsWith('anketa.html')) assert.ok(!/function buildPoster/.test(html), 'в анкеті немає коду плаката');
  }
  assert.throws(() => build({ version: '<script>', outDir: mkdtempSync(join(tmpdir(), 'anketa-build-')) }), /версії/);
});

test('docDefinition звіту й плаката будуються без винятків для повної та порожньої анкети', () => {
  for (const d of [normalizeData(FULL), normalizeData({})]) {
    const r = buildReport(d, { kind: 'report', created: '2026-10-31T10:00:00Z', version: 'test' });
    assert.ok(Array.isArray(r.content) && r.content.length > 10);
    assert.ok(r.files['data.json']); assert.match(r.info.FormData, /^DANIFORM2:/);
    assert.equal(typeof r.footer(1, 2).columns[1].text, 'string');
    const dr = buildReport(d, { kind: 'draft' });
    assert.ok(dr.background, 'чернетка має водяний знак');
    for (const sc of [1, .75, .5]) { const p = buildPoster(d, sc); assert.ok(p.content.length >= 5); p.footer(1, 1); }
  }
  const sheet = buildContactsSheet([{ data: normalizeData(FULL) }, { data: normalizeData({}) }]);
  assert.ok(sheet.content.length >= 3);
  const needs = buildNeedsSheet([{ data: normalizeData(FULL) }, { data: normalizeData({}) }]);
  assert.ok(needs.content.length >= 4);
  const warned = buildPoster(normalizeData(FULL), 1, { warn: 'Чернетка' });
  assert.ok(JSON.stringify(warned.content[0]).includes('ЧЕРНЕТКА'));
});

test('collectNeeds збирає потреби й зауваги', () => {
  const n = collectNeeds(normalizeData(FULL));
  const txt = n.map(x => x.what).join('\n');
  assert.match(txt, /Бракує медмайна: турнікети/); assert.match(txt, /спальників/); assert.match(txt, /Хімзахист — частково/); assert.match(txt, /НРК немає/); assert.match(txt, /Потрібна допомога/);
  assert.ok(!/бракує — бракує/.test(txt));
});
