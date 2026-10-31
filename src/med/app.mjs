// Інструмент медслужби: відкриває звіти підрозділів (PDF), показує їх стан і друкує плакати.

import { TITLE, ROLES } from './schema.mjs';
import { hasText, esc, fmtDate, safeFileName, plural } from './text.mjs';
import { validateData, normalizeData, errorsOf, warningsOf } from './validate.mjs';
import { readPdfBytes } from './codec.mjs';
import { buildPoster, buildContactsSheet, MIN_SCALE } from './poster.mjs';
import { buildReport, collectNeeds } from './report.mjs';
import { loadFonts } from './pdfkit.mjs';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');

// reports: [{ id, file, data, kind, legacy, created, errors, warnings, needs }]
let reports = [];
let seq = 0;
let busy = false;

function render() {
  const rows = [...reports].sort((a, b) => (a.data.unit || '').localeCompare(b.data.unit || '', 'uk'));
  app.innerHTML = `
  <header class="bar"><div class="bar-in">
    <div class="brand"><h1>Медслужба — плакати зі звітів</h1><p>${esc(TITLE)}</p></div>
    <div class="bar-act">
      <label class="btn primary" tabindex="0" id="openl">Відкрити звіти PDF<input type="file" id="open" accept=".pdf,application/pdf" multiple hidden></label>
      ${reports.length ? '<button type="button" class="btn" id="clear">Прибрати всі</button>' : ''}
    </div>
  </div></header>
  <main class="main">
    <div class="drop" id="drop">
      <b>Перетягніть сюди PDF-звіти підрозділів</b>
      <span>або натисніть «Відкрити звіти PDF». Можна кілька файлів одразу. Дані не залишають цей пристрій.</span>
    </div>
    ${reports.length ? `
    <div class="tools">
      <button type="button" class="btn primary" id="all" ${busy ? 'disabled' : ''}>Усі плакати одним PDF (${reports.length})</button>
      <button type="button" class="btn" id="sheet" ${busy ? 'disabled' : ''}>Зведення контактів чергових</button>
    </div>
    <table class="tbl"><thead><tr><th>Підрозділ</th><th>Дата</th><th>Заповнив</th><th>Стан</th><th>Точки</th><th>Потреби</th><th></th></tr></thead>
    <tbody>${rows.map(rowHtml).join('')}</tbody></table>
    <p class="hint">Плакат — це «Довідка чергового» на один аркуш A4: чергові, точки передачі, позиції для скидів, алгоритм. Тимчасові дані (забезпечення, потреби, підготовка) дивіться у звіті підрозділу — його можна перегенерувати кнопкою «Звіт».</p>
    ` : `<section class="empty">
      <h2>Як це працює</h2>
      <ol>
        <li>Підрозділи заповнюють анкету й надсилають PDF-звіт через Element.</li>
        <li>Відкрийте тут один або кілька звітів — інструмент перевірить їх і покаже стан.</li>
        <li>Натисніть «Плакат» біля підрозділу або «Усі плакати одним PDF» — і друкуйте.</li>
      </ol>
      <p class="hint">Файл працює повністю офлайн. Нічого нікуди не надсилається.</p>
    </section>`}
  </main>`;
}

function rowHtml(r) {
  const d = r.data;
  const state = r.kind === 'draft' ? '<span class="badge warn">чернетка</span>'
    : r.errors.length ? `<span class="badge bad">${r.errors.length} ${plural(r.errors.length, 'помилка', 'помилки', 'помилок')}</span>`
    : '<span class="badge ok">✓ повний</span>';
  const legacy = r.legacy ? '<span class="badge grey" title="Файл старої версії форми: без даних про НРК, гіпотермію, хімзахист">стара форма</span>' : '';
  const warns = r.warnings.length ? `<span class="badge grey">${r.warnings.length} зауваж.</span>` : '';
  const bad = r.needs.filter(n => n.level === 'bad').length;
  return `<tr data-id="${r.id}">
    <td><b class="unit">${esc(hasText(d.unit) ? d.unit.toUpperCase() : '—')}</b><small>${esc(r.file)}</small></td>
    <td>${esc(fmtDate(d.date) || '—')}</td>
    <td>${esc(d.author || '—')}</td>
    <td class="st">${state}${legacy}${warns}</td>
    <td>${(d.points || []).length}${d.drops === 'Так' ? ` <small>· ${(d.positions || []).length} поз.</small>` : ''}</td>
    <td>${r.needs.length ? `<span class="${bad ? 'bad' : ''}">${r.needs.length}</span>` : '—'}</td>
    <td class="act">
      <button type="button" class="btn sm primary" data-poster="${r.id}" ${busy ? 'disabled' : ''}>Плакат</button>
      <button type="button" class="btn sm" data-report="${r.id}" ${busy ? 'disabled' : ''} title="Перегенерувати повний звіт із даних файла">Звіт</button>
      <button type="button" class="btn sm" data-details="${r.id}">Деталі</button>
      <button type="button" class="del" data-del="${r.id}" aria-label="Прибрати">✕</button>
    </td>
  </tr>${r.open ? `<tr class="det"><td colspan="7">${detailsHtml(r)}</td></tr>` : ''}`;
}

