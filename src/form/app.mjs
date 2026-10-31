// Анкета для підрозділів: покрокова форма з живою перевіркою, чернетками й звітом PDF.

import { STEPS, SECTIONS, NONE, FORM_NAME, CONTACTS_NOTE, sectionById, listDef, visible, required, emptyData, stepOfSection } from './schema.mjs';
import { hasText, esc, fmtDate, todayISO, safeFileName, plural } from './text.mjs';
import { KINDS, kindOf, maxLen, validateData, normalizeData, errorsOf, warningsOf, progressOf, OTHER_MAX } from './validate.mjs';
import { readPdfBytes } from './codec.mjs';
import { buildReport } from './report.mjs';
import { loadFonts } from './pdfkit.mjs';
import { iconSvg } from './icons.mjs';

const DRAFT_KEY = 'med-anketa-draft-v2';
const DRAFT_TTL_DAYS = 2;
const WARN_ACK_PREFIX = 'ack:';
const MAX_PDF_BYTES = 50 * 1024 * 1024;

// ---------- стан ----------
let data = emptyData();
let step = 0;
let dirty = false;
let attempted = new Set();     // кроки, на яких натиснули «Далі» — там показуємо всі помилки
let touched = new Set();       // поля, яких торкалися — там показуємо помилку одразу
let ack = new Set();           // підтверджені попередження (ключ = path + msg)
let openCard = { points: 0, positions: 0 };
let problemsCache = null;
let reopened = null;           // { date, kind } — з якого файла підставлено дані (нагадування оновити дату)
let draftOk = true;            // чи працює сховище браузера

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');

// ---------- доступ до даних за шляхом ----------
const parsePath = path => {
  const m = path.match(/^(points|positions)\.(\d+)\.(.+)$/);
  return m ? { list: m[1], idx: +m[2], key: m[3] } : { key: path };
};
const getAt = path => { const p = parsePath(path); return (p.list ? data[p.list]?.[p.idx] : data)?.[p.key] ?? ''; };
const setAt = (path, v) => {
  const p = parsePath(path);
  const o = p.list ? data[p.list][p.idx] : data;
  if (!o) return;
  if (v === '' || v == null) delete o[p.key]; else o[p.key] = v;
  dirty = true; problemsCache = null;
};
const itemOf = path => { const p = parsePath(path); return p.list ? data[p.list][p.idx] : data; };
const fieldDef = path => {
  const p = parsePath(path);
  if (p.list) return listDef(p.list).fields.find(f => f.k === p.key) || null;
  for (const s of SECTIONS) { const f = s.fields?.find(f => f.k === path); if (f) return f; }
  return null;
};

// ---------- перевірка ----------
const problems = () => problemsCache || (problemsCache = validateData(normalizeData(data)));
const errors = () => errorsOf(problems());
const warnings = () => warningsOf(problems());
const ackKey = w => WARN_ACK_PREFIX + w.path + '|' + w.msg;
const stepErrors = id => errors().filter(p => p.step === id);
const fieldProblems = path => problems().filter(p => p.path === path);
const hasAnyData = () => Object.keys(data).some(k => !['v', 'points', 'positions', 'date'].includes(k)) || data.points.some(p => Object.keys(p).length) || data.positions.length;

