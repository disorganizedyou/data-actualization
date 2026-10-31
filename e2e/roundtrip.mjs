#!/usr/bin/env node
// Наскрізний тест у справжньому Chromium (Playwright):
//   анкета: порожня форма блокує звіт → заповнення через UI → звіт PDF → повторне відкриття → той самий набір даних;
//   інструмент медслужби: відкриття звіту → плакат на 1 аркуш, усі плакати, зведення контактів.
// Запуск: node e2e/roundtrip.mjs   (потрібен playwright у NODE_PATH або /opt/node-tools)

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { readPdfBytes } from '../src/shared/codec.mjs';
import { FULL } from '../test/fixtures.mjs';

const require = createRequire(import.meta.url);
const pw = (() => { try { return require('playwright'); } catch { return require('/opt/node-tools/node_modules/playwright/index.js'); } })();
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.E2E_OUT || resolve(ROOT, 'e2e/out');
mkdirSync(OUT, { recursive: true });
const FORM = `file://${resolve(ROOT, 'dist/anketa.html')}`;
const MED = `file://${resolve(ROOT, 'dist/medsluzhba.html')}`;
const inflate = async d => new Uint8Array(inflateSync(Buffer.from(d)));
const pageCount = bytes => (Buffer.from(bytes).toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, locale: 'uk-UA' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', d => d.accept());

const fill = async (path, value) => { const sel = `[data-path="${path}"]`; await page.fill(sel, value); await page.dispatchEvent(sel, 'change'); };
const seg = async (path, value) => page.click(`.seg[data-path="${path}"] .seg-btn[data-val="${value}"]`);
const none = async path => page.click(`[data-none="${path}"]`);
const step = async i => page.click(`[data-step="${i}"]`);
const download = async selector => { const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]); const p = resolve(OUT, dl.suggestedFilename()); await dl.saveAs(p); return { path: p, name: dl.suggestedFilename(), bytes: new Uint8Array(readFileSync(p)) }; };

console.log('▶ анкета: порожня форма');
await page.goto(FORM);
await page.waitForSelector('#next');
await step(7);
assert.ok(await page.isDisabled('#report'), 'порожня форма: кнопка звіту має бути неактивна');
assert.match(await page.textContent('.box.bad h3'), /Потрібно виправити/);

console.log('▶ анкета: заповнення через UI');
await step(0);
await fill('unit', FULL.unit.toLowerCase()); // перевіряємо нормалізацію у ВЕЛИКІ
assert.equal(await page.inputValue('[data-path="unit"]'), FULL.unit);
await fill('date', FULL.date);
await fill('author', FULL.author);
for (const r of ['kb', 's4', 'mp']) {
  await step(['kb', 's4', 'mp'].indexOf(r) + 1);
  await fill(`${r}_callsign`, FULL[`${r}_callsign`]);
  for (const c of ['phone', 'signal', 'element', 'discord']) {
    const v = FULL[`${r}_${c}`];
    if (v === 'Немає') await none(`${r}_${c}`); else await fill(`${r}_${c}`, c === 'phone' ? v.replace(/\D/g, '').replace(/^380/, '0') : v);
  }
  // телефон, введений як 0671234567, має нормалізуватися у +380 67 123 45 67
  assert.equal(await page.inputValue(`[data-path="${r}_phone"]`), FULL[`${r}_phone`]);
}

await step(4);
const fillPoint = async (i, p) => {
  const path = k => `points.${i}.${k}`;
  await fill(path('name'), p.name); await fill(path('coords'), p.coords.replace(/\s/g, '').toLowerCase());
  assert.equal(await page.inputValue(`[data-path="${path('coords')}"]`), p.coords, 'координати нормалізуються');
  await fill(path('contact'), p.contact); await seg(path('net'), p.net);
  if (p.net_note) await fill(path('net_note'), p.net_note);
  await seg(path('supplied'), p.supplied); if (p.supplied_note) await fill(path('supplied_note'), p.supplied_note);
  await seg(path('need'), p.need); if (p.need_note) await fill(path('need_note'), p.need_note);
  await seg(path('nrk'), p.nrk);
  if (p.nrk === 'Є') { await fill(path('nrk_count'), p.nrk_count); for (const k of ['nrk_reb', 'nrk_cam', 'nrk_mic']) await seg(path(k), p[k]); if (p.nrk_note) await fill(path('nrk_note'), p.nrk_note); }
  for (const k of ['hypo_heat', 'hypo_bag', 'hypo_ready']) await seg(path(k), p[k]);
  if (p.hypo_note) await fill(path('hypo_note'), p.hypo_note);
  await seg(path('ppe'), p.ppe); if (p.ppe_note) await fill(path('ppe_note'), p.ppe_note);
  for (const k of Object.keys(p).filter(k => k.startsWith('training_'))) await fill(path(k), p[k]);
};
// приховане поле не повинно бути видимим до вибору
assert.ok(await page.isHidden('[data-field="points.0.nrk_count"]'), 'Кількість НРК прихована, поки НРК не обрано');
await fillPoint(0, FULL.points[0]);
assert.ok(await page.isVisible('[data-field="points.0.nrk_count"]'), 'Кількість НРК показано після «Є»');
await page.click('[data-add="points"]');
await fillPoint(1, FULL.points[1]);