function detailsHtml(r) {
  const d = r.data;
  const roles = ROLES.map(x => `<div><b>${esc(x.short)}</b> ${esc(d[`${x.role}_callsign`] || '—')}<br><small>${['phone', 'signal', 'element', 'discord'].map(k => d[`${x.role}_${k}`]).filter(hasText).map(esc).join(' · ') || '—'}</small></div>`).join('');
  const needs = r.needs.length ? `<ul>${r.needs.map(n => `<li class="${n.level}"><span>${esc(n.where)}</span> ${esc(n.what)}</li>`).join('')}</ul>` : '<p class="hint">Потреб не зазначено.</p>';
  const probs = [...r.errors, ...r.warnings];
  return `<div class="details">
    <div><h4>Чергові</h4><div class="roles">${roles}</div></div>
    <div><h4>Потреби та зауваги (${r.needs.length})</h4>${needs}</div>
    ${probs.length ? `<div><h4>Проблеми валідації (${probs.length})</h4><ul class="probs">${probs.map(p => `<li class="${p.level}">${esc(p.item != null ? `${p.path.startsWith('points') ? 'Точка' : 'Позиція'} ${p.item + 1} · ` : '')}${esc(p.label)}: ${esc(p.msg)}</li>`).join('')}</ul></div>` : ''}
    ${r.created ? `<p class="hint">Файл сформовано ${esc(new Date(r.created).toLocaleString('uk-UA'))}${r.v ? `, схема v${r.v}` : ''}.</p>` : ''}
  </div>`;
}

async function addFiles(files) {
  const list = [...files].filter(f => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)));
  if (!list.length) { toast('Оберіть PDF-файли, сформовані анкетою.'); return; }
  let added = 0, failed = [];
  for (const f of list) {
    if (f.size > 50 * 1024 * 1024) { failed.push(`${f.name}: завеликий`); continue; }
    try {
      const p = await readPdfBytes(new Uint8Array(await f.arrayBuffer()));
      const data = normalizeData(p.data);
      const problems = validateData(data);
      const r = { id: ++seq, file: f.name, data, kind: p.kind, legacy: !!(p.legacy || p.data.migratedFrom), created: p.created, v: p.v,
        errors: errorsOf(problems), warnings: warningsOf(problems), needs: collectNeeds(data), open: false };
      // той самий підрозділ — залишаємо новіший за датою
      const same = reports.find(x => hasText(x.data.unit) && hasText(data.unit) && x.data.unit.toUpperCase() === data.unit.toUpperCase());
      if (same) {
        // новіша дата перемагає; за однакової дати повний звіт важливіший за чернетку
        const rank = x => `${x.data.date || ''}|${x.kind === 'report' ? 1 : 0}`;
        if (rank(r) > rank(same)) { reports = reports.filter(x => x !== same); reports.push(r); toast(`${data.unit.toUpperCase()}: замінено ${same.kind === 'draft' ? 'чернетку' : 'звіт'} від ${fmtDate(same.data.date)} на ${r.kind === 'draft' ? 'чернетку' : 'звіт'} від ${fmtDate(data.date)}.`); }
        else toast(`${data.unit.toUpperCase()}: уже відкрито ${same.kind === 'draft' ? 'чернетку' : 'звіт'} від ${fmtDate(same.data.date)}, файл ${f.name} пропущено.`);
      } else reports.push(r);
      added++;
    } catch (e) { failed.push(`${f.name}: ${e && e.message || 'не вдалося прочитати'}`); }
  }
  render();
  if (failed.length) alert('Не вдалося відкрити:\n' + failed.join('\n'));
  else if (added) toast(`Відкрито ${added} ${plural(added, 'звіт', 'звіти', 'звітів')}.`);
}

async function renderPosterBlob(d) {
  let res;
  for (let sc = 1; sc >= MIN_SCALE - 1e-9; sc = +(sc - .05).toFixed(2)) {
    let pages = 0;
    const dd = buildPoster(d, sc, { version: BUILD_VERSION }), footer = dd.footer;
    dd.footer = (cur, total) => { pages = total; return footer(cur, total); };
    const blob = await pdfMake.createPdf(dd).getBlob();
    res = { blob, pages, sc };
    if (pages === 1) break;
  }
  return res;
}