// ---------- рендер полів ----------
const idOf = path => 'f_' + path.replace(/\W/g, '_');
function fieldHtml(f, path, item) {
  const id = idOf(path);
  const hidden = !visible(f, item) ? ' hidden' : '';   // атрибут hidden, не клас
  const show = f.showIf ? ` data-showif="${esc(f.showIf[0])}" data-showvals="${esc(JSON.stringify(f.showIf[1]))}"` : '';
  const req = required(f, item, data);
  const star = req ? '<span class="req" aria-hidden="true">*</span>' : '';
  const label = `<label class="lbl" for="${id}">${esc(f.l)}${star}</label>`;
  const hint = f.hint ? `<p class="hint">${esc(f.hint)}</p>` : '';
  const err = `<p class="err" id="${id}_err"></p>`;
  const v = item?.[f.k] ?? '';
  const kind = kindOf(f);
  const ph = f.ph || kind?.ph || '';
  const im = kind?.inputmode ? ` inputmode="${kind.inputmode}"` : '';
  const caps = kind?.autocapitalize || (f.v === 'unit' ? 'characters' : null);
  const textAttrs = ` autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="next" aria-describedby="${id}_err"${caps ? ` autocapitalize="${caps}"` : ''}`;

  if (f.t === 'group') {
    const rows = f.items.map(([k, l]) => {
      const pk = `${path}_${k}`, iid = idOf(pk);
      return `<div class="lvl"><label for="${iid}">${esc(l)}</label>
        <div class="lvl-in"><input id="${iid}" type="text" inputmode="numeric" maxlength="3" data-path="${esc(pk)}" data-kind="count" value="${esc(item?.[`${f.k}_${k}`] ?? '')}" placeholder="0" autocomplete="off" enterkeyhint="next" aria-describedby="${iid}_err"><span>ос.</span></div>
        <p class="err" id="${iid}_err"></p></div>`;
    }).join('');
    const ok = `${path}_other`, oid = idOf(ok);
    return `<fieldset class="fld group" data-field="${esc(path)}"><legend class="lbl">${esc(f.l)}${star}</legend>
      <p class="hint">${esc(f.tip || '')}</p>
      <div class="levels">${rows}</div>
      <label class="lbl" for="${oid}">Інше або уточнення</label>
      <input id="${oid}" type="text" maxlength="${OTHER_MAX}" data-path="${esc(ok)}" value="${esc(item?.[`${f.k}_other`] ?? '')}" placeholder="наприклад: 1 водій пройшов курс зупинки кровотечі" autocomplete="off" enterkeyhint="next" aria-describedby="${id}_err">
      ${err}</fieldset>`;
  }
  if (f.t === 'seg') {
    const opts = f.o.map(o => `<button type="button" role="radio" aria-checked="${v === o}" class="seg-btn${v === o ? ' on' : ''}" data-val="${esc(o)}">${esc(o)}</button>`).join('');
    return `<div class="fld" data-field="${esc(path)}"${show}${hidden}><span class="lbl" id="${id}_l">${esc(f.l)}${star}</span>${hint}
      <div class="seg" role="radiogroup" aria-labelledby="${id}_l" aria-describedby="${id}_err" data-path="${esc(path)}" id="${id}">${opts}</div>${err}</div>`;
  }
  if (f.none) {
    const none = v === NONE;
    return `<div class="fld" data-field="${esc(path)}"${hidden}>
      <span class="lbl" id="${id}_l">${f.icon ? `<i class="ico">${iconSvg(f.icon)}</i>` : ''}${esc(f.l)}${star}</span>
      <div class="withnone">
        <input id="${id}" type="text" aria-labelledby="${id}_l" data-path="${esc(path)}" data-kind="${esc(f.v || '')}" maxlength="${maxLen(f)}" placeholder="${esc(ph)}" value="${none ? '' : esc(v)}"${none ? ' disabled' : ''}${im}${textAttrs.replace(/ autocapitalize="[^"]*"/, '')} autocapitalize="off">
        <label class="none${none ? ' on' : ''}"><input type="checkbox" data-none="${esc(path)}"${none ? ' checked' : ''}> ${NONE}</label>
      </div>${err}</div>`;
  }
  let ctl;
  if (f.t === 'area') ctl = `<textarea id="${id}" data-path="${esc(path)}" rows="2" maxlength="${maxLen(f)}" placeholder="${esc(ph)}" aria-describedby="${id}_err">${esc(v)}</textarea><span class="cnt" data-cnt="${esc(path)}"></span>`;
  else if (f.t === 'date') ctl = `<input id="${id}" type="date" data-path="${esc(path)}" value="${esc(v)}" max="${todayISO()}" aria-describedby="${id}_err">`;
  else ctl = `<input id="${id}" type="text" data-path="${esc(path)}" data-kind="${esc(f.v || '')}" maxlength="${maxLen(f)}" placeholder="${esc(ph)}" value="${esc(v)}"${im}${textAttrs}>`;
  return `<div class="fld" data-field="${esc(path)}"${show}${hidden}>${label}${hint}${ctl}${err}</div>`;
}

const cardStatus = (listKey, i) => {
  const e = errors().filter(p => p.path.startsWith(`${listKey}.${i}.`)).length;
  if (e) return `<span class="badge bad">${e} ${plural(e, 'помилка', 'помилки', 'помилок')}</span>`;
  const seen = attempted.has(stepOfSection(listKey === 'points' ? 'points' : 'drops').id) || Object.keys(data[listKey][i]).length > 2;
  return seen ? '<span class="badge ok">✓ заповнено</span>' : '';
};