await step(5);
await seg('drops', FULL.drops);
assert.ok(await page.isVisible('[data-list="positions"]'));
await page.click('[data-add="positions"]');
for (const [i, p] of FULL.positions.entries()) { if (i > 0) await page.click('[data-add="positions"]'); for (const k of Object.keys(p)) await fill(`positions.${i}.${k}`, p[k]); }
await fill('algo_carry', FULL.algo_carry); await fill('algo_hand', FULL.algo_hand); await fill('algo_time', FULL.algo_time);
await step(6);
await seg('mp_help', FULL.mp_help); await fill('mp_help_note', FULL.mp_help_note);
await seg('mp_std', FULL.mp_std); await fill('mp_std_qty', FULL.mp_std_qty);

console.log('▶ анкета: перевірка та звіт');
await step(7);
await page.screenshot({ path: resolve(OUT, 'check.png'), fullPage: true });
const errBox = await page.$('.box.bad');
if (errBox) { console.error(await errBox.innerText()); throw new Error('на кроці перевірки лишилися помилки'); }
// підтверджуємо зауваження, якщо є
for (const cb of await page.$$('[data-ack]')) { if (!(await cb.isChecked())) await cb.click(); }
assert.ok(await page.isEnabled('#report'), 'кнопка звіту активна після заповнення');
const report = await download('#report');
assert.equal(report.name, 'Zvit_med_2MB_2026-10-30.pdf');
console.log('  звіт:', report.name, report.bytes.length, 'байт,', pageCount(report.bytes), 'стор.');
const payload = await readPdfBytes(report.bytes, { inflate });
assert.equal(payload.kind, 'report');
assert.equal(payload.data.unit, FULL.unit);
assert.equal(payload.data.points.length, 2);
assert.equal(payload.data.points[0].nrk_count, '2');
assert.equal(payload.data.positions.length, FULL.positions.length);
// резервний шлях читання: псуємо маркер — має спрацювати вкладений data.json
const broken = Buffer.from(report.bytes); const mi = broken.indexOf('DANIFORM2:'); assert.ok(mi > 0); broken.write('XXXXXXXXX:', mi, 'latin1');
const viaFile = await readPdfBytes(new Uint8Array(broken), { inflate });
assert.deepEqual(viaFile.data, payload.data, 'дані з вкладеного файла збігаються з маркером');

const draft = await download('#draft');
assert.match(draft.name, /^Chernetka_2MB_/);
assert.equal((await readPdfBytes(draft.bytes, { inflate })).kind, 'draft');

console.log('▶ анкета: повторне відкриття звіту');
await page.goto(FORM);
await page.waitForSelector('#next');
await page.click('#clear');
await page.setInputFiles('#open', report.path);
await page.waitForSelector('.box.ok');
for (const cb of await page.$$('[data-ack]')) { if (!(await cb.isChecked())) await cb.click(); }
const report2 = await download('#report');
const payload2 = await readPdfBytes(report2.bytes, { inflate });
assert.deepEqual(payload2.data, payload.data, 'дані після повторного відкриття ідентичні');

console.log('▶ медслужба: плакати');
const mpage = await ctx.newPage();
await mpage.setViewportSize({ width: 1280, height: 900 });
mpage.on('pageerror', e => errors.push('med: ' + e.message));
mpage.on('console', m => { if (m.type() === 'error') errors.push('med: ' + m.text()); });
mpage.on('dialog', d => d.accept());
await mpage.goto(MED);
await mpage.setInputFiles('#open', [report.path, draft.path]);
await mpage.waitForSelector('.tbl');
const rows = await mpage.$$('.tbl tbody tr:not(.det)');
assert.equal(rows.length, 1, 'той самий підрозділ двічі → один рядок');
assert.match(await mpage.textContent('.tbl .st'), /повний/, 'повний звіт має пріоритет над чернеткою з тією ж датою');
await mpage.click('[data-details]');
await mpage.screenshot({ path: resolve(OUT, 'med.png'), fullPage: true });
const mdl = async sel => { const [dl] = await Promise.all([mpage.waitForEvent('download'), mpage.click(sel)]); const p = resolve(OUT, dl.suggestedFilename()); await dl.saveAs(p); return { name: dl.suggestedFilename(), bytes: new Uint8Array(readFileSync(p)) }; };
const poster = await mdl('[data-poster]');
assert.equal(poster.name, 'Plakat_2MB_2026-10-30.pdf');
assert.equal(pageCount(poster.bytes), 1, 'плакат на один аркуш');
console.log('  плакат:', poster.name, poster.bytes.length, 'байт');
const all = await mdl('#all'); assert.ok(pageCount(all.bytes) >= 1);
const sheet = await mdl('#sheet'); assert.equal(pageCount(sheet.bytes), 1);
const regen = await mdl('[data-report]'); assert.match(regen.name, /^Zvit_med_/);

await browser.close();
if (errors.length) { console.error('Помилки консолі:\n' + errors.join('\n')); process.exit(1); }
writeFileSync(resolve(OUT, 'OK'), new Date().toISOString());
console.log('✓ наскрізний тест пройдено; файли в', OUT);
