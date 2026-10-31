// Пакування даних анкети у PDF і читання їх назад.
//
// Дані зберігаються у PDF двічі:
//   1. як вкладений файл data.json (стандартний механізм PDF — EmbeddedFiles; видно в Acrobat як вкладення);
//   2. як рядок-маркер у словнику Info (DANIFORM2:<base64url>.<crc32>), щоб читати без розпакування.
// Читання спочатку шукає маркер, потім вкладений файл.

import { SCHEMA_VERSION } from './schema.mjs';
import { normalizeData } from './validate.mjs';

export const MARK = 'DANIFORM2:';
export const MARK_RE = /DANIFORM2:([A-Za-z0-9_-]+)\.([0-9a-f]{8})/;
export const DATA_FILE_NAME = 'data.json';
const MAX_PAYLOAD = 512 * 1024; // захист від надмірно великих вкладень

// ---- base64url ----
export function toB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export const toB64url = bytes => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function fromB64url(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64url');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

// ---- CRC32 (контроль цілісності, не захист) ----
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
}

// ---- Конверт ----
// kind: 'report' — повний перевірений звіт; 'draft' — чернетка (може містити помилки)
export function makePayload(data, { kind = 'report', created } = {}) {
  return { app: 'med-data-actualization', v: SCHEMA_VERSION, kind, created, data: normalizeData(data) };
}
export function encodePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return { bytes, marker: MARK + toB64url(bytes) + '.' + crc32(bytes) };
}
export function parsePayload(text) {
  let p;
  try { p = JSON.parse(text); } catch { throw new Error('Пошкоджені дані у файлі'); }
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Пошкоджені дані у файлі');
  // старі файли (версія 1) мали голий об’єкт даних без конверта
  if (p.app !== 'med-data-actualization') return { v: 1, kind: 'report', data: migrate(p, 1), legacy: true };
  if (typeof p.v !== 'number' || p.v > SCHEMA_VERSION) throw new Error('Файл створено новішою версією форми — оновіть форму');
  if (!p.data || typeof p.data !== 'object' || Array.isArray(p.data)) throw new Error('Пошкоджені дані у файлі');
  return { v: p.v, kind: p.kind === 'draft' ? 'draft' : 'report', created: typeof p.created === 'string' ? p.created : undefined, data: migrate(p.data, p.v) };
}

// Міграція даних зі старіших версій схеми.
//   v1 → v2: лише нові поля (НРК, гіпотермія, хімзахист) — достатньо нормалізації.
//   v2 → v3: «забезпечення» + «потреба» об’єднано в одне питання; виправлено рід у варіантах
//            «Інтернет» («Є, стабільний»); «Потреба в скидах установленого зразка» — Так/Ні;
//            нове питання «чи здійснюють скиди інші» (виводиться з алгоритму, якщо його було описано).
//   Ключі v1 і v2 збігаються, тож перетворення v2 → v3 застосовується до обох.
//   v3 → v4: новий розділ «Медичні пункти» — достатньо нормалізації (з’явиться порожня картка).
//   Для всіх версій: обладнання НРК (РЕБ/камера/мікрофон) — лише Так/Ні; давнє «Частково»
//   не вгадуємо, а очищаємо — форма попросить відповісти заново.
const SUPPLY_V3 = { 'Так': 'Повна', 'Частково': 'Часткова', 'Ні': 'Немає' };
const NET_V3 = { 'Є, стабільна': 'Є, стабільний', 'Є, нестабільна': 'Є, нестабільний' };
const YN_V3 = { 'Є': 'Так', 'Немає': 'Ні' };
const txt = v => typeof v === 'string' ? v.trim() : '';
const NRK_YN = ['nrk_reb', 'nrk_cam', 'nrk_mic'];
const dropPartialNrk = src => !Array.isArray(src.points) ? src : { ...src, points: src.points.map(p => {
  if (!p || typeof p !== 'object' || Array.isArray(p) || !NRK_YN.some(k => p[k] === 'Частково')) return p;
  const q = { ...p }; for (const k of NRK_YN) if (q[k] === 'Частково') delete q[k];
  return q;
}) };

function upgradeToV3(src) {
  const d = { ...src };
  if (Array.isArray(d.points)) d.points = d.points.map(p => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return p;
    const { need, need_note, ...q } = p;
    if (q.net in NET_V3) q.net = NET_V3[q.net];
    const oldSupplied = q.supplied, lack = oldSupplied === 'Частково' || oldSupplied === 'Ні';
    if (oldSupplied in SUPPLY_V3) q.supplied = SUPPLY_V3[oldSupplied];
    // повністю забезпечена, але з потребою — тепер це «Часткова» з описом потреби
    if (oldSupplied === 'Так' && need === 'Є' && txt(need_note)) q.supplied = 'Часткова';
    const notes = [lack ? txt(q.supplied_note) : '', need === 'Є' ? txt(need_note) : ''].filter(Boolean);
    if (notes.length) q.supplied_note = [...new Set(notes)].join('\n'); else delete q.supplied_note;
    return q;
  });
  if (d.mp_std in YN_V3) d.mp_std = YN_V3[d.mp_std];
  if (d.drops === 'Ні' && d.drops_other == null && ['algo_carry', 'algo_hand', 'algo_time'].some(k => txt(d[k]))) d.drops_other = 'Так';
  return d;
}