function cardHtml(listKey, i) {
  const def = listDef(listKey), item = data[listKey][i], open = openCard[listKey] === i;
  const title = hasText(item.name) ? item.name.trim() : '';
  const sub = hasText(item.coords) ? item.coords : '';
  const body = def.groups
    ? def.groups.map(g => `<div class="grp"><h4>${esc(g.title)}</h4>${g.fields.map(f => fieldHtml(f, `${listKey}.${i}.${f.k}`, item)).join('')}</div>`).join('')
    : def.fields.map(f => fieldHtml(f, `${listKey}.${i}.${f.k}`, item)).join('');
  const canDelete = !(listKey === 'points' && data[listKey].length <= 1);
  return `<article class="card${open ? ' open' : ''}" data-card="${listKey}" data-idx="${i}">
    <header class="card-h">
      <button type="button" class="card-t" data-toggle="${listKey}:${i}" aria-expanded="${open}">
        <span class="num">${esc(def.item)} ${i + 1}</span>
        <span class="ttl">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
        ${cardStatus(listKey, i)}
        <span class="chev" aria-hidden="true"></span>
      </button>
      ${canDelete ? `<button type="button" class="del" data-del="${listKey}:${i}" aria-label="Видалити ${esc(def.addText)} ${i + 1}">Видалити</button>` : ''}
    </header>
    <div class="card-b"${open ? '' : ' hidden'}>${body}</div>
  </article>`;
}

function listHtml(s) {
  const l = s.list, on = visible({ showIf: l.showIf }, data);
  const items = data[l.key].map((_, i) => cardHtml(l.key, i)).join('');
  return `<div class="list" data-list="${l.key}"${on ? '' : ' hidden'}>${items}
    <button type="button" class="btn add" data-add="${l.key}">+ Додати ${esc(l.addText)}</button></div>`;
}

function sectionHtml(s) {
  const fields = s.fields ? `<div class="fields">${s.fields.map(f => fieldHtml(f, f.k, data)).join('')}</div>` : '';
  const note = s.note ? `<p class="note">${esc(s.note)}</p>` : '';
  const hint = s.hint ? `<p class="hint">${esc(s.hint)}</p>` : '';
  const multi = stepOfSection(s.id).sections.length > 1;
  return `<section class="sec" data-section="${s.id}">${multi ? `<h3>${esc(s.title)}</h3>` : ''}${note}${hint}${fields}${s.list ? listHtml(s) : ''}</section>`;
}

// ---------- крок перевірки ----------
const itemPrefix = p => p.item != null ? `${listDef(p.path.split('.')[0]).item} ${p.item + 1} · ` : '';
function checkHtml() {
  const errs = errors(), warns = warnings(), pr = progressOf(normalizeData(data));
  const byStep = STEPS.filter(s => !s.final).map(s => ({ s, e: errs.filter(p => p.step === s.id) })).filter(x => x.e.length);
  const unacked = warns.filter(w => !ack.has(ackKey(w)));
  const canDownload = !errs.length && !unacked.length;
  const pts = (data.points || []).length, pos = data.drops === 'Так' ? (data.positions || []).length : 0;
  const staleDate = reopened && data.date === reopened.date && data.date !== todayISO();
  return `<section class="sec check">
    <div class="sum">
      <div><span>Підрозділ</span><b>${esc(hasText(data.unit) ? data.unit.toUpperCase() : '—')}</b></div>
      <div><span>Дата</span><b>${esc(fmtDate(data.date) || '—')}</b></div>
      <div><span>Точок передачі</span><b>${pts}</b></div>
      <div><span>Позицій для скидів</span><b>${data.drops === 'Так' ? pos : data.drops === 'Ні' ? 'немає' : '—'}</b></div>
      <div><span>Заповнено обов’язкових</span><b>${pr.done} з ${pr.total}</b></div>
    </div>
    ${staleDate ? `<div class="box warn"><h3>Дата актуальності — з попереднього файла</h3>
      <p>Дані підставлено з ${reopened.kind === 'draft' ? 'чернетки' : 'звіту'} від ${esc(fmtDate(reopened.date))}. Якщо ви перевірили й оновили дані сьогодні — поставте сьогоднішню дату.</p>
      <button type="button" class="btn" id="today">Поставити сьогоднішню дату (${esc(fmtDate(todayISO()))})</button></div>` : ''}
    ${errs.length ? `<div class="box bad"><h3>Потрібно виправити: ${errs.length} ${plural(errs.length, 'помилка', 'помилки', 'помилок')}</h3>
      <p>Звіт можна завантажити лише після виправлення всіх помилок. Натисніть на рядок, щоб перейти до поля.</p>
      ${byStep.map(({ s, e }) => `<h4>${esc(s.title)} <span class="badge bad">${e.length}</span></h4><ul>${e.map(p => `<li><button type="button" class="link" data-goto="${esc(p.path)}">${esc(itemPrefix(p))}${esc(p.label)}: <span>${esc(p.msg)}</span></button></li>`).join('')}</ul>`).join('')}
    </div>` : `<div class="box ok"><h3>Помилок немає</h3><p>Усі обов’язкові поля заповнені, формати перевірено.</p></div>`}
    ${warns.length ? `<div class="box warn" id="warnbox"><h3>Перевірте: ${warns.length} ${plural(warns.length, 'зауваження', 'зауваження', 'зауважень')}</h3>
      <p>Це не помилки, але підтвердіть, що дані правильні, або виправте їх.</p>
      <ul>${warns.map(w => `<li><label class="ackl"><input type="checkbox" data-ack="${esc(ackKey(w))}"${ack.has(ackKey(w)) ? ' checked' : ''}> <span>${esc(itemPrefix(w))}${esc(w.label)}: ${esc(w.msg)}</span></label> <button type="button" class="link small" data-goto="${esc(w.path)}">до поля</button></li>`).join('')}</ul>
    </div>` : ''}
    <div class="dl">
      <button type="button" class="btn primary big" id="report"${canDownload ? '' : ' disabled'}>Завантажити звіт PDF</button>
      <p class="hint" id="dlhint"${canDownload ? ' hidden' : ''}>${errs.length ? 'Кнопка стане активною після виправлення помилок.' : 'Підтвердьте всі зауваження вище.'}</p>
      <p class="rule"><b>Готовий PDF передавайте виключно через Element</b> черговому медичної служби. Передача будь-якими іншими месенджерами суворо заборонена.</p>
      <div class="draftrow"><button type="button" class="btn" id="draft">Зберегти чернетку PDF</button>
        <p class="hint">Чернетку можна відкрити в цій формі пізніше й продовжити. Для подання вона не придатна — на ній є позначка «ЧЕРНЕТКА».</p></div>
    </div>
  </section>`;
}

