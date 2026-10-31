// Спільні будівельні блоки для PDF (pdfmake): тема, вимірювання тексту, елементи оформлення.

import { NONE, ROLES } from './schema.mjs';
import { iconSvg } from './icons.mjs';
import { hasText } from './text.mjs';

export const THEME = {
  ink: '#111111', grey: '#6b6b6b', rule: '#d9d9d9', light: '#f4f4f4', accent: '#e30613',
  ok: '#1a7f37', warn: '#b26b00', bad: '#c81e1e',
  head: 'eUH', secRule: 3, margin: 32,
  roles: Object.fromEntries(ROLES.map(r => [r.role, r.color])),
  unitFont: '600 100px eUkraine',
};
export const C = THEME;
export const PAGE = { w: 595, m: THEME.margin };
PAGE.cw = PAGE.w - 2 * PAGE.m;

export const ROLE_STYLE = Object.fromEntries(ROLES.map(r => [r.role, { icon: r.badge, name: r.short, sub: r.sub, note: r.note }]));

// Ширина тексту у «100px» одиницях (помножити на кегль) — через canvas
let _ctx = null;
export function textWidth(text, font) {
  if (typeof document === 'undefined') return text.length * 0.55; // Node: грубе наближення для тестів
  _ctx = _ctx || document.createElement('canvas').getContext('2d');
  _ctx.font = font;
  return _ctx.measureText(text).width / 100;
}
export const loadFonts = () => typeof document === 'undefined' ? Promise.resolve()
  : Promise.all(['700 100px eUkraineHead', '500 100px eUkraineHead', '600 100px eUkraine', '400 100px eUkraine'].map(f => document.fonts.load(f)));

export const L = f => f.pl || f.l;
export const T = s => s.pt || s.title;

// Чи значення «негативне» для підсвічування у зведеннях
export const NEGATIVE = new Set(['Ні', 'Немає', 'Частково', 'Є, нестабільна']);
// Відсутність НРК чи інтернету — не дефект забезпечення, а особливість точки (жовтий, не червоний)
const SOFT_KEYS = new Set(['nrk', 'net']);
export const flagColor = (key, v) => {
  if (!hasText(v)) return C.rule;
  if (key === 'need') return v === 'Є' ? C.bad : C.ok;             // потреба «Є» — погано
  if (v === 'Частково' || v === 'Є, нестабільна') return C.warn;
  if (NEGATIVE.has(v)) return SOFT_KEYS.has(key) ? C.warn : C.bad;
  return C.ok;
};
// Ширина «зіркової» колонки таблиці pdfmake: усе, що лишилося після фіксованих колонок і внутрішніх відступів
export const starWidth = (widths, total, pad = 6) => {
  const stars = widths.filter(w => w === '*').length || 1;
  const fixed = widths.reduce((a, w) => a + (typeof w === 'number' ? w : 0), 0);
  return Math.max(20, (total - fixed - widths.length * pad) / stars);
};

export function kit(sc = 1) {
  const z = v => +(v * sc).toFixed(2);
  const val = (x, size) => hasText(x)
    ? { text: x.trim(), bold: true, color: x.trim() === NONE ? C.grey : C.ink, ...(size && { fontSize: size }) }
    : { text: '—', color: C.rule, ...(size && { fontSize: size }) };
  const lab = (t, icon) => icon
    ? { columnGap: z(4), columns: [{ svg: iconSvg(icon, C.grey), width: z(8), height: z(8), margin: [0, z(1), 0, 0] }, { text: t, color: C.grey, width: '*' }] }
    : { text: t, color: C.grey };
  const sec = (t, w = PAGE.cw) => ({ headlineLevel: 1, margin: [0, z(16), 0, z(6)], stack: [
    { canvas: [{ type: 'rect', x: 0, y: 0, w, h: z(THEME.secRule), color: C.ink }] },
    { text: t, font: THEME.head, bold: true, fontSize: z(11), margin: [0, z(5), 0, 0] }] });
  const badge = (role, dm) => {
    const st = ROLE_STYLE[role], color = THEME.roles[role];
    const shapes = [{ type: 'ellipse', x: dm / 2, y: dm / 2, r1: dm / 2, r2: dm / 2, color }];
    if (st.icon === 'cross') shapes.push(
      { type: 'rect', x: dm * .41, y: dm * .2, w: dm * .18, h: dm * .6, color: '#fff' },
      { type: 'rect', x: dm * .2, y: dm * .41, w: dm * .6, h: dm * .18, color: '#fff' });
    const fs = dm * .38;
    return { width: dm, stack: [{ canvas: shapes },
      ...(st.icon === 'cross' ? [] : [{ text: st.icon, bold: true, color: '#fff', fontSize: fs, lineHeight: 1, alignment: 'center', relativePosition: { x: 0, y: -dm / 2 - fs * .6 } }])] };
  };
  const pads = (v = 3) => ({ paddingLeft: i => i ? z(6) : 0, paddingRight: () => z(6), paddingTop: () => z(v), paddingBottom: () => z(v - .5) });
  const lines = (head, v) => ({ ...pads(v), vLineWidth: () => 0,
    hLineWidth: (i, node) => head && i === 1 ? 1 : i > 0 && i < node.table.body.length ? .5 : 0,
    hLineColor: i => head && i === 1 ? C.ink : C.rule });
  // Ручне перенесення довгих «слів» (нікнеймів, координат), яких pdfmake сам не розіб’є
  const wrapTo = (w, size, font = '600 100px eUkraine') => x => {
    if (!hasText(x)) return x;
    const wide = t => textWidth(t, font) * size > w * .96, out = [];
    for (const para of x.trim().split('\n')) {
      let line = '';
      for (const ch of para) {
        if (!wide(line + ch)) { line += ch; continue; }
        const cut = Math.max(line.lastIndexOf(' '), line.lastIndexOf('.'), line.lastIndexOf('_'));
        if (cut > 0) { out.push(line.slice(0, cut).trim()); line = line.slice(cut).trim() + ch; }
        else { out.push(line); line = ch; }
      }
      out.push(line);
    }
    return out.join('\n');
  };
  // Кольорова «пігулка» зі значенням для зведень
  const pill = (key, v, size = z(8)) => hasText(v)
    ? { text: v.trim(), bold: true, color: flagColor(key, v), fontSize: size }
    : { text: '—', color: C.rule, fontSize: size };
  // Переносить лише задовгі «слова» (посилання, нікнейми), щоб колонка не розтягувалась за межі сторінки
  const fit = (w, size, font) => x => hasText(x) && x.split(/\s+/).some(word => textWidth(word, font || '600 100px eUkraine') * size > w * .9) ? wrapTo(w, size, font)(x) : x;
  return { z, val, lab, sec, badge, lines, wrapTo, pill, fit };
}

export const keepHeadings = (cur, after) => cur.headlineLevel === 1 && after.length === 0;
