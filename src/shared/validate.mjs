// Нормалізація значень, перевірка форматів, обов’язковість і перехресні звірки.
// Чиста логіка без DOM — використовується формою, інструментом медслужби й тестами.

import { SECTIONS, LEVELS, ROLES, CONTACT, NONE, SCHEMA_VERSION, POINT_FIELDS, POSITION_FIELDS,
  groupKeys, visible, required, stepOfSection, listDef } from './schema.mjs';
import { hasText, daysBetween, todayISO } from './text.mjs';

const digits = v => v.replace(/[\s()\-.]/g, '');
export function normPhone(v) {
  let n = digits(v);
  if (/^0\d{9}$/.test(n)) n = '+38' + n;
  else if (/^380\d{9}$/.test(n)) n = '+' + n;
  else if (/^80\d{9}$/.test(n)) n = '+3' + n;
  return /^\+380\d{9}$/.test(n) ? n.replace(/^(\+380)(\d{2})(\d{3})(\d{2})(\d{2})$/, '$1 $2 $3 $4 $5') : v.trim();
}
export const isPhone = v => /^\+\d{10,15}$/.test(digits(v));
export const num = v => parseFloat(String(v).replace(',', '.'));
const squash = v => v.replace(/\s+/g, ' ').trim();

// MGRS: зона 1–60, літера смуги C–X (без I, O), квадрат 100 км — дві літери, далі парна кількість цифр (2–10)
const MGRS_RE = /^(\d{1,2})([C-HJ-NP-X]) ([A-HJ-NP-Z]{2}) (\d{1,5}) (\d{1,5})$/;
export function normCoords(v) {
  const c = v.toUpperCase().replace(/[\s,;]+/g, ''), m = c.match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z]{2})(\d*)$/);
  if (!m || m[4].length % 2 !== 0 || m[4].length === 0) return squash(v);
  const h = m[4].length / 2;
  return `${+m[1]}${m[2]} ${m[3]} ${m[4].slice(0, h)} ${m[4].slice(h)}`;
}
export function isCoords(v) {
  const m = v.match(MGRS_RE);
  return !!m && +m[1] >= 1 && +m[1] <= 60 && m[4].length === m[5].length;
}
// Чи координати схожі на українські (зони 34–37, смуги T та U). Лише для попередження.
export const coordsInUkraine = v => { const m = v.match(MGRS_RE); return !m || (+m[1] >= 34 && +m[1] <= 37 && 'TU'.includes(m[2])); };