// ---------- каркас ----------
function render({ keepScroll = false } = {}) {
  const y = window.scrollY;
  const st = STEPS[step];
  const errs = errors();
  const pr = progressOf(normalizeData(data));
  const stepsNav = STEPS.map((s, i) => {
    const e = s.final ? 0 : errs.filter(p => p.step === s.id).length;
    const state = i === step ? 'cur' : s.final ? '' : attempted.has(s.id) ? (e ? 'bad' : 'ok') : '';
    return `<button type="button" class="stp ${state}" data-step="${i}" aria-current="${i === step ? 'step' : 'false'}"><i>${s.final ? '✓' : i + 1}</i><span>${esc(s.short)}</span>${e && attempted.has(s.id) ? `<b>${e}</b>` : ''}</button>`;
  }).join('');
  app.innerHTML = `
  <header class="bar">
    <div class="bar-in">
      <div class="brand"><h1>${esc(FORM_NAME)}</h1><p>${esc(hasText(data.unit) ? data.unit.toUpperCase() : 'медична служба')}${hasText(data.date) ? ' · ' + esc(fmtDate(data.date)) : ''}</p></div>
      <div class="bar-act">
        <label class="btn sm" tabindex="0" id="openl">Відкрити PDF<input type="file" id="open" accept=".pdf,application/pdf" hidden></label>
        <button type="button" class="btn sm" id="clear">Очистити</button>
      </div>
    </div>
    <div class="prog" aria-label="Прогрес"><i style="width:${pr.total ? Math.round(100 * pr.done / pr.total) : 0}%"></i></div>
    <nav class="steps" aria-label="Кроки">${stepsNav}</nav>
  </header>
  <main class="main">
    ${step === 0 ? introHtml() : ''}
    <h2 class="h2"><small>Крок ${step + 1} з ${STEPS.length}</small>${esc(st.title)}</h2>
    ${st.id === 'kb' ? `<p class="lead">${esc(CONTACTS_NOTE)}</p>` : ''}
    ${st.final ? checkHtml() : st.sections.map(id => sectionHtml(sectionById(id))).join('')}
  </main>
  <footer class="nav">
    <button type="button" class="btn" id="prev"${step === 0 ? ' disabled' : ''}>← Назад</button>
    <span class="nav-mid">${pr.done} / ${pr.total}</span>
    ${st.final ? '' : `<button type="button" class="btn primary" id="next">${step === STEPS.length - 2 ? 'До перевірки →' : 'Далі →'}</button>`}
  </footer>`;
  $$('textarea', app).forEach(counter);
  refreshErrors();
  // поточний крок — у видимій частині смужки кроків
  const nav = $('.steps', app), cur = $('.stp.cur', app);
  if (nav && cur) nav.scrollLeft = Math.max(0, cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2);
  if (keepScroll) window.scrollTo({ top: y }); else window.scrollTo({ top: 0 });
}