async function withBusy(fn) {
  if (busy) return;
  busy = true; render();
  try { await loadFonts(); await fn(); }
  catch (e) { console.error(e); alert('Не вдалося створити PDF: ' + (e && e.message || e)); }
  finally { busy = false; render(); }
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const nameOf = (prefix, d) => safeFileName([prefix, d.unit?.toUpperCase(), d.date].filter(hasText).join('_')) + '.pdf';

async function poster(r) {
  await withBusy(async () => {
    const { blob, pages } = await renderPosterBlob(r.data);
    if (pages > 1 && !confirm(`Плакат «${r.data.unit || ''}» не вміщується на один аркуш A4 навіть з найменшим шрифтом (${pages} стор.). Все одно завантажити?`)) return;
    saveBlob(blob, nameOf('Plakat', r.data));
  });
}
async function allPosters() {
  await withBusy(async () => {
    // Кожен плакат підбирає свій масштаб; збираємо сторінки в один документ
    const docs = [];
    for (const r of [...reports].sort((a, b) => (a.data.unit || '').localeCompare(b.data.unit || '', 'uk'))) {
      let chosen = null;
      for (let sc = 1; sc >= MIN_SCALE - 1e-9; sc = +(sc - .05).toFixed(2)) {
        let pages = 0;
        const dd = buildPoster(r.data, sc, { version: BUILD_VERSION }), footer = dd.footer;
        dd.footer = (cur, total) => { pages = total; return footer(cur, total); };
        await pdfMake.createPdf(dd).getBlob();
        chosen = buildPoster(r.data, sc, { version: BUILD_VERSION });
        if (pages === 1) break;
      }
      docs.push(chosen);
    }
    const merged = { ...docs[0], info: { title: 'Довідки чергових — усі підрозділи', creator: `Медслужба — плакати ${BUILD_VERSION}`, producer: 'pdfmake' },
      content: docs.map((d, i) => ({ stack: d.content, fontSize: d.defaultStyle.fontSize, lineHeight: d.defaultStyle.lineHeight, ...(i ? { pageBreak: 'before' } : {}) })),
      footer: (cur, total) => ({ margin: [32, 14, 32, 0], fontSize: 6.5, color: '#6b6b6b', columns: [
        { text: 'Довідки чергових підрозділів. Дата актуальності — у заголовку кожного аркуша.' }, { text: `${cur} / ${total}`, alignment: 'right', width: 40 }] }) };
    const blob = await pdfMake.createPdf(merged).getBlob();
    saveBlob(blob, safeFileName(`Plakaty_usi_${reports.length}`) + '.pdf');
  });
}
async function sheet() {
  await withBusy(async () => {
    const dd = buildContactsSheet([...reports].sort((a, b) => (a.data.unit || '').localeCompare(b.data.unit || '', 'uk')), { version: BUILD_VERSION });
    saveBlob(await pdfMake.createPdf(dd).getBlob(), safeFileName('Cherhovi_zvedennia') + '.pdf');
  });
}
async function report(r) {
  await withBusy(async () => {
    const dd = buildReport(r.data, { kind: r.kind, created: new Date().toISOString(), version: BUILD_VERSION });
    saveBlob(await pdfMake.createPdf(dd).getBlob(), nameOf(r.kind === 'draft' ? 'Chernetka' : 'Zvit_med', r.data));
  });
}

app.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  const byId = id => reports.find(r => r.id === +id);
  if (t.dataset.poster) poster(byId(t.dataset.poster));
  else if (t.dataset.report) report(byId(t.dataset.report));
  else if (t.dataset.details) { const r = byId(t.dataset.details); r.open = !r.open; render(); }
  else if (t.dataset.del) { reports = reports.filter(r => r.id !== +t.dataset.del); render(); }
  else if (t.id === 'all') allPosters();
  else if (t.id === 'sheet') sheet();
  else if (t.id === 'clear') { if (confirm('Прибрати всі відкриті звіти?')) { reports = []; render(); } }
});
app.addEventListener('change', e => { if (e.target.id === 'open') { addFiles(e.target.files); e.target.value = ''; } });
app.addEventListener('keydown', e => { if (e.target.id === 'openl' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('#open').click(); } });
addEventListener('dragover', e => { e.preventDefault(); $('#drop')?.classList.add('over'); });
addEventListener('dragleave', e => { if (!e.relatedTarget) $('#drop')?.classList.remove('over'); });
addEventListener('drop', e => { e.preventDefault(); $('#drop')?.classList.remove('over'); addFiles(e.dataTransfer.files); });

let toastTimer = null;
function toast(msg, ms = 5000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

render();
