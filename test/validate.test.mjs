import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, normalizeData, validateData, errorsOf, warningsOf, progressOf, normCoords, isCoords, normPhone } from '../src/shared/validate.mjs';
import { SECTIONS, STEPS, emptyData, stepOfSection, POINT_FIELDS } from '../src/shared/schema.mjs';
import { FULL, LEGACY_V1 } from './fixtures.mjs';

const TODAY = '2026-10-31';
const errs = d => errorsOf(validateData(normalizeData(d), { today: TODAY }));
const warns = d => warningsOf(validateData(normalizeData(d), { today: TODAY }));
const clone = () => JSON.parse(JSON.stringify(FULL));

test('схема: кожен розділ має крок, ключі унікальні', () => {
  const keys = new Set();
  for (const s of SECTIONS) {
    assert.ok(stepOfSection(s.id), `розділ ${s.id} без кроку`);
    for (const f of s.fields || []) { assert.ok(!keys.has(f.k), `дубль ключа ${f.k}`); keys.add(f.k); }
  }
  const pk = POINT_FIELDS.map(f => f.k);
  assert.equal(new Set(pk).size, pk.length);
  assert.equal(STEPS.at(-1).final, true);
});

test('повністю заповнена анкета — без помилок', () => {
  const e = errs(FULL);
  assert.deepEqual(e.map(x => `${x.path}: ${x.msg}`), []);
  const p = progressOf(normalizeData(FULL));
  assert.equal(p.done, p.total);
});

test('порожня анкета — всі обов’язкові поля як помилки, прогрес 0', () => {
  const e = errs(emptyData());
  assert.ok(e.length >= 30, `очікувалось ≥30 помилок, є ${e.length}`);
  assert.ok(e.some(x => x.path === 'unit'));
  assert.ok(e.some(x => x.path === 'points.0.nrk'));
  assert.ok(e.some(x => x.path === 'points.0.hypo_heat'));
  assert.ok(e.some(x => x.path === 'points.0.ppe'));
  assert.equal(progressOf(normalizeData(emptyData())).done, 0);
});

test('телефони: нормалізація й перевірка', () => {
  assert.equal(normPhone('0671234567'), '+380 67 123 45 67');
  assert.equal(normPhone('380671234567'), '+380 67 123 45 67');
  assert.equal(normPhone('+38 (067) 123-45-67'), '+380 67 123 45 67');
  assert.equal(normPhone('80671234567'), '+380 67 123 45 67');
  assert.ok(KINDS.phone.ok('+380 67 123 45 67'));
  assert.ok(!KINDS.phone.ok('067123'));
  assert.ok(!KINDS.phone.ok('Сокіл'));
});

test('MGRS: нормалізація й межі', () => {
  assert.equal(normCoords('37udq1234567890'), '37U DQ 12345 67890');
  assert.equal(normCoords('37U DQ 123 456'), '37U DQ 123 456');
  assert.equal(normCoords('07U DQ 12 34'), '7U DQ 12 34');
  assert.ok(isCoords('37U DQ 12345 67890'));
  assert.ok(!isCoords('37U DQ 1234 67890'), 'непарна кількість цифр');
  assert.ok(!isCoords('61U DQ 12345 67890'), 'зона понад 60');
  assert.ok(!isCoords('37I DQ 12345 67890'), 'літера I заборонена');
  const d = clone(); d.points[0].coords = '18T WL 12345 67890';
  assert.ok(warns(d).some(w => w.path === 'points.0.coords' && /поза/.test(w.msg)), 'координати поза Україною — попередження');
  assert.equal(errs(d).length, 0);
});

test('месенджери: формати', () => {
  assert.ok(KINDS.signal.ok('kit.07')); assert.ok(KINDS.signal.ok('+380 67 123 45 67')); assert.ok(!KINDS.signal.ok('kit'));
  assert.equal(KINDS.element.norm('@kit:matrix.org'), 'kit'); assert.ok(KINDS.element.ok('kit')); assert.ok(!KINDS.element.ok('kit room'));
  assert.ok(KINDS.discord.ok('tyl_2mb')); assert.ok(KINDS.discord.ok('Old User#1234')); assert.ok(!KINDS.discord.ok('a'));
});