export const KINDS = {
  phone: { ph: '+380 67 123 45 67', norm: normPhone, ok: isPhone, inputmode: 'tel',
    msg: 'Номер телефону у форматі +380 67 123 45 67' },
  signal: { ph: 'номер або ім’я користувача',
    norm: v => /^[\d+\s()\-.]+$/.test(v) ? normPhone(v) : v.trim().replace(/^@/, ''),
    ok: v => isPhone(v) || /^[a-z][a-z0-9_]{2,31}\.\d{2,9}$/i.test(v),
    msg: 'Номер телефону або ім’я користувача Signal (наприклад, kit.07)' },
  element: { ph: 'нікнейм, наприклад kit', norm: v => v.trim().replace(/^@/, '').replace(/:.*$/, ''),
    ok: v => /^[a-z0-9._=\-\/+]{1,60}$/i.test(v),
    msg: 'Лише нікнейм в Element, без @ і сервера (наприклад, kit)' },
  discord: { ph: 'ім’я користувача', norm: v => v.trim().replace(/^@/, ''),
    ok: v => /^[a-z0-9_.]{2,32}$/i.test(v) || /^.{2,32}#\d{4}$/.test(v),
    msg: 'Ім’я користувача Discord: латинські літери, цифри, крапка та «_»' },
  coords: { ph: '37U DQ 12345 67890', norm: normCoords, ok: isCoords, max: 25,
    msg: 'Координати MGRS, наприклад 37U DQ 12345 67890' },
  kg: { ph: 'наприклад, 2,5', inputmode: 'decimal', max: 6, norm: v => v.trim().replace('.', ','),
    ok: v => /^\d+(,\d+)?$/.test(v) && num(v) >= 0.1 && num(v) <= 100,
    msg: 'Число в кілограмах (від 0,1 до 100), наприклад 2,5' },
  min: { ph: 'наприклад, 15', inputmode: 'numeric', max: 4, norm: v => v.trim(),
    ok: v => /^\d{1,4}$/.test(v) && +v > 0 && +v <= 1440,
    msg: 'Ціле число хвилин від 1 до 1440, наприклад 15' },
  count: { ph: '0', inputmode: 'numeric', max: 3, norm: v => v.trim(), ok: v => /^\d{1,3}$/.test(v), msg: 'Лише ціле число' },
  unit: { norm: v => squash(v).toUpperCase(), ok: v => /^[\p{L}\p{N}][\p{L}\p{N} .\-\/]{0,11}$/u.test(v) && /[\p{L}\p{N}]/u.test(v),
    msg: 'Коротка назва: від 1 до 12 символів — літери, цифри, пробіл, крапка, дефіс' },
  callsign: { norm: squash, ok: v => /^[\p{L}\p{N}][\p{L}\p{N} '’\-]{0,29}$/u.test(v) && !/^\+?\d[\d\s\-()]{6,}$/.test(v),
    msg: 'Позивний: літери, цифри, пробіл, дефіс (без телефонів і посилань)' },
  name: { norm: squash, ok: v => v.length >= 2 && v.length <= 60 && /\p{L}|\p{N}/u.test(v), msg: 'Від 2 до 60 символів' },
};

export const kindOf = f => f.v ? KINDS[f.v] : null;
export const maxLen = f => f.max || kindOf(f)?.max || (f.t === 'area' ? 1000 : 200);

// ---- Нормалізація документа: тримаємо лише відомі ключі, приводимо до рядків, застосовуємо norm ----
function normField(f, src, out, item, data) {
  if (f.t === 'group') {
    for (const k of groupKeys(f)) {
      const raw = src[k];
      const v = raw == null ? '' : String(raw).trim();
      if (v !== '') out[k] = k.endsWith('_other') ? squash(v) : v;
    }
    return;
  }
  const raw = src[f.k];
  let v = raw == null ? '' : String(raw);
  if (!visible(f, item)) return; // приховане поле не переносимо — застарілі дані не потраплять у звіт
  if (f.none && v.trim() === NONE) { out[f.k] = NONE; return; }
  const kind = kindOf(f);
  v = kind?.norm && hasText(v) ? kind.norm(v) : f.t === 'area' ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim() : v.trim();
  if (v !== '') out[f.k] = v;
}
function normItem(fields, src) {
  const safe = src && typeof src === 'object' && !Array.isArray(src) ? src : {};
  const out = {};
  // спочатку поля-перемикачі (showIf залежить від них), потім решта
  const ordered = [...fields].sort((a, b) => (a.showIf ? 1 : 0) - (b.showIf ? 1 : 0));
  for (const f of ordered) normField(f, safe, out, { ...safe, ...out }, null);
  return out;
}
export function normalizeData(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { v: SCHEMA_VERSION };
  for (const s of SECTIONS) {
    if (s.fields) {
      const ordered = [...s.fields].sort((a, b) => (a.showIf ? 1 : 0) - (b.showIf ? 1 : 0));
      for (const f of ordered) normField(f, src, out, { ...src, ...out }, src);
    }
    if (s.list) {
      const items = Array.isArray(src[s.list.key]) ? src[s.list.key].slice(0, 50) : [];
      out[s.list.key] = items.map(it => normItem(s.list.fields, it));
    }
  }
  if (!out.points.length) out.points = [{}];
  if (!visible({ showIf: listDef('positions').showIf }, out)) out.positions = [];
  return out;
}

// ---- Перевірка ----
// problem: { level:'error'|'warn', path, step, section, item (індекс або undefined), label, msg }
const problem = (level, path, sectionId, item, label, msg) => ({ level, path, step: stepOfSection(sectionId)?.id, section: sectionId, item, label, msg });

function checkValue(f, item, data, path, sectionId, idx, label, problems) {
  if (f.t === 'group') {
    const keys = f.items.map(([k]) => `${f.k}_${k}`);
    let any = false;
    for (const k of keys) {
      const v = item[k];
      if (hasText(v)) {
        if (!KINDS.count.ok(v.trim())) problems.push(problem('error', `${path}${k}`, sectionId, idx, `${label} — ${f.items.find(([kk]) => `${f.k}_${kk}` === k)[2]}`, KINDS.count.msg));
        else if (+v > 0) any = true;
      }
    }
    if (hasText(item[`${f.k}_other`])) any = true;
    if (!any && required(f, item, data)) problems.push(problem('error', `${path}${keys[0]}`, sectionId, idx, label, 'Вкажіть кількість хоча б для одного рівня або заповніть «Інше»'));
    return;
  }
  if (!visible(f, item)) return;
  const v = item[f.k];
  const text = hasText(v);
  if (f.none && v === NONE) return;
  if (!text) {
    if (required(f, item, data)) problems.push(problem('error', path + f.k, sectionId, idx, label, f.none ? 'Вкажіть контакт або позначте «Немає»' : f.t === 'seg' || f.t === 'sel' ? 'Оберіть відповідь' : 'Обов’язкове поле'));
    return;
  }
  if (v.length > maxLen(f)) problems.push(problem('error', path + f.k, sectionId, idx, label, `Задовгий текст: ${v.length} символів, максимум ${maxLen(f)}`));
  if ((f.t === 'seg' || f.t === 'sel') && !f.o.includes(v)) problems.push(problem('error', path + f.k, sectionId, idx, label, 'Недопустиме значення — оберіть зі списку'));
  if (f.t === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) problems.push(problem('error', path + f.k, sectionId, idx, label, 'Дата у форматі РРРР-ММ-ДД'));
  }
  const kind = kindOf(f);
  if (kind && !kind.ok(v.trim())) problems.push(problem('error', path + f.k, sectionId, idx, label, kind.msg));
  else if (kind === KINDS.count && f.min != null && +v < f.min) problems.push(problem('error', path + f.k, sectionId, idx, label, `Не менше ${f.min}`));
}

