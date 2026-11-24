// Інструмент медслужби: відкриває звіти підрозділів (PDF), показує їх стан і друкує плакати.

import { TITLE, ROLES, HEAD_CONTACTS, NONE, listDef, listOfPath } from './schema.mjs';
import { createForm } from '../form/app.mjs';
import { hasText, esc, fmtDate, safeFileName, plural } from './text.mjs';
import { validateData, normalizeData, errorsOf, warningsOf, isNewFieldError } from './validate.mjs';
import { readPdfBytes } from './codec.mjs';
import { buildPoster, buildContactsSheet, buildNeedsSheet, MIN_SCALE } from './poster.mjs';
import { buildReport, collectNeeds, nrkShort, nrkFeatures } from './report.mjs';
import { loadFonts } from './pdfkit.mjs';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const SMALL_SCALE = 0.7;   // дрібніший масштаб плаката — попереджаємо, що текст замалий для стіни

// reports: [{ id, file, data, kind, legacy, created, v, errors, warnings, needs, open, fit }]
let reports = [];
let seq = 0;
let busy = false;
let status = '';           // текст поточної операції (показується замість кнопок)
const byUnit = (a, b) => (a.data.unit || '').localeCompare(b.data.unit || '', 'uk', { numeric: true, sensitivity: 'base' });
const sorted = () => [...reports].sort(byUnit);
const kindName = (r, acc = false) => r.kind === 'draft' ? (acc ? 'чернетку' : 'чернетка') : (acc ? 'звіт' : 'звіт');

// Скільки точок з НРК ще без моделі чи без відповіді про переобладнання
const nrkGaps = r => (r.data.points || []).filter(p => p.nrk === 'Є' && (!hasText(p.nrk_model) || !hasText(p.nrk_mod) || (p.nrk_mod === 'Так' && !hasText(p.nrk_mod_note)))).length;
// Перерахувати стан звіту після зміни даних
function refreshReport(r) {
  const problems = validateData(r.data);
  r.errors = errorsOf(problems); r.warnings = warningsOf(problems); r.needs = collectNeeds(r.data); r.fit = null;
}

// Помилки, що не зводяться до «нові поля ще не заповнені» (для звітів попередніх версій форми)
const realErrors = r => r.migrated ? r.errors.filter(e => !isNewFieldError(e)) : r.errors;
const isClean = r => r.kind === 'report' && !r.errors.length;