function introHtml() {
  return `<details class="intro"><summary>Як працює анкета</summary>
    <ol>
      <li>Заповніть кроки по черзі. Поля з <span class="req">*</span> обов’язкові. Якщо щось не так — поле підсвітиться й з’явиться підказка.</li>
      <li>На останньому кроці форма покаже все, що треба виправити. Звіт PDF завантажиться лише коли помилок не буде.</li>
      <li>Готовий PDF надішліть черговому медслужби <b>лише через Element</b>. Інші месенджери заборонені.</li>
      <li>Наступного разу не починайте з нуля: натисніть <b>«Відкрити PDF»</b> і завантажте попередній звіт або чернетку — дані підставляться у форму.</li>
      <li>Щоб не втратити введене, зберігайте <b>чернетку PDF</b> на кроці «Перевірка та звіт». Браузер також тримає робочу копію на цьому пристрої до ${DRAFT_TTL_DAYS} ${plural(DRAFT_TTL_DAYS, 'дня', 'днів', 'днів')} (де це дозволено); вона видаляється після завантаження звіту або кнопкою «Очистити».</li>
    </ol></details>`;
}

// ---------- помилки у полях ----------
const canShow = (path, p) => touched.has(path) || attempted.has(p.step);
function showFieldError(path) {
  const list = fieldProblems(path);
  const p = list.find(x => x.level === 'error') || null;
  const showIt = p && canShow(path, p);
  const fld = app.querySelector(`[data-field="${CSS.escape(path)}"]`);
  if (fld) {
    const errEl = fld.querySelector(':scope > .err');
    fld.classList.toggle('bad', !!showIt);
    if (errEl) errEl.textContent = showIt ? p.msg : '';
    fld.querySelectorAll(':scope > input, :scope > textarea, :scope > .withnone > input, :scope > .seg').forEach(el => el.setAttribute('aria-invalid', showIt ? 'true' : 'false'));
  }
  // окремі рядки групи підготовки
  const inp = app.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (inp && inp.closest('.lvl')) {
    const lvl = inp.closest('.lvl'), e = lvl.querySelector('.err');
    lvl.classList.toggle('bad', !!showIt);
    if (e) e.textContent = showIt ? p.msg : '';
    inp.setAttribute('aria-invalid', showIt ? 'true' : 'false');
  }
}
function refreshErrors() {
  $$('[data-field]', app).forEach(el => showFieldError(el.dataset.field));
  $$('.lvl [data-path], .group > input[data-path]', app).forEach(el => showFieldError(el.dataset.path));
  // статуси карток і кроків без повного перерендеру
  $$('.card', app).forEach(c => { const b = c.querySelector('.card-t'); const old = b.querySelector('.badge'); const html = cardStatus(c.dataset.card, +c.dataset.idx); if (old) old.outerHTML = html || ''; else if (html) b.querySelector('.ttl').insertAdjacentHTML('afterend', html); });
  const errs = errors();
  $$('.stp', app).forEach((b, i) => { const s = STEPS[i]; if (s.final || i === step) return; const e = errs.filter(p => p.step === s.id).length; b.className = `stp ${attempted.has(s.id) ? (e ? 'bad' : 'ok') : ''}`; const bb = b.querySelector('b'); if (e && attempted.has(s.id)) { if (bb) bb.textContent = e; else b.insertAdjacentHTML('beforeend', `<b>${e}</b>`); } else if (bb) bb.remove(); });
  const pr = progressOf(normalizeData(data));
  const bar = $('.prog i', app); if (bar) bar.style.width = `${pr.total ? Math.round(100 * pr.done / pr.total) : 0}%`;
  const mid = $('.nav-mid', app); if (mid) mid.textContent = `${pr.done} / ${pr.total}`;
}

// Показ/приховування умовних полів. Значення прихованих полів лишаються в data (на випадок, якщо відповідь повернуть),
// а зі звіту їх прибирає normalizeData.
function refreshVisibility(root) {
  $$('[data-showif]', root).forEach(el => {
    const item = itemOf(el.dataset.field);
    el.hidden = !JSON.parse(el.dataset.showvals).includes(item?.[el.dataset.showif]);
  });
  $$('[data-list]', root).forEach(el => { const l = listDef(el.dataset.list); el.hidden = !visible({ showIf: l.showIf }, data); });
  // обов’язковість залежить від інших полів (напр. алгоритм від drops) — оновлюємо зірочки
  $$('[data-field]', root).forEach(el => {
    const f = fieldDef(el.dataset.field);
    if (!f) return;
    const star = el.querySelector('.lbl .req');
    const req = required(f, itemOf(el.dataset.field), data);
    if (req && !star) el.querySelector('.lbl')?.insertAdjacentHTML('beforeend', '<span class="req" aria-hidden="true">*</span>');
    if (!req && star) star.remove();
  });
  problemsCache = null;
}