const itemLabel = (s, i) => `${s.list.item} ${i + 1}`;

export function validateData(d, { today = todayISO() } = {}) {
  const problems = [];
  for (const s of SECTIONS) {
    if (s.fields) for (const f of s.fields) checkValue(f, d, d, '', s.id, undefined, f.l, problems);
    if (s.list) {
      const list = s.list, items = Array.isArray(d[list.key]) ? d[list.key] : [];
      const on = visible({ showIf: list.showIf }, d);
      if (!on) continue;
      if (items.length < (list.min || 0)) problems.push(problem('error', `${list.key}`, s.id, undefined, s.title, `Додайте хоча б одну ${list.addText}`));
      items.forEach((it, i) => {
        for (const f of list.fields) checkValue(f, it, d, `${list.key}.${i}.`, s.id, i, f.l, problems);
      });
    }
  }
  crossChecks(d, problems, today);
  return problems;
}

function crossChecks(d, problems, today) {
  const push = (level, path, sectionId, item, label, msg) => problems.push(problem(level, path, sectionId, item, label, msg));
  // Дата
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.date || '') && !Number.isNaN(Date.parse(d.date))) {
    const diff = daysBetween(d.date, today);
    if (diff < -1) push('error', 'date', 'general', undefined, 'Дата актуальності даних', 'Дата в майбутньому');
    else if (diff > 45) push('warn', 'date', 'general', undefined, 'Дата актуальності даних', `Даним уже ${diff} днів — переконайтеся, що вони актуальні, або поставте сьогоднішню дату`);
  }
  // Однаковий номер у всіх чергових
  const phones = ROLES.map(r => d[`${r.role}_phone`]).filter(v => hasText(v) && v !== NONE);
  if (phones.length === ROLES.length && new Set(phones).size === 1)
    push('warn', 'kb_phone', 'kb', undefined, 'WhatsApp', 'Однаковий номер WhatsApp у всіх трьох чергових — перевірте, чи це справді так');
  // Усі месенджери «Немає» у якоїсь ролі
  for (const r of ROLES) {
    const vals = CONTACT.filter(c => c.none).map(c => d[`${r.role}_${c.k}`]);
    if (vals.length && vals.every(v => v === NONE)) push('error', `${r.role}_phone`, r.role, undefined, r.title, 'Потрібен хоча б один спосіб зв’язку з черговим');
  }
  // Точки
  const pts = Array.isArray(d.points) ? d.points : [];
  const seenName = new Map(), seenCoords = new Map();
  pts.forEach((p, i) => {
    const n = (p.name || '').trim().toLowerCase(), c = (p.coords || '').trim();
    if (n) { if (seenName.has(n)) push('error', `points.${i}.name`, 'points', i, 'Назва або орієнтир точки', `Така сама назва, як у точки ${seenName.get(n) + 1}`); else seenName.set(n, i); }
    if (c && isCoords(c)) {
      if (seenCoords.has(c)) push('warn', `points.${i}.coords`, 'points', i, 'Координати', `Ті самі координати, що й у точки ${seenCoords.get(c) + 1}`); else seenCoords.set(c, i);
      if (!coordsInUkraine(c)) push('warn', `points.${i}.coords`, 'points', i, 'Координати', 'Координати поза звичними для України зонами (34–37, смуги T/U) — перевірте');
    }
    if (p.nrk === 'Є' && p.nrk_count === '1' && ['nrk_reb', 'nrk_cam', 'nrk_mic'].some(k => p[k] === 'Частково'))
      push('error', `points.${i}.nrk_count`, 'points', i, 'Кількість НРК', 'За одного НРК відповідь «Частково» неможлива — оберіть «Так» або «Ні»');
    if (p.supplied === 'Так' && p.need === 'Є')
      push('warn', `points.${i}.need`, 'points', i, 'Потреба в дозабезпеченні', 'Точка забезпечена повністю, але є потреба в дозабезпеченні — перевірте відповіді');
    if ((p.supplied === 'Ні' || p.supplied === 'Частково') && p.need === 'Немає')
      push('warn', `points.${i}.need`, 'points', i, 'Потреба в дозабезпеченні', 'Майна бракує, але потреби в дозабезпеченні немає — перевірте відповіді');
  });
  // Позиції
  const pos = Array.isArray(d.positions) && d.drops === 'Так' ? d.positions : [];
  const seenPos = new Map();
  pos.forEach((p, i) => {
    const n = (p.name || '').trim().toLowerCase();
    if (n) { if (seenPos.has(n)) push('error', `positions.${i}.name`, 'drops', i, 'Назва або позивний позиції', `Така сама назва, як у позиції ${seenPos.get(n) + 1}`); else seenPos.set(n, i); }
    if (hasText(p.coords) && isCoords(p.coords) && !coordsInUkraine(p.coords))
      push('warn', `positions.${i}.coords`, 'drops', i, 'Координати', 'Координати поза звичними для України зонами (34–37, смуги T/U) — перевірте');
  });
  if (d.drops === 'Так' && hasText(d.algo_time) && KINDS.min.ok(d.algo_time) && +d.algo_time > 240)
    push('warn', 'algo_time', 'algo', undefined, 'Орієнтовний час від запиту до скиду', 'Понад 4 години від запиту до скиду — перевірте, чи число в хвилинах');
}

export const errorsOf = problems => problems.filter(p => p.level === 'error');
export const warningsOf = problems => problems.filter(p => p.level === 'warn');

// Прогрес: скільки обов’язкових полів заповнено (для індикатора)
export function progressOf(d) {
  let total = 0, done = 0;
  const count = (f, item) => {
    if (f.t === 'group') { total++; if (f.items.some(([k]) => +item[`${f.k}_${k}`] > 0) || hasText(item[`${f.k}_other`])) done++; return; }
    if (!required(f, item, d)) return;
    total++;
    if (hasText(item[f.k])) done++;
  };
  for (const s of SECTIONS) {
    if (s.fields) s.fields.forEach(f => count(f, d));
    if (s.list && visible({ showIf: s.list.showIf }, d)) (d[s.list.key] || []).forEach(it => s.list.fields.forEach(f => count(f, it)));
  }
  return { total, done };
}

// Короткі підписи для зведень
export const POINT_FLAG_KEYS = ['supplied', 'need', 'nrk', 'hypo_heat', 'hypo_bag', 'hypo_ready', 'ppe'];
export { POINT_FIELDS, POSITION_FIELDS, LEVELS };