function render() {
  const rows = sorted();
  const dis = busy ? ' disabled' : '';
  app.innerHTML = `
  <header class="bar"><div class="bar-in">
    <div class="brand"><h1>Медслужба — плакати зі звітів</h1><p>${esc(TITLE)} · версія ${esc(BUILD_VERSION)}</p></div>
    <div class="bar-act">
      <label class="btn primary${busy ? ' off' : ''}" tabindex="0" id="openl">Відкрити звіти PDF<input type="file" id="open" accept=".pdf,application/pdf" multiple hidden${dis}></label>
      ${reports.length ? `<button type="button" class="btn" id="clear"${dis}>Прибрати всі</button>` : ''}
    </div>
  </div></header>
  <main class="main">
    <button type="button" class="drop" id="drop"${dis}>
      <b>Перетягніть сюди PDF-звіти підрозділів</b>
      <span>або натисніть, щоб обрати файли. Можна кілька одразу. Дані не залишають цей пристрій.</span>
    </button>
    ${busy ? `<p class="status" role="status">${esc(status || 'Працюю…')}</p>` : ''}
    ${reports.length ? `
    <div class="tools">
      <button type="button" class="btn primary" id="all"${dis}>Усі плакати одним PDF (${reports.length})</button>
      <button type="button" class="btn" id="sheet"${dis}>Зведення контактів</button>
      <button type="button" class="btn" id="needs"${dis}>Зведення потреб</button>
      ${reports.some(r => r.dirty) ? `<button type="button" class="btn warnb" id="updated"${dis} title="Звіти, змінені тут, — щоб зберегти зміни й повернути підрозділам">Завантажити оновлені звіти (${reports.filter(r => r.dirty).length})</button>` : ''}
    </div>
    <table class="tbl"><thead><tr><th>Підрозділ</th><th>Дата</th><th>Заповнив</th><th>Стан</th><th>Анкета</th><th>Точки</th><th>Потреби</th><th></th></tr></thead>
    <tbody>${rows.map(rowHtml).join('')}</tbody></table>
    <p class="hint">Нову інформацію (наприклад, модель НРК чи інший позивний чергового) вносьте кнопкою «Редагувати» біля підрозділу: відкриється анкета з даними звіту. Після збереження плакат уже з новими даними; щоб зберегти зміни у файлі — завантажте оновлений звіт.</p>
    <p class="hint">Плакат — це «Довідка чергового» на один аркуш A4: чергові, точки передачі, позиції для скидів, алгоритм. Змінні дані (забезпечення, потреби, підготовка) дивіться у звіті підрозділу або у «Зведенні потреб»; звіт можна сформувати заново кнопкою «Звіт».</p>
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

function stateBadges(r) {
  const out = [];
  if (r.kind === 'draft') out.push('<span class="badge warn">чернетка</span>');
  const real = realErrors(r), fresh = r.errors.length - real.length;
  const freshNote = fresh ? ` · ${fresh} нових ${plural(fresh, 'поле', 'поля', 'полів')} не заповнено` : '';
  if (r.legacy) out.push(`<span class="badge grey" title="Файл старої версії форми">стара форма${freshNote}</span>`);
  else if (r.migrated && fresh) out.push(`<span class="badge grey" title="Файл попередньої версії форми">попередня версія форми${freshNote}</span>`);
  if (real.length) out.push(`<span class="badge bad">${real.length} ${plural(real.length, 'помилка', 'помилки', 'помилок')}</span>`);
  if (!r.errors.length && r.kind === 'report') out.push('<span class="badge ok">✓ повний</span>');
  if (r.warnings.length) out.push(`<span class="badge grey">${r.warnings.length} зауваж.</span>`);
  const gaps = nrkGaps(r);
  if (gaps) out.push(`<span class="badge warn" title="Точки з НРК без моделі чи без відповіді про переобладнання — доповніть через «Редагувати»">НРК: доповнити ${gaps}</span>`);
  if (r.dirty) out.push('<span class="badge warn" title="Зміни є лише тут — завантажте оновлений звіт">змінено, не збережено</span>');
  else if (r.amended) out.push(`<span class="badge grey" title="Дані змінено медслужбою ${esc(fmtDate(r.amended.slice(0, 10)))}">змінено медслужбою</span>`);
  return out.join('');
}

// Якою анкетою заповнено звіт: поточною, іншою версією чи старою (без позначки версії)
const buildBadge = r => !r.build ? '<span class="badge grey" title="У файлі немає позначки версії — заповнено анкетою до листопада 2026">стара анкета</span>'
  : r.build === BUILD_VERSION ? '<span class="badge ok" title="Та сама версія, що й цей інструмент">актуальна</span>'
  : `<span class="badge grey" title="Заповнено іншою версією анкети">версія ${esc(r.build)}</span>`;

function rowHtml(r) {
  const d = r.data, dis = busy ? ' disabled' : '';
  const bad = r.needs.filter(n => n.level === 'bad').length;
  const needs = r.needs.filter(n => n.level !== 'note');
  return `<tr data-id="${r.id}">
    <td><b class="unit">${esc(hasText(d.unit) ? d.unit.toUpperCase() : '—')}</b><small>${esc(r.file)}</small></td>
    <td>${esc(fmtDate(d.date) || '—')}</td>
    <td>${esc(d.author || '—')}</td>
    <td><div class="st">${stateBadges(r)}</div></td>
    <td>${buildBadge(r)}</td>
    <td>${(d.points || []).length}${d.drops === 'Так' ? ` <small>· ${(d.positions || []).length} поз.</small>` : ''}</td>
    <td>${needs.length ? `<span class="${bad ? 'bad' : ''}">${needs.length}</span>` : '—'}</td>
    <td class="act">
      <button type="button" class="btn sm primary" data-poster="${r.id}"${dis}>Плакат</button>
      <button type="button" class="btn sm" data-edit="${r.id}"${dis} title="Відкрити звіт в анкеті й змінити будь-які дані">Редагувати</button>
      <button type="button" class="btn sm" data-report="${r.id}"${dis} title="Сформувати повний звіт заново з даних цього файла (з доповненнями)">Звіт</button>
      <button type="button" class="btn sm" data-details="${r.id}" aria-expanded="${r.open}">Деталі</button>
      <button type="button" class="del" data-del="${r.id}"${dis} aria-label="Прибрати зі списку">✕</button>
    </td>
  </tr>${r.open ? `<tr class="det"><td colspan="8">${detailsHtml(r)}</td></tr>` : ''}`;
}

function nrkListHtml(d) {
  const pts = (d.points || []).map((p, i) => ({ p, i })).filter(x => x.p.nrk === 'Є');
  if (!pts.length) return '';
  return `<h4 class="sub">НРК</h4><div class="roles">${pts.map(({ p, i }) => `<div><b>Точка ${i + 1}${hasText(p.name) ? ` «${esc(p.name)}»` : ''}</b> ${esc(nrkShort(p))}
    <br><small>${esc([hasText(p.nrk_model) ? p.nrk_model : 'модель не вказано', nrkFeatures(p).join(', '),
      p.nrk_mod === 'Так' ? `переобладнано: ${p.nrk_mod_note || '—'}` : p.nrk_mod === 'Ні' ? 'без переобладнання' : 'переобладнання — не вказано'].filter(hasText).join(' · '))}</small></div>`).join('')}</div>`;
}

function detailsHtml(r) {
  const d = r.data;
  const roles = ROLES.map(x => `<div><b>${esc(x.short)}</b> ${esc(d[`${x.role}_callsign`] || '—')}<br><small>${['phone', 'signal', 'element', 'discord'].map(k => d[`${x.role}_${k}`]).filter(hasText).map(esc).join(' · ') || '—'}</small></div>`).join('');
  const needs = r.needs.length ? `<ul>${r.needs.map(n => `<li class="${n.level}"><span>${esc(n.where)}</span> ${esc(n.what)}</li>`).join('')}</ul>` : '<p class="hint">Потреб не зазначено.</p>';
  const probs = [...r.errors, ...r.warnings];
  const headC = HEAD_CONTACTS.map(c => d[c.k]).filter(v => hasText(v) && v !== NONE).map(esc).join(' · ');
  const med = `<div><b>Координати</b> ${esc(d.mp_coords || '—')}</div><div><b>Начальник</b> ${esc(d.mphead_callsign || '—')}<br><small>${headC || '—'}</small></div>`;
  return `<div class="details">
    <div><h4>Чергові</h4><div class="roles">${roles}</div><h4 class="sub">Медпункт</h4><div class="roles">${med}</div>
      ${nrkListHtml(d)}</div>
    <div><h4>Потреби та зауваги (${r.needs.length})</h4>${needs}</div>
    ${probs.length ? `<div><h4>Помилки та зауваження (${probs.length})</h4><ul class="probs">${probs.map(p => `<li class="${p.level}">${esc(p.item != null ? `${listDef(listOfPath(p.path)).item} ${p.item + 1} · ` : '')}${esc(p.label)}: ${esc(p.msg)}</li>`).join('')}</ul></div>` : ''}
    ${r.created ? `<p class="hint">Файл сформовано ${esc(new Date(r.created).toLocaleString('uk-UA'))}${r.v ? `, схема v${r.v}` : ''}${r.build ? `, анкета ${esc(r.build)}` : ''}.</p>` : ''}
  </div>`;
}

// Пріоритет файлів одного підрозділу: повний звіт завжди важливіший за чернетку; серед однакових — новіший за датою
const rank = r => `${r.kind === 'report' ? 1 : 0}|${r.data.date || ''}|${r.amended || ''}`;

async function addFiles(files) {
  const list = [...files].filter(f => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)));
  if (!list.length) { toast('Оберіть PDF-файли, сформовані анкетою.'); return; }
  busy = true; status = `Читаю ${list.length} ${plural(list.length, 'файл', 'файли', 'файлів')}…`; render();
  let added = 0; const notes = [], failed = [];
  for (const f of list) {
    if (f.size > MAX_PDF_BYTES) { failed.push(`${f.name}: завеликий`); continue; }
    try {
      const p = await readPdfBytes(new Uint8Array(await f.arrayBuffer()));
      const data = normalizeData(p.data);
      const problems = validateData(data);
      const r = { id: ++seq, file: f.name, data, kind: p.kind, build: p.build, amended: p.amended, dirty: false, legacy: !!(p.legacy || p.data.migratedFrom === 1), migrated: !!(p.legacy || p.data.migratedFrom), created: p.created, v: p.v,
        errors: errorsOf(problems), warnings: warningsOf(problems), needs: collectNeeds(data), open: false, fit: null };
      const same = reports.find(x => hasText(x.data.unit) && hasText(data.unit) && x.data.unit.toUpperCase() === data.unit.toUpperCase());
      if (same) {
        if (rank(r) > rank(same)) { reports = reports.filter(x => x !== same); reports.push(r); notes.push(`${data.unit.toUpperCase()}: ${kindName(same, true)} від ${fmtDate(same.data.date)} замінено на ${kindName(r, true)} від ${fmtDate(data.date)}`); added++; }
        else notes.push(`${data.unit.toUpperCase()}: уже відкрито ${kindName(same, true)} від ${fmtDate(same.data.date)}, файл ${f.name} пропущено`);
      } else { reports.push(r); added++; }
    } catch (e) { failed.push(`${f.name}: ${e && e.message || 'не вдалося прочитати'}`); }
  }
  busy = false; status = ''; render();
  if (failed.length) alert('Не вдалося відкрити:\n' + failed.join('\n'));
  const head = added ? `Відкрито ${added} ${plural(added, 'звіт', 'звіти', 'звітів')}.` : '';
  if (head || notes.length) toast([head, ...notes].filter(Boolean).join(' '), notes.length ? 9000 : 5000);
}