test('позивний і підрозділ', () => {
  assert.ok(KINDS.callsign.ok('Сокіл')); assert.ok(KINDS.callsign.ok('Сокіл-2')); assert.ok(!KINDS.callsign.ok('+380671234567'), 'телефон замість позивного');
  assert.ok(!KINDS.callsign.ok('http://x'));
  assert.equal(KINDS.unit.norm('  2 мб '), '2 МБ'); assert.ok(KINDS.unit.ok('2 МБ')); assert.ok(!KINDS.unit.ok('надто довга назва підрозділу'));
});

test('умовна обов’язковість: примітки з’являються лише за відповідних відповідей', () => {
  const d = clone();
  d.points[1].supplied = 'Ні'; delete d.points[1].supplied_note;
  assert.ok(errs(d).some(x => x.path === 'points.1.supplied_note'));
  d.points[1].supplied = 'Так'; d.points[1].supplied_note = 'сміття';
  const n = normalizeData(d);
  assert.equal(n.points[1].supplied_note, undefined, 'приховане поле очищається');
  d.points[1].ppe = 'Частково';
  assert.ok(errs(d).some(x => x.path === 'points.1.ppe_note'));
  d.points[1].ppe = 'Є';
  assert.ok(!errs(d).some(x => x.path === 'points.1.ppe_note'), 'за «Є» уточнення необов’язкове');
  d.mp_help = 'Так'; delete d.mp_help_note;
  assert.ok(errs(d).some(x => x.path === 'mp_help_note'));
});

test('НРК: за «Є» обов’язкові кількість і три ознаки; за одного НРК «Частково» неможливе', () => {
  const d = clone();
  d.points[1].nrk = 'Є';
  const e = errs(d).map(x => x.path);
  for (const k of ['nrk_count', 'nrk_reb', 'nrk_cam', 'nrk_mic']) assert.ok(e.includes(`points.1.${k}`), k);
  d.points[0].nrk_count = '1';
  assert.ok(errs(d).some(x => x.path === 'points.0.nrk_count' && /Частково/.test(x.msg)));
  d.points[0].nrk_count = '0';
  assert.ok(errs(d).some(x => x.path === 'points.0.nrk_count' && /менше/.test(x.msg)));
  d.points[1].nrk = 'Немає'; d.points[1].nrk_count = '5';
  assert.equal(normalizeData(d).points[1].nrk_count, undefined, 'за «Немає» кількість очищається');
});

test('гіпотермія та хімзахист обов’язкові для кожної точки', () => {
  const d = clone();
  delete d.points[1].hypo_bag; delete d.points[1].ppe;
  const e = errs(d).map(x => x.path);
  assert.ok(e.includes('points.1.hypo_bag')); assert.ok(e.includes('points.1.ppe'));
});

test('підготовка: хоча б один рівень або «інше»', () => {
  const d = clone();
  for (const k of Object.keys(d.points[1])) if (k.startsWith('training_')) delete d.points[1][k];
  assert.ok(errs(d).some(x => x.path === 'points.1.training_asm' && /хоча б/.test(x.msg)));
  d.points[1].training_other = 'санінструктор';
  assert.ok(!errs(d).some(x => x.path.startsWith('points.1.training')));
  d.points[1].training_cls = 'x';
  assert.ok(errs(d).some(x => x.path === 'points.1.training_cls'));
});

test('чергові: усі чотири месенджери «Немає» — помилка; «Немає» зараховується як заповнене', () => {
  const d = clone();
  for (const k of ['phone', 'signal', 'element', 'discord']) d[`s4_${k}`] = 'Немає';
  assert.ok(errs(d).some(x => x.path === 's4_phone' && /хоча б один/.test(x.msg)));
  d.s4_phone = '0501112233';
  assert.equal(errs(d).length, 0);
  assert.equal(normalizeData(d).s4_phone, '+380 50 111 22 33');
});