function counter(el) {
  const c = app.querySelector(`[data-cnt="${CSS.escape(el.dataset.path)}"]`);
  if (c) c.textContent = el.value.length >= el.maxLength * .7 ? `${el.value.length} / ${el.maxLength}` : '';
}

// ---------- події ----------
app.addEventListener('input', e => {
  const el = e.target;
  if (!el.dataset.path) return;
  setAt(el.dataset.path, el.value);
  if (el.tagName === 'TEXTAREA') counter(el);
  const groupPath = el.closest('.group')?.dataset.field;
  if (touched.has(el.dataset.path) || attempted.has(STEPS[step].id)) { showFieldError(el.dataset.path); if (groupPath) showFieldError(groupPath); }
  if (el.dataset.path === 'unit' || el.dataset.path === 'date') { const b = $('.brand p', app); if (b) b.textContent = `${hasText(data.unit) ? data.unit.toUpperCase() : 'медична служба'}${hasText(data.date) ? ' · ' + fmtDate(data.date) : ''}`; }
  scheduleAutosave();
});
app.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.path) {
    const kind = KINDS[el.dataset.kind];
    if (kind?.norm && hasText(el.value)) { el.value = kind.norm(el.value); setAt(el.dataset.path, el.value); }
    else { const t = el.value.trim(); if (t !== el.value) { el.value = t; setAt(el.dataset.path, t); } }
    touched.add(el.dataset.path);
    const groupPath = el.closest('.group')?.dataset.field;
    if (groupPath) touched.add(groupPath);
    const p = parsePath(el.dataset.path);
    if (p.list && (p.key === 'name' || p.key === 'coords')) updateCardTitle(p.list, p.idx);
    refreshErrors();
    scheduleAutosave();
  }
  if (el.dataset.none != null) {
    const path = el.dataset.none, inp = app.querySelector(`input[data-path="${CSS.escape(path)}"]`);
    el.closest('.none').classList.toggle('on', el.checked);
    if (el.checked) { setAt(path, NONE); inp.value = ''; inp.disabled = true; }
    else { setAt(path, ''); inp.disabled = false; inp.focus(); }
    touched.add(path);
    refreshErrors(); scheduleAutosave();
  }
  if (el.dataset.ack) {
    if (el.checked) ack.add(el.dataset.ack); else ack.delete(el.dataset.ack);
    // без перерендеру — лише стан кнопки звіту
    const can = !errors().length && warnings().every(w => ack.has(ackKey(w)));
    const btn = $('#report', app), hint = $('#dlhint', app);
    if (btn) btn.disabled = !can;
    if (hint) { hint.hidden = can; hint.textContent = errors().length ? 'Кнопка стане активною після виправлення помилок.' : 'Підтвердьте всі зауваження вище.'; }
  }
});
app.addEventListener('focusout', e => {
  const el = e.target;
  if (el.dataset?.path && !touched.has(el.dataset.path)) { touched.add(el.dataset.path); refreshErrors(); }
});
app.addEventListener('click', e => {
  const t = e.target.closest('button, .seg-btn');
  if (!t) return;
  if (t.classList.contains('seg-btn')) {
    if (t.classList.contains('on')) return;              // повторний дотик до обраного — нічого не змінює
    const seg = t.closest('.seg'), path = seg.dataset.path;
    $$('.seg-btn', seg).forEach(b => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); });
    t.classList.add('on'); t.setAttribute('aria-checked', 'true'); setAt(path, t.dataset.val);
    touched.add(path);
    refreshVisibility(t.closest('.card-b') || app);
    if (listDef('positions').showIf[0] === path) refreshVisibility(app);
    refreshErrors(); scheduleAutosave();
    return;
  }
  if (t.dataset.step != null) { goStep(+t.dataset.step); return; }
  if (t.id === 'next') {
    const cur = STEPS[step];
    attempted.add(cur.id);
    const errs = stepErrors(cur.id);
    if (errs.length) toast(`На кроці «${cur.title}» пропущено ${errs.length} ${plural(errs.length, 'помилку', 'помилки', 'помилок')}. Повернутися: «← Назад». Усі помилки буде показано на кроці «Перевірка та звіт».`, 6000);
    goStep(step + 1); return;
  }
  if (t.id === 'prev') { goStep(step - 1); return; }
  if (t.id === 'today') { data.date = todayISO(); dirty = true; problemsCache = null; touched.add('date'); render({ keepScroll: true }); toast(`Дату оновлено: ${fmtDate(data.date)}.`); scheduleAutosave(); return; }
  if (t.dataset.add) {
    const key = t.dataset.add; data[key].push({}); openCard[key] = data[key].length - 1; dirty = true; problemsCache = null;
    render({ keepScroll: true });
    const card = $(`.card[data-card="${key}"][data-idx="${openCard[key]}"]`, app);
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card?.querySelector('input,textarea,button.seg-btn')?.focus({ preventScroll: true });
    scheduleAutosave(); return;
  }
  if (t.dataset.del) {
    const [key, iStr] = t.dataset.del.split(':'), i = +iStr, def = listDef(key);
    if (data[key].length <= 1 && key === 'points') { toast('Має бути хоча б одна точка передачі. Можна очистити поля, але не видалити останню точку.'); return; }
    if (!confirm(`Видалити ${def.addText} ${i + 1}?`)) return;
    data[key].splice(i, 1);
    openCard[key] = Math.max(0, Math.min(openCard[key], data[key].length - 1));
    shiftPaths(key, i);
    dirty = true; problemsCache = null; render({ keepScroll: true }); scheduleAutosave(); return;
  }
  if (t.dataset.toggle) {
    const [key, iStr] = t.dataset.toggle.split(':'), i = +iStr;
    openCard[key] = openCard[key] === i ? -1 : i;
    $$(`.card[data-card="${key}"]`, app).forEach(c => {
      const on = +c.dataset.idx === openCard[key];
      c.classList.toggle('open', on); c.querySelector('.card-b').hidden = !on; c.querySelector('.card-t').setAttribute('aria-expanded', on);
    });
    return;
  }
  if (t.dataset.goto) { gotoPath(t.dataset.goto); return; }
  if (t.id === 'report') { download('report'); return; }
  if (t.id === 'draft') { download('draft'); return; }
  if (t.id === 'clear') { if (confirm('Очистити всі поля й видалити збережену чернетку з цього пристрою?')) { reset(); clearDraft(); toast('Форму очищено.'); } return; }
});
app.addEventListener('keydown', e => { if (e.target.id === 'openl' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('#open').click(); } });
app.addEventListener('change', e => { if (e.target.id === 'open') { openPdf(e.target.files[0]); e.target.value = ''; } });