// Підбір масштабу плаката під один аркуш: двійковий пошук серед кроків 1.00 … MIN_SCALE
const SCALES = Array.from({ length: Math.round((1 - MIN_SCALE) / .05) + 1 }, (_, i) => +(1 - i * .05).toFixed(2));
const posterWarn = r => r.kind === 'draft' ? 'Чернетка — дані не перевірені' : realErrors(r).length ? 'Звіт із помилками — дані неповні' : r.legacy ? 'Стара форма — без даних про НРК' : '';
async function pagesAt(r, sc) {
  let pages = 0;
  const dd = buildPoster(r.data, sc, { version: BUILD_VERSION, warn: posterWarn(r) }), footer = dd.footer;
  dd.footer = (cur, total) => { pages = total; return footer(cur, total); };
  await pdfMake.createPdf(dd).getBlob();
  return pages;
}
async function fitPoster(r) {
  if (r.fit) return r.fit;
  let lo = 0, hi = SCALES.length - 1, best = null;           // SCALES[0] = 1 — найбільший
  if (await pagesAt(r, SCALES[0]) === 1) best = 0;
  else {
    lo = 1;
    if (await pagesAt(r, SCALES[hi]) !== 1) { r.fit = { sc: SCALES[hi], pages: await pagesAt(r, SCALES[hi]) }; return r.fit; }
    best = hi;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (await pagesAt(r, SCALES[mid]) === 1) { best = mid; hi = mid; } else lo = mid + 1; }
  }
  r.fit = { sc: SCALES[best], pages: 1 };
  return r.fit;
}
const posterDoc = (r, sc) => buildPoster(r.data, sc, { version: BUILD_VERSION, warn: posterWarn(r) });