export function migrate(data, fromVersion) {
  const src = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const d = normalizeData(dropPartialNrk(fromVersion < 3 ? upgradeToV3(src) : src));
  if (fromVersion < SCHEMA_VERSION) d.migratedFrom = fromVersion;
  return d;
}

// ---- Читання з PDF ----
const latin1 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return s; };

// Старий формат (версія 1): дані в URI посилання https://dani.invalid/v1#<base64url>
const LEGACY_RE = /https:\/\/dani\.invalid\/v1#([A-Za-z0-9_-]+)/;

export function findMarker(raw) {
  const m = raw.match(MARK_RE);
  if (m) {
    if (m[1].length > MAX_PAYLOAD * 4 / 3) throw new Error('Завеликі дані у файлі');
    const bytes = fromB64url(m[1]);
    if (crc32(bytes) !== m[2]) throw new Error('Дані у файлі пошкоджено (не збігається контрольна сума)');
    return new TextDecoder().decode(bytes);
  }
  let l = raw.match(LEGACY_RE);
  if (!l) for (const h of raw.matchAll(/\/URI\s*<([0-9A-Fa-f\s]{1,2000000})>/g)) {
    l = h[1].replace(/\s/g, '').replace(/../g, x => String.fromCharCode(parseInt(x, 16))).match(LEGACY_RE);
    if (l) break;
  }
  if (l) {
    if (l[1].length > MAX_PAYLOAD * 4 / 3) throw new Error('Завеликі дані у файлі');
    return new TextDecoder().decode(fromB64url(l[1]));
  }
  return null;
}

// Знаходить потік вкладеного файла data.json (записаного pdfkit) і повертає його байти та фільтр.
// Лінійний пошук через indexOf — жодних regex по всьому файлу (великий сторонній PDF не має вішати вкладку).
export function findEmbeddedStream(bytes) {
  const raw = latin1(bytes);
  let i = 0;
  while ((i = raw.indexOf('/EmbeddedFile', i)) !== -1) {
    const d0 = raw.lastIndexOf('<<', i);
    const s0 = raw.indexOf('stream', i);
    i += 13;
    if (d0 === -1 || s0 === -1 || s0 - d0 > 4000) continue;
    const dict = raw.slice(d0, s0);
    const len = dict.match(/\/Length\s+(\d{1,9})(?!\s+\d+\s+R)/);
    if (!len) continue;
    let start = s0 + 6;
    if (raw[start] === '\r') start++;
    if (raw[start] === '\n') start++;
    const n = +len[1];
    if (n > MAX_PAYLOAD * 4 || start + n > bytes.length) continue;
    return { data: bytes.subarray(start, start + n), deflated: /\/Filter\s*\/FlateDecode/.test(dict) };
  }
  return null;
}

// inflate: async (Uint8Array) => Uint8Array — у браузері через DecompressionStream, у Node через zlib
export async function readPdfBytes(bytes, { inflate } = {}) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (latin1(bytes.subarray(0, 8)).indexOf('%PDF') !== 0) throw new Error('Це не PDF-файл');
  const raw = latin1(bytes);
  const text = findMarker(raw);
  if (text != null) return parsePayload(text);
  const emb = findEmbeddedStream(bytes);
  if (emb) {
    const data = emb.deflated ? await (inflate || defaultInflate)(emb.data) : emb.data;
    return parsePayload(new TextDecoder().decode(data));
  }
  throw new Error('У цьому файлі немає даних анкети. Оберіть PDF-звіт або чернетку, сформовані анкетою актуалізації даних.');
}

async function defaultInflate(data) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Браузер не підтримує розпакування вкладення — відкрийте файл у новішому браузері');
  // Читаємо порціями й зупиняємось, щойно розпаковане перевищить ліміт (захист від «бомби» стиснення)
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_PAYLOAD) { await reader.cancel(); throw new Error('Завеликі дані у файлі'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
export const inflateLimit = MAX_PAYLOAD;

// Властивості для docDefinition pdfmake: вкладення + маркер в Info
export function pdfEmbedding(payload) {
  const { bytes, marker } = encodePayload(payload);
  return {
    info: { FormData: marker },
    // pdfmake приймає src лише рядком (шлях або data:-URL); data:-URL не потребує мережі
    files: { [DATA_FILE_NAME]: { src: 'data:application/json;base64,' + toB64(bytes), name: DATA_FILE_NAME, type: 'application/json',
      description: 'Дані анкети для повторного відкриття у формі' } },
  };
}
