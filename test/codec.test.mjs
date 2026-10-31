import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { makePayload, encodePayload, parsePayload, findMarker, readPdfBytes, toB64url, fromB64url, crc32, pdfEmbedding, findEmbeddedStream } from '../src/shared/codec.mjs';
import { FULL, LEGACY_V1 } from './fixtures.mjs';

const inflate = async d => new Uint8Array(inflateSync(Buffer.from(d)));
const enc = s => new Uint8Array(Buffer.from(s, 'latin1'));

test('base64url туди й назад, у т.ч. кирилиця', () => {
  const bytes = new TextEncoder().encode('Сокіл — «Сосна» 37U DQ');
  assert.deepEqual(fromB64url(toB64url(bytes)), bytes);
  assert.throws(() => fromB64url('a+b/c='));
});

test('crc32 відомих значень', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 'cbf43926');
});

test('конверт: кодування → маркер → розбір', () => {
  const p = makePayload(FULL, { kind: 'report', created: '2026-10-31T10:00:00Z' });
  const { marker } = encodePayload(p);
  assert.match(marker, /^DANIFORM2:[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
  const back = parsePayload(findMarker(`garbage ${marker} more`));
  assert.equal(back.kind, 'report'); assert.equal(back.v, 2);
  assert.deepEqual(back.data, p.data);
});

test('пошкоджена контрольна сума — помилка', () => {
  const { marker } = encodePayload(makePayload(FULL));
  const bad = marker.replace(/\.[0-9a-f]{8}$/, '.00000000');
  assert.throws(() => findMarker(bad), /контрольна сума/);
});

test('старий формат (URI v1) читається й мігрує', async () => {
  const b64 = toB64url(new TextEncoder().encode(JSON.stringify(LEGACY_V1)));
  const pdf = enc(`%PDF-1.3\n1 0 obj << /A << /S /URI /URI (https://dani.invalid/v1#${b64}) >> >> endobj\n%%EOF`);
  const p = await readPdfBytes(pdf, { inflate });
  assert.equal(p.legacy, true); assert.equal(p.v, 1);
  assert.equal(p.data.unit, '2МБ'); assert.equal(p.data.migratedFrom, 1);
  assert.equal(p.data.points[0].nrk, undefined);
  // URI в hex-рядку
  const hex = Buffer.from(`https://dani.invalid/v1#${b64}`, 'latin1').toString('hex');
  const pdf2 = enc(`%PDF-1.3\n/URI <${hex}>\n%%EOF`);
  assert.equal((await readPdfBytes(pdf2, { inflate })).data.unit, '2МБ');
});

test('вкладений файл: знаходиться і розпаковується; маркер має пріоритет', async () => {
  const p = makePayload(FULL, { kind: 'draft' });
  const { bytes } = encodePayload(p);
  const z = deflateSync(Buffer.from(bytes));
  const head = enc(`%PDF-1.3\n5 0 obj\n<< /Type /EmbeddedFile /Length ${z.length} /Filter /FlateDecode /Params << /Size ${bytes.length} >> >>\nstream\n`);
  const tail = enc(`\nendstream\nendobj\n%%EOF`);
  const pdf = new Uint8Array([...head, ...z, ...tail]);
  const s = findEmbeddedStream(pdf);
  assert.ok(s && s.deflated && s.data.length === z.length);
  const r = await readPdfBytes(pdf, { inflate });
  assert.equal(r.kind, 'draft'); assert.deepEqual(r.data, p.data);
  // нестиснутий варіант
  const raw = new Uint8Array([...enc(`%PDF-1.3\n<< /Type /EmbeddedFile /Length ${bytes.length} >>\nstream\n`), ...bytes, ...tail]);
  assert.deepEqual((await readPdfBytes(raw, { inflate })).data, p.data);
});

test('не PDF, без даних, новіша версія', async () => {
  await assert.rejects(readPdfBytes(enc('hello'), { inflate }), /не PDF/);
  await assert.rejects(readPdfBytes(enc('%PDF-1.3 nothing here'), { inflate }), /немає даних/);
  assert.throws(() => parsePayload(JSON.stringify({ app: 'med-data-actualization', v: 99, data: {} })), /новішою/);
  assert.throws(() => parsePayload('[1,2]'), /Пошкоджені/);
  assert.throws(() => parsePayload('{bad'), /Пошкоджені/);
});

test('pdfEmbedding повертає info-маркер і файл data.json', () => {
  const e = pdfEmbedding(makePayload(FULL));
  assert.match(e.info.FormData, /^DANIFORM2:/);
  assert.equal(e.files['data.json'].type, 'application/json');
  assert.match(e.files['data.json'].src, /^data:application\/json;base64,[A-Za-z0-9+\/=]+$/);
});

test('справжній PDF старої форми (версія 1) читається', async () => {
  const { readFileSync } = await import('node:fs');
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/legacy_v1.pdf', import.meta.url)));
  const p = await readPdfBytes(bytes, { inflate });
  assert.equal(p.legacy, true);
  assert.equal(p.data.unit, 'МР');
  assert.equal(p.data.points[0].coords, '37U DQ 12345 67890');
  assert.equal(p.data.points[0].nrk, undefined);
});

test('великий сторонній PDF без даних перевіряється швидко (лінійний пошук)', async () => {
  const chunk = '<< /Type /Page /Parent 1 0 R /Contents 2 0 R >>\n';
  const big = enc('%PDF-1.4\n' + chunk.repeat(80000) + '%%EOF'); // ~4 МБ, тисячі словників
  const t0 = Date.now();
  await assert.rejects(readPdfBytes(big, { inflate }), /немає даних/);
  assert.ok(Date.now() - t0 < 1500, `надто довго: ${Date.now() - t0} мс`);
});

test('розпакування вкладення обмежене за розміром (захист від бомби стиснення)', async () => {
  const bomb = deflateSync(Buffer.alloc(3 * 1024 * 1024, 0x61)); // 3 МБ «a» → кілька КБ
  const pdf = new Uint8Array([...enc(`%PDF-1.3\n<< /Type /EmbeddedFile /Length ${bomb.length} /Filter /FlateDecode >>\nstream\n`), ...bomb, ...enc('\nendstream\n%%EOF')]);
  await assert.rejects(readPdfBytes(pdf), /Завеликі/); // без inflate — вбудований DecompressionStream Node 22
});
