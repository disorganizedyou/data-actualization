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
await page.waitForSelector('.bar');
await step(6);
assert.ok(await page.isDisabled('#report'), 'порожня форма: кнопка звіту має бути неактивна');
assert.match(await page.textContent('.check .box.warn h3'), /Лишилося заповнити/, 'порожня форма: незаповнене — окремо від помилок');
assert.equal(await page.$('.check .box.bad'), null, 'у порожній формі немає «помилок» — лише незаповнене');

console.log('▶ анкета: заповнення через UI');
await step(0);
assert.equal(await page.$$eval('[data-path="unit"] option', o => o.length), 31, 'список підрозділів: 30 + порожній варіант');
await page.selectOption('[data-path="unit"]', FULL.unit);
assert.match(await page.textContent('.brand p'), /2МБ/, 'підрозділ з’являється в шапці');
await fill('date', FULL.date);
await fill('author', FULL.author);
for (const r of ['kb', 's4', 'mp']) {
  await step(['kb', 's4', 'mp'].indexOf(r) + 1);   // черговий медпункту — на кроці «Медичні пункти» (3)
  await fill(`${r}_callsign`, FULL[`${r}_callsign`]);
  for (const c of ['phone', 'signal', 'element', 'discord']) {
    const v = FULL[`${r}_${c}`];
    if (v === 'Немає') await none(`${r}_${c}`); else await fill(`${r}_${c}`, c === 'phone' ? v.replace(/\D/g, '').replace(/^380/, '0') : v);
  }
  // телефон, введений як 0671234567, має нормалізуватися у +380 67 123 45 67
  assert.equal(await page.inputValue(`[data-path="${r}_phone"]`), FULL[`${r}_phone`]);
}

console.log('▶ анкета: медпункт');
await step(3);
assert.ok(!(await page.$('[data-add]')), 'медпункт один — кнопки «Додати» немає');
await fill('mp_coords', FULL.mp_coords);
await fill('mphead_callsign', FULL.mphead_callsign);
for (const c of ['phone', 'signal', 'element', 'discord']) { const v = FULL[`mphead_${c}`]; if (v === 'Немає') await none(`mphead_${c}`); else await fill(`mphead_${c}`, v); }