async function withBusy(label, fn) {
  if (busy) return;
  busy = true; status = label; render();
  try { await loadFonts(); await fn(); }
  catch (e) { console.error(e); alert('Не вдалося створити PDF: ' + (e && e.message || e)); }
  finally { busy = false; status = ''; render(); }
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const nameOf = (prefix, d) => safeFileName([prefix, d.unit?.toUpperCase(), d.date].filter(hasText).join('_')) + '.pdf';
const confirmUnclean = (r, what) => isClean(r) || confirm(`${r.data.unit || 'Підрозділ'}: це ${r.kind === 'draft' ? 'чернетка' : 'звіт із помилками або старої форми'}. ${what} матиме позначку-попередження. Продовжити?`);

async function poster(r) {
  if (!confirmUnclean(r, 'Плакат')) return;
  await withBusy(`Готую плакат «${r.data.unit || ''}»…`, async () => {
    const fit = await fitPoster(r);
    if (fit.pages > 1 && !confirm(`Плакат «${r.data.unit || ''}» не вміщується на один аркуш A4 навіть з найменшим шрифтом (${fit.pages} стор.). Усе одно завантажити?`)) return;
    if (fit.pages === 1 && fit.sc < SMALL_SCALE && !confirm(`Щоб уміститись на A4, текст плаката «${r.data.unit || ''}» зменшено до ${Math.round(fit.sc * 100)} %. Для стіни може бути дрібно — друкуйте на A3. Продовжити?`)) return;
    const blob = await pdfMake.createPdf(posterDoc(r, fit.sc)).getBlob();
    saveBlob(blob, nameOf('Plakat', r.data));
  });
}
async function allPosters() {
  const unclean = reports.filter(r => !isClean(r));
  let list = sorted();
  if (unclean.length) {
    const clean = list.filter(isClean).length;
    const how = await choose('Не всі звіти повні',
      `${unclean.length} ${plural(unclean.length, 'файл', 'файли', 'файлів')} — чернетки або звіти з помилками: ${unclean.map(r => r.data.unit || r.file).join(', ')}.`,
      [['clean', `Лише повні звіти (${clean})`, 'primary'], ['all', 'Усі, з позначкою-попередженням'], ['cancel', 'Скасувати']]);
    if (how === 'cancel') return;
    if (how === 'clean') list = list.filter(isClean);
    if (!list.length) { toast('Немає повних звітів для друку.'); return; }
  }
  await withBusy('Готую плакати…', async () => {
    const docs = [];
    for (const [i, r] of list.entries()) {
      status = `Плакат ${i + 1} з ${list.length}: ${r.data.unit || r.file}…`; const st = $('.status', app); if (st) st.textContent = status;
      const fit = await fitPoster(r);
      docs.push(posterDoc(r, fit.sc));
    }
    const merged = { ...docs[0], info: { title: 'Довідки чергових — усі підрозділи', creator: `Медслужба — плакати ${BUILD_VERSION}`, producer: 'pdfmake' },
      content: docs.map((d, i) => ({ stack: d.content, fontSize: d.defaultStyle.fontSize, lineHeight: d.defaultStyle.lineHeight, ...(i ? { pageBreak: 'before' } : {}) })),
      footer: (cur, total) => ({ margin: [32, 14, 32, 0], fontSize: 6.5, color: '#6b6b6b', columns: [
        { text: 'Довідки чергових підрозділів. Дата актуальності — у заголовку кожного аркуша.' }, { text: `${cur} / ${total}`, alignment: 'right', width: 40 }] }) };
    const blob = await pdfMake.createPdf(merged).getBlob();
    saveBlob(blob, safeFileName(`Plakaty_usi_${docs.length}`) + '.pdf');
  });
}
async function sheet() {
  await withBusy('Готую зведення контактів…', async () => {
    const dd = buildContactsSheet(sorted(), { version: BUILD_VERSION });
    saveBlob(await pdfMake.createPdf(dd).getBlob(), safeFileName('Cherhovi_zvedennia') + '.pdf');
  });
}
async function needsSheet() {
  await withBusy('Готую зведення потреб…', async () => {
    const dd = buildNeedsSheet(sorted(), { version: BUILD_VERSION });
    saveBlob(await pdfMake.createPdf(dd).getBlob(), safeFileName('Potreby_zvedennia') + '.pdf');
  });
}
const reportBlob = async r => pdfMake.createPdf(buildReport(r.data, { kind: r.kind, created: r.created || new Date().toISOString(), version: BUILD_VERSION,
  build: r.build || '', amended: r.amended || '', regenerated: new Date().toISOString() })).getBlob();
async function report(r) {
  await withBusy(`Формую звіт «${r.data.unit || ''}»…`, async () => {
    saveBlob(await reportBlob(r), nameOf(r.kind === 'draft' ? 'Chernetka' : 'Zvit_med', r.data));
    r.dirty = false;
  });
}
// Усі доповнені тут звіти — по черзі (браузер може один раз спитати дозвіл на кілька завантажень)
async function updatedReports() {
  const list = sorted().filter(r => r.dirty);
  await withBusy('Формую оновлені звіти…', async () => {
    for (const [i, r] of list.entries()) {
      status = `Звіт ${i + 1} з ${list.length}: ${r.data.unit || r.file}…`; const st = $('.status', app); if (st) st.textContent = status;
      saveBlob(await reportBlob(r), nameOf('Zvit_med', r.data));
      r.dirty = false;
      await new Promise(res => setTimeout(res, 400));
    }
  });
  toast(`Завантажено ${list.length} ${plural(list.length, 'оновлений звіт', 'оновлені звіти', 'оновлених звітів')}. Збережіть їх і, за потреби, поверніть підрозділам.`, 8000);
}

// ---------- редагування звіту: та сама анкета, у режимі медслужби ----------
// Анкета монтується в shadow DOM (#editor), щоб її стилі не змішувалися зі стилями цього інструмента.
let editing = null;          // { r, form } — звіт, що зараз редагується
function openEditor(r) {
  const host = $('#editor');
  if (!host.shadowRoot) host.attachShadow({ mode: 'open' }).innerHTML = `<style>${FORM_CSS}</style><div class="form-root"></div>`;
  app.hidden = true; host.hidden = false;
  editing = { r, form: createForm(host.shadowRoot.querySelector('.form-root'), {
    mode: 'med', data: r.data, cssHost: host, onSave: d => closeEditor(d), onCancel: () => closeEditor(null) }) };
}
function closeEditor(next) {
  const { r, form } = editing, host = $('#editor');
  form.destroy(); editing = null;
  host.hidden = true; app.hidden = false;
  if (next && JSON.stringify(next) !== JSON.stringify(normalizeData(r.data))) {
    r.data = next; r.amended = new Date().toISOString(); r.dirty = true; refreshReport(r);
    toast(`Зміни «${r.data.unit || r.file}» збережено тут — плакат уже з ними. Щоб зберегти їх у файлі, завантажте оновлений звіт.`, 8000);
  }
  render(); window.scrollTo({ top: 0 });
  $(`[data-edit="${r.id}"]`, app)?.focus();
}

app.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t || t.disabled) return;
  const byId = id => reports.find(r => r.id === +id);
  if (t.id === 'drop') $('#open').click();
  else if (t.dataset.poster) poster(byId(t.dataset.poster));
  else if (t.dataset.report) report(byId(t.dataset.report));
  else if (t.dataset.edit) openEditor(byId(t.dataset.edit));
  else if (t.id === 'updated') updatedReports();
  else if (t.dataset.details) { const r = byId(t.dataset.details); r.open = !r.open; render(); $(`[data-details="${r.id}"]`, app)?.focus(); }
  else if (t.dataset.del) { const r = byId(t.dataset.del); if (r.dirty && !confirm(`${r.data.unit || r.file}: зміни ще не збережено в звіті. Прибрати все одно?`)) return; reports = reports.filter(x => x !== r); render(); }
  else if (t.id === 'all') allPosters();
  else if (t.id === 'sheet') sheet();
  else if (t.id === 'needs') needsSheet();
  else if (t.id === 'clear') { if (confirm(reports.some(r => r.dirty) ? 'Є зміни, які ще не збережено в звітах. Прибрати всі звіти все одно?' : 'Прибрати всі відкриті звіти зі списку?')) { reports = []; render(); } }
});
app.addEventListener('change', e => { if (e.target.id === 'open') { addFiles(e.target.files); e.target.value = ''; } });
app.addEventListener('keydown', e => { if (e.target.id === 'openl' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (!busy) $('#open').click(); } });
addEventListener('dragover', e => { e.preventDefault(); if (!editing) $('#drop')?.classList.add('over'); });
addEventListener('dragleave', e => { if (!e.relatedTarget) $('#drop')?.classList.remove('over'); });
addEventListener('drop', e => { e.preventDefault(); $('#drop')?.classList.remove('over'); if (!busy && !editing) addFiles(e.dataTransfer.files); });

// Діалог із кількома підписаними кнопками; повертає id обраної (Esc або закриття — останній варіант)
function choose(title, text, options) {
  return new Promise(res => {
    const dlg = document.createElement('dialog');
    dlg.className = 'choose';
    dlg.innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="choose-b">${options.map(([id, label, cls]) => `<button type="button" class="btn ${cls || ''}" data-choose="${esc(id)}">${esc(label)}</button>`).join('')}</div>`;
    const fallback = options[options.length - 1][0];
    let picked = fallback;
    dlg.addEventListener('click', e => { const b = e.target.closest('[data-choose]'); if (b) { picked = b.dataset.choose; dlg.close(); } });
    dlg.addEventListener('close', () => { dlg.remove(); res(picked); });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('.btn.primary, .btn')?.focus();
  });
}

let toastTimer = null;
function toast(msg, ms = 5000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

render();
// змінені дані живуть лише тут, доки не завантажено оновлений звіт
addEventListener('beforeunload', e => { if (editing || reports.some(r => r.dirty)) { e.preventDefault(); e.returnValue = ''; } });