test('перехресні звірки: дата, дублікати, суперечності забезпечення', () => {
  const d = clone();
  d.date = '2027-01-01';
  assert.ok(errs(d).some(x => x.path === 'date' && /майбутньому/.test(x.msg)));
  d.date = '2026-08-01';
  assert.ok(warns(d).some(x => x.path === 'date'));
  d.date = FULL.date;
  d.points[1].name = 'сосна';
  assert.ok(errs(d).some(x => x.path === 'points.1.name' && /Така сама/.test(x.msg)));
  d.points[1].name = 'Школа'; d.points[1].coords = d.points[0].coords;
  assert.ok(warns(d).some(x => x.path === 'points.1.coords'));
  d.points[1].coords = FULL.points[1].coords;
  d.points[1].supplied = 'Так'; d.points[1].need = 'Є'; d.points[1].need_note = 'щось';
  assert.ok(warns(d).some(x => x.path === 'points.1.need'));
  d.kb_phone = d.s4_phone = d.mp_phone = '+380 67 123 45 67';
  assert.ok(warns(d).some(x => x.path === 'kb_phone' && /Однаковий/.test(x.msg)));
});

test('позиції для скидів: обов’язкові за «Так», ігноруються за «Ні»', () => {
  const d = clone();
  d.positions = [];
  assert.ok(errs(d).some(x => x.path === 'positions'));
  d.positions = [{ name: 'Птах', coords: '37U DQ 11111 22222', weight: '150', flight: '0' }];
  const e = errs(d).map(x => x.path);
  assert.ok(e.includes('positions.0.weight')); assert.ok(e.includes('positions.0.flight'));
  d.drops = 'Ні';
  assert.equal(errs(d).filter(x => x.path.startsWith('positions')).length, 0);
  assert.deepEqual(normalizeData(d).positions, []);
  delete d.algo_carry; delete d.algo_hand; delete d.algo_time;
  assert.equal(errs(d).length, 0, 'алгоритм необов’язковий, якщо позицій немає');
  d.drops = 'Так';
  assert.ok(errs(d).some(x => x.path === 'algo_carry'));
});

test('нормалізація: відкидає невідомі ключі та небезпечні типи', () => {
  const n = normalizeData({ unit: 'мр', __proto__: { hack: 1 }, constructor: 'x', evil: '<script>', points: 'not-array', positions: [{ name: ['a'] }, null, 5] });
  assert.equal(n.unit, 'МР');
  assert.equal(n.evil, undefined); assert.equal(n.constructor, Object);
  assert.deepEqual(n.points, [{}]);
  assert.equal(n.positions.length, 0, 'positions приховані, бо drops не «Так»');
  const n2 = normalizeData({ drops: 'Так', positions: [{ name: ['a'] }, null, 5] });
  assert.equal(n2.positions.length, 3);
  assert.equal(n2.positions[0].name, 'a');
});

test('міграція даних старої форми: нові поля порожні, приховані значення зникли', () => {
  const n = normalizeData(LEGACY_V1);
  assert.equal(n.points[0].supplied_note, undefined);
  assert.equal(n.points[0].need_note, undefined);
  assert.equal(n.points[0].training_cls, '0');
  assert.deepEqual(n.positions, []);
  const e = errs(LEGACY_V1).map(x => x.path);
  for (const k of ['nrk', 'hypo_heat', 'hypo_bag', 'hypo_ready', 'ppe']) assert.ok(e.includes(`points.0.${k}`), k);
  assert.ok(!e.includes('unit'));
});

test('транслітерація імен файлів', async () => {
  const { translit, safeFileName } = await import('../src/shared/text.mjs');
  assert.equal(translit('2МБ'), '2MB');
  assert.equal(translit('Їжак Юрій Згорани'), 'Yizhak Yurii Zghorany');
  assert.equal(translit('1 РОТА'), '1 ROTA');
  assert.equal(safeFileName('Zvit_med_1 РОТА/медик_2026-10-30'), 'Zvit_med_1_ROTA_medyk_2026-10-30');
});