// після видалення елемента списку зсуваємо індекси у touched/ack
function shiftPaths(key, removed) {
  const fix = set => new Set([...set].flatMap(k => {
    const m = k.match(new RegExp(`^(ack:)?${key}\\.(\\d+)\\.(.*)$`));
    if (!m) return [k];
    const idx = +m[2];
    if (idx === removed) return [];
    return [idx > removed ? `${m[1] || ''}${key}.${idx - 1}.${m[3]}` : k];
  }));
  touched = fix(touched); ack = fix(ack);
}

function updateCardTitle(key, i) {
  const card = $(`.card[data-card="${key}"][data-idx="${i}"] .ttl`, app); if (!card) return;
  const it = data[key][i];
  card.innerHTML = `${esc(hasText(it.name) ? it.name.trim() : '')}${hasText(it.coords) ? `<small>${esc(it.coords)}</small>` : ''}`;
}

function goStep(i) {
  if (i < 0 || i >= STEPS.length) return;
  if (i === STEPS.length - 1) STEPS.forEach(s => { if (!s.final) attempted.add(s.id); });
  step = i; render(); scheduleAutosave();
}
function gotoPath(path) {
  const p = parsePath(path);
  const sectionId = p.list ? (p.list === 'points' ? 'points' : 'drops')
    : SECTIONS.find(s => s.fields?.some(f => f.k === path))?.id || (path === 'points' ? 'points' : path === 'positions' ? 'drops' : null);
  const st = STEPS.findIndex(s => s.sections.includes(sectionId));
  if (p.list) openCard[p.list] = p.idx;
  if (st >= 0) { step = st; render(); }
  requestAnimationFrame(() => {
    const el = app.querySelector(`[data-path="${CSS.escape(path)}"]`) || app.querySelector(`[data-field="${CSS.escape(path)}"]`) || app.querySelector(`[data-list="${CSS.escape(path)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const box = el.closest('.fld') || el;
    const focusable = el.matches('input:not([disabled]),textarea') ? el : box.querySelector('input:not([disabled]):not([type=checkbox]),textarea,.seg-btn') || box.querySelector('input[type=checkbox]');
    focusable?.focus({ preventScroll: true });
    box.classList.add('flash'); setTimeout(() => box.classList.remove('flash'), 1600);
  });
}

// ---------- робоча копія на пристрої ----------
let saveTimer = null;
function scheduleAutosave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 600); }
function saveDraft() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ saved: new Date().toISOString(), step, attempted: [...attempted], data })); draftOk = true; }
  catch { if (draftOk) { draftOk = false; toast('Браузер не дозволяє зберігати робочу копію на цьому пристрої. Зберігайте чернетку PDF, щоб не втратити введене.', 7000); } }
}
function clearDraft() { clearTimeout(saveTimer); try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY); if (!raw) return null;
    const d = JSON.parse(raw);
    const age = Date.now() - Date.parse(d?.saved);
    if (!d || typeof d !== 'object' || !d.data || !Number.isFinite(age) || age > DRAFT_TTL_DAYS * 86400000) { clearDraft(); return null; }
    return { saved: d.saved, step: d.step | 0, attempted: Array.isArray(d.attempted) ? d.attempted.filter(x => typeof x === 'string') : [], data: normalizeData(d.data) };
  } catch { clearDraft(); return null; }
}
addEventListener('pagehide', () => { if (dirty) saveDraft(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) saveDraft(); });

function reset(d) {
  data = d ? { ...emptyData(), ...d } : emptyData();
  if (!Array.isArray(data.points) || !data.points.length) data.points = [{}];
  if (!Array.isArray(data.positions)) data.positions = [];
  if (!hasText(data.date) && !d) data.date = todayISO();
  step = 0; dirty = false; problemsCache = null; attempted = new Set(); touched = new Set(); ack = new Set(); openCard = { points: 0, positions: 0 }; reopened = null;
  render();
}

// ---------- PDF ----------
async function download(kind) {
  const errs = errors(), unacked = warnings().filter(w => !ack.has(ackKey(w)));
  if (kind === 'report' && (errs.length || unacked.length)) { toast('Спочатку виправте помилки й підтвердьте зауваження.'); return; }
  const btn = $(`#${kind}`, app), text = btn.textContent;
  btn.disabled = true; btn.textContent = 'Створюю…';
  try {
    await loadFonts();
    const d = normalizeData(data), created = new Date().toISOString();
    const dd = buildReport(d, { kind, created, version: BUILD_VERSION });
    const blob = await pdfMake.createPdf(dd).getBlob();
    const name = safeFileName([kind === 'draft' ? 'Chernetka' : 'Zvit_med', d.unit?.toUpperCase(), d.date].filter(hasText).join('_')) + '.pdf';
    saveBlob(blob, name);
    dirty = false;
    if (kind === 'report') clearDraft();     // звіт сформовано — робоча копія на пристрої більше не потрібна
    toast(kind === 'draft' ? `Чернетку збережено: ${name}` : `Звіт збережено: ${name}. Надішліть його черговому медслужби через Element.`, 7000);
  } catch (e) { console.error(e); alert('Не вдалося створити PDF: ' + (e && e.message || e)); }
  finally { btn.textContent = text; render({ keepScroll: true }); }
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

async function openPdf(file) {
  if (!file) return;
  if (file.size > MAX_PDF_BYTES) { alert('Файл завеликий.'); return; }
  if ((dirty || hasAnyData()) && !confirm('Дані у формі буде замінено даними з файла. Продовжити?')) return;
  try {
    const p = await readPdfBytes(new Uint8Array(await file.arrayBuffer()));
    reset(p.data);
    reopened = { date: p.data.date, kind: p.kind };
    const errs = errors();
    const what = p.kind === 'draft' ? 'Чернетку' : 'Звіт';
    let msg = `${what} ${hasText(p.data.unit) ? `«${p.data.unit}» ` : ''}від ${fmtDate(p.data.date) || '—'} завантажено.`;
    if (p.legacy || p.data.migratedFrom) msg += ' Це файл старої версії форми: з’явилися нові поля (НРК, гіпотермія, хімзахист) — їх треба заповнити.';
    if (errs.length) msg += ` Залишилося виправити: ${errs.length} ${plural(errs.length, 'помилку', 'помилки', 'помилок')}.`;
    delete data.migratedFrom;
    goStep(STEPS.length - 1);
    toast(msg, 9000);
  } catch (e) { alert(e && e.message || 'Не вдалося прочитати файл.'); }
}
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); openPdf(e.dataTransfer.files[0]); });
addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------- сповіщення ----------
let toastTimer = null;
function toast(msg, ms = 5000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- старт ----------
(function start() {
  const draft = loadDraft();
  if (draft) {
    reset(draft.data);
    attempted = new Set(draft.attempted);
    goStep(Math.min(Math.max(0, draft.step), STEPS.length - 1));
    toast(`Відновлено робочу копію з цього пристрою (${new Date(draft.saved).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}). Щоб почати з нуля — натисніть «Очистити».`, 8000);
  } else reset();
})();
