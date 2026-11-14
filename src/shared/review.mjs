// Огляд відповідей і порівняння з попереднім звітом (для кроку «Перевірка та звіт»). Чиста логіка без DOM.

import { SECTIONS, STEPS, sectionById, visible } from './schema.mjs';
import { cellText } from './report.mjs';
import { hasText } from './text.mjs';

// Значення поля так, як його видно у звіті; приховане поле — порожнє
const shownValue = (f, item) => item && visible(f, item) ? String(cellText(f, item) ?? '').trim() : '';
const listOn = (l, d) => !!d && visible({ showIf: l.showIf }, d);
const REVIEW_SKIP = new Set(['date']);          // дату актуальності оновлюють щоразу — це не «зміна даних»
const itemTitle = (l, it, i) => `${l.item} ${i + 1}${hasText(it?.name) ? ` · ${it.name.trim()}` : ''}`;

// Усі відповіді по кроках і розділах: [{ step, index, sections: [{ id, title, rows, items }] }]
//   rows:  [{ path, label, value }];  items (для списків): [{ key, title, rows }]
export function reviewModel(d) {
  return STEPS.map((step, index) => ({ step, index })).filter(x => !x.step.final).map(({ step, index }) => ({
    step, index,
    sections: step.sections.map(id => {
      const s = sectionById(id);
      if (s.showIf && !visible(s, d)) return null;
      const rows = (s.fields || []).filter(f => visible(f, d)).map(f => ({ path: f.k, label: f.pl || f.l, value: shownValue(f, d) }));
      const items = s.list && listOn(s.list, d) ? (d[s.list.key] || []).map((it, i) => ({
        key: `${s.list.key}.${i}`, title: itemTitle(s.list, it, i),
        rows: s.list.fields.filter(f => visible(f, it)).map(f => ({ path: `${s.list.key}.${i}.${f.k}`, label: f.pl || f.l, value: shownValue(f, it) })),
      })) : [];
      return rows.length || items.length ? { id, title: s.title, rows, items } : null;
    }).filter(Boolean),
  }));
}

// Що змінилося від base до cur.
//   changes: Map(шлях → попереднє значення); added: ['points.2', …]; removed: [{ key, title }]; count — разом
// Елементи списків порівнюються за номером. Поле, що стало прихованим, — зміна (було значення, стало порожньо).
export function diffAnswers(base, cur) {
  const changes = new Map(), added = [], removed = [];
  const cmp = (f, path, a, b) => {
    if (REVIEW_SKIP.has(path)) return;
    const was = shownValue(f, a), now = shownValue(f, b);
    if (was !== now) changes.set(path, was);
  };
  for (const s of SECTIONS) {
    for (const f of s.fields || []) cmp(f, f.k, base, cur);
    if (!s.list) continue;
    const k = s.list.key;
    const A = listOn(s.list, base) ? base[k] || [] : [], B = listOn(s.list, cur) ? cur[k] || [] : [];
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      if (i >= A.length) added.push(`${k}.${i}`);
      else if (i >= B.length) removed.push({ key: `${k}.${i}`, title: itemTitle(s.list, A[i], i) });
      else for (const f of s.list.fields) cmp(f, `${k}.${i}.${f.k}`, A[i], B[i]);
    }
  }
  return { changes, added, removed, count: changes.size + added.length + removed.length };
}