await step(4);
const fillPoint = async (i, p) => {
  const path = k => `points.${i}.${k}`;
  await fill(path('name'), p.name); await fill(path('coords'), p.coords.replace(/\s/g, '').toLowerCase());
  assert.equal(await page.inputValue(`[data-path="${path('coords')}"]`), p.coords, 'координати нормалізуються');
  await fill(path('contact'), p.contact); await seg(path('net'), p.net);
  if (p.net_note) await fill(path('net_note'), p.net_note);
  await seg(path('supplied'), p.supplied); if (p.supplied_note) await fill(path('supplied_note'), p.supplied_note);
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
// повторний дотик до вже обраного варіанта нічого не скидає
await seg('points.0.nrk', 'Є');
assert.equal(await page.inputValue('[data-path="points.0.nrk_count"]'), '2', 'повторний дотик не стирає залежні поля');
// згортання/розгортання картки не перемальовує сторінку (поле з фокусом лишається)
await page.focus('[data-path="points.0.nrk_note"]');
await page.click('[data-toggle="points:0"]');
assert.ok(await page.isHidden('[data-path="points.0.nrk_note"]'));
await page.click('[data-toggle="points:0"]');
assert.equal(await page.inputValue('[data-path="points.0.nrk_count"]'), '2');
await page.click('[data-add="points"]');
await fillPoint(1, FULL.points[1]);

await step(5);
// «Ні» → питання про інші підрозділи; обидва «Ні» → розділ алгоритму зникає
await seg('drops', 'Ні');
assert.ok(await page.isVisible('[data-field="drops_other"]'));
await seg('drops_other', 'Ні');
assert.ok(await page.isHidden('[data-section="algo"]'), 'скидів немає — алгоритм прихований');
await seg('drops_other', 'Так');
assert.ok(await page.isVisible('[data-section="algo"]'), 'скидають інші — алгоритм видно');
await seg('drops', FULL.drops);
assert.ok(await page.isHidden('[data-field="drops_other"]'));
assert.ok(await page.isVisible('[data-list="positions"]'));
assert.equal(await page.$$eval('[data-card="positions"]', e => e.length), 1, '«Так» — перша картка позиції з’являється сама');
assert.equal(await page.evaluate(() => document.activeElement.dataset.path), 'positions.0.name', 'курсор — у першому полі нової картки');
for (const [i, p] of FULL.positions.entries()) { if (i > 0) await page.click('[data-add="positions"]'); for (const k of Object.keys(p)) await fill(`positions.${i}.${k}`, p[k]); }
await fill('algo_carry', FULL.algo_carry); await fill('algo_hand', FULL.algo_hand); await fill('algo_time', FULL.algo_time);
// формування скидів медпунктом — на тому самому кроці «Медичні скиди»
await seg('mp_help', FULL.mp_help); await fill('mp_help_note', FULL.mp_help_note);
await seg('mp_std', FULL.mp_std); await fill('mp_std_qty', FULL.mp_std_qty);

console.log('▶ анкета: перевірка та звіт');
await step(6);
await page.screenshot({ path: resolve(OUT, 'check.png'), fullPage: true });
const errBox = await page.$('.check .box.bad') || await page.$('.check .box.warn:has(h3:text("Лишилося"))');
if (errBox) { console.error(await errBox.innerText()); throw new Error('на кроці перевірки лишилися помилки або незаповнені поля'); }
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
assert.equal(payload.data.mp_coords, FULL.mp_coords); assert.equal(payload.data.mphead_element, FULL.mphead_element);
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
await page.waitForSelector('.bar');
await page.click('#clear');
await page.setInputFiles('#open', report.path);
await page.waitForSelector('.notice');
assert.match(await page.textContent('.h2 small'), /Крок 1 з 7/, 'відкритий звіт починається з першого кроку');
assert.equal(await page.$$eval('.stp.unrev', e => e.length), 6, 'усі кроки «не переглянуто»');
await step(6);
assert.ok(await page.isDisabled('#report'), 'поки кроки не переглянуто — звіт не завантажується');
assert.match(await page.textContent('.check'), /Не переглянуто кроків/);
await step(0);
for (let i = 0; i < 6; i++) await page.click('#next');      // помилок немає — «Далі» переходить одразу
assert.match(await page.textContent('.h2 small'), /Крок 7 з 7/);
assert.equal(await page.$$eval('.stp.unrev', e => e.length), 0, 'після проходу кроків — усе переглянуто');
assert.ok(await page.isVisible('#today'), 'нагадування оновити дату після відкриття звіту');
assert.ok(await page.isVisible('.box.bad') === false);
assert.match(await page.textContent('.check'), /Дані не змінилися/, 'без змін — треба підтвердити актуальність');
for (const cb of await page.$$('[data-ack]')) { if (!(await cb.isChecked())) await cb.click(); }
const report2 = await download('#report');
const payload2 = await readPdfBytes(report2.bytes, { inflate });
assert.deepEqual(payload2.data, payload.data, 'дані після повторного відкриття ідентичні');

console.log('▶ анкета: відкриття звіту старої форми (v1)');
await page.goto(FORM);
await page.waitForSelector('.bar');
await page.setInputFiles('#open', resolve(ROOT, 'test/fixtures/legacy_v1.pdf'));
await page.waitForSelector('.notice');
assert.match(await page.textContent('.notice'), /старої версії/, 'повідомлення про стару версію не зникає само');
await step(6);
const legacyItems = await page.$$eval('.check .box li', els => els.map(e => e.textContent));
assert.ok(legacyItems.some(t => /НРК/.test(t)) && legacyItems.some(t => /хімзахист/.test(t)), 'старий звіт вимагає нові поля');
assert.ok(await page.isDisabled('#report'));

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
const needs = await mdl('#needs'); assert.equal(pageCount(needs.bytes), 1); assert.match(needs.name, /^Potreby_/);
// старий звіт: позначка «стара форма», а не червоні помилки
await mpage.setInputFiles('#open', resolve(ROOT, 'test/fixtures/legacy_v1.pdf'));
await mpage.waitForFunction(() => document.querySelectorAll('.tbl tbody tr:not(.det)').length === 2);
const legacyRow = await mpage.textContent('tr:has(.unit:text("МР")) .st');
assert.match(legacyRow, /стара форма/); assert.match(legacyRow, /1 помилка/, 'нові поля старого звіту — не «помилки»; єдина помилка — підрозділ «МР» не зі списку');
const regen = await mdl('[data-report]'); assert.match(regen.name, /^Zvit_med_/);

console.log('▶ анкета на екрані комп’ютера: клавіатура, «Далі», історія, дублювання, огляд змін');
const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'uk-UA' });
const dp = await dctx.newPage();
dp.on('pageerror', e => errors.push('desktop: ' + e.message));
dp.on('console', m => { if (m.type() === 'error') errors.push('desktop: ' + m.text()); });
dp.on('dialog', d => d.accept());
const focused = () => dp.evaluate(() => document.activeElement.dataset.path || document.activeElement.dataset.none || document.activeElement.id || document.activeElement.tagName);
const h2 = () => dp.textContent('.h2 small');
await dp.goto(FORM); await dp.waitForSelector('.bar');
assert.equal(await focused(), 'unit', 'на комп’ютері курсор одразу в першому полі');
await dp.selectOption('[data-path="unit"]', FULL.unit);
await dp.focus('[data-path="author"]'); await dp.keyboard.type(FULL.author);
await dp.keyboard.press('Control+Enter');
assert.match(await h2(), /Крок 2 з 7/, 'Ctrl+Enter — «Далі»');
assert.equal(await focused(), 'kb_callsign', 'після «Далі» курсор у першому полі кроку');
// двоетапне «Далі»: перше натискання лишає на кроці й показує пропуск
await dp.keyboard.press('Control+Enter');
assert.match(await h2(), /Крок 2 з 7/, 'з пропусками перше «Далі» не переходить');
assert.ok(await dp.isVisible('#navnote')); assert.match(await dp.textContent('#next'), /попри пропуски/);
// заповнення лише з клавіатури: Tab переходить між полями, пробіл ставить «Немає»
await dp.keyboard.type('Беркут'); await dp.keyboard.press('Tab');
await dp.keyboard.type('0671234567'); await dp.keyboard.press('Tab'); await dp.keyboard.press('Tab');
await dp.keyboard.type('berkut.07'); await dp.keyboard.press('Tab'); await dp.keyboard.press('Tab');
await dp.keyboard.type('berkut'); await dp.keyboard.press('Tab'); await dp.keyboard.press('Tab'); await dp.keyboard.press('Tab');
assert.equal(await focused(), 'kb_discord'); await dp.keyboard.press('Space');
assert.equal(await dp.inputValue('[data-path="kb_phone"]'), '+380 67 123 45 67', 'телефон нормалізовано');
assert.ok(await dp.isHidden('#navnote'), 'пропуски заповнено — «Далі» знову звичайне');
await dp.keyboard.press('Control+Enter');
assert.match(await h2(), /Крок 3 з 7/);
await dp.goBack(); await dp.waitForTimeout(150);
assert.match(await h2(), /Крок 2 з 7/, 'кнопка браузера «Назад» — попередній крок');
await dp.goForward(); await dp.waitForTimeout(150);
assert.match(await h2(), /Крок 3 з 7/, 'кнопка браузера «Вперед» — наступний крок');
// задовгий позивний — помилка, а не обрізання
const longCs = 'Дуже-довгий-позивний-якого-не-буває-насправді';
await dp.fill('[data-path="s4_callsign"]', longCs); await dp.dispatchEvent('[data-path="s4_callsign"]', 'change');
assert.equal(await dp.inputValue('[data-path="s4_callsign"]'), longCs, 'значення не обрізано');
assert.match(await dp.textContent('[data-field="s4_callsign"] .err'), /Задовгий текст/);
// скиди: «Так» з клавіатури — перша картка позиції з’являється сама; «15 хв» → 15
await dp.click('[data-step="5"]');
await dp.focus('.seg[data-path="drops"] .seg-btn[tabindex="0"]'); await dp.keyboard.press('Space');
assert.equal(await dp.$$eval('[data-card="positions"]', e => e.length), 1);
await dp.fill('[data-path="positions.0.flight"]', '15 хв'); await dp.dispatchEvent('[data-path="positions.0.flight"]', 'change');
assert.equal(await dp.inputValue('[data-path="positions.0.flight"]'), '15');
assert.equal(await dp.textContent('[data-field="positions.0.flight"] .err'), '');
// стрілки в перемикачі обирають варіант
await dp.focus('.seg[data-path="mp_help"] .seg-btn[tabindex="0"]'); await dp.keyboard.press('ArrowRight');
assert.equal(await dp.getAttribute('.seg[data-path="mp_help"] .seg-btn[data-val="Ні"]', 'aria-checked'), 'true');
// дублювання точки: копіюються відповіді, крім назви, координат і зв’язку
await dp.click('[data-step="4"]');
await dp.fill('[data-path="points.0.name"]', 'Сосна'); await dp.dispatchEvent('[data-path="points.0.name"]', 'change');
await dp.click('.seg[data-path="points.0.hypo_bag"] .seg-btn[data-val="Немає"]');
await dp.fill('[data-path="points.0.training_asm"]', '4'); await dp.dispatchEvent('[data-path="points.0.training_asm"]', 'change');
await dp.click('[data-dup="points:0"]');
assert.equal(await dp.$$eval('[data-card="points"]', e => e.length), 2);
assert.equal(await focused(), 'points.1.name', 'курсор — у назві копії');
assert.equal(await dp.inputValue('[data-path="points.1.name"]'), '');
assert.equal(await dp.getAttribute('.seg[data-path="points.1.hypo_bag"] .seg-btn[data-val="Немає"]', 'aria-checked'), 'true');
assert.equal(await dp.inputValue('[data-path="points.1.training_asm"]'), '4');
// висота порожньої картки точки на широкому екрані
await dp.click('[data-add="points"]');
const cardH = await dp.$eval('.card[data-idx="2"]', e => e.offsetHeight);
assert.ok(cardH <= 1450, `картка точки на 1440 px заввишки ${cardH} px`);
for (let i = 0; i < 7; i++) { await dp.click(`[data-step="${i}"]`); await dp.screenshot({ path: resolve(OUT, `desktop-${i + 1}.png`), fullPage: true }); }
// огляд змін відносно відкритого звіту
await dp.goto(FORM); await dp.waitForSelector('.bar');
await dp.click('#clear');
await dp.setInputFiles('#open', report.path); await dp.waitForSelector('.notice');
await dp.click('[data-step="1"]');
await dp.fill('[data-path="kb_phone"]', '0501112233'); await dp.dispatchEvent('[data-path="kb_phone"]', 'change');
await dp.click('[data-step="6"]');
assert.match(await dp.textContent('.rv-head'), /змінено 1 відповідь/);
assert.match(await dp.textContent('.rv tr.chg'), /було: \+380 67 123 45 67/);
await dp.check('#onlychg');
assert.equal(await dp.$$eval('.review tr', rows => rows.filter(r => r.offsetParent).length), 1, '«лише змінене» — один рядок');
await dp.screenshot({ path: resolve(OUT, 'desktop-review.png'), fullPage: true });
await dctx.close();

await browser.close();
if (errors.length) { console.error('Помилки консолі:\n' + errors.join('\n')); process.exit(1); }
writeFileSync(resolve(OUT, 'OK'), new Date().toISOString());
console.log('✓ наскрізний тест пройдено; файли в', OUT);
