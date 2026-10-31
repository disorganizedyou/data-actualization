// Анкета для підрозділів: покрокова форма з живою перевіркою, чернетками й звітом PDF.

import { STEPS, SECTIONS, ROLES, CONTACT, NONE, TITLE, FORM_NAME, CONTACTS_NOTE, LEVELS, SCHEMA_VERSION,
  sectionById, listDef, visible, required, emptyData, groupKeys, stepOfSection } from './schema.mjs';
import { hasText, esc, fmtDate, todayISO, safeFileName, plural } from './text.mjs';
import { KINDS, kindOf, maxLen, validateData, normalizeData, errorsOf, warningsOf, progressOf } from './validate.mjs';
import { readPdfBytes } from './codec.mjs';
import { buildReport } from './report.mjs';
import { loadFonts } from './pdfkit.mjs';
import { iconSvg } from './icons.mjs';

const DRAFT_KEY = 'med-anketa-draft-v2';
const DRAFT_TTL_DAYS = 7;
const WARN_ACK_PREFIX = 'ack:';

// ---------- стан ----------
let data = emptyData();
let step = 0;
let dirty = false;
const attempted = new Set();   // кроки, на яких натиснули «Далі» — там показуємо всі помилки
const touched = new Set();     // поля, яких торкалися — там показуємо помилку одразу
let ack = new Set();           // підтверджені попередження (ключ = path + msg)
let openCard = { points: 0, positions: 0 };
let problemsCache = null;

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

// ---------- перевірка ----------
const problems = () => problemsCache || (problemsCache = validateData(normalizeData(data)));
const errors = () => errorsOf(problems());
const warnings = () => warningsOf(problems());
const ackKey = w => WARN_ACK_PREFIX + w.path + '|' + w.msg;
const stepErrors = id => errors().filter(p => p.step === id);
const fieldProblems = path => problems().filter(p => p.path === path);

// ---------- рендер полів ----------
function fieldHtml(f, path, item) {
  const id = 'f_' + path.replace(/\W/g, '_');
  const hidden = !visible(f, item) ? ' hidden' : '';   // атрибут hidden, не клас
  const show = f.showIf ? ` data-showif="${esc(f.showIf[0])}" data-showvals="${esc(JSON.stringify(f.showIf[1]))}"` : '';
  const req = required(f, item, data);
  const star = req ? '<span class="req" aria-hidden="true">*</span>' : '';
  const label = `<label class="lbl" for="${id}">${esc(f.l)}${star}</label>`;
  const hint = f.hint ? `<p class="hint">${esc(f.hint)}</p>` : '';
  const err = `<p class="err" id="${id}_err" role="alert"></p>`;
  const v = item?.[f.k] ?? '';
  const kind = kindOf(f);
  const ph = f.ph || kind?.ph || '';
  const im = kind?.inputmode ? ` inputmode="${kind.inputmode}"` : '';

  if (f.t === 'group') {
    const rows = f.items.map(([k, l]) => {
      const pk = `${path}_${k}`, iid = 'f_' + pk.replace(/\W/g, '_');
      return `<div class="lvl"><label for="${iid}">${esc(l)}</label>
        <div class="lvl-in"><input id="${iid}" type="text" inputmode="numeric" maxlength="3" data-path="${esc(pk)}" data-kind="count" value="${esc(item?.[`${f.k}_${k}`] ?? '')}" placeholder="0" autocomplete="off"><span>ос.</span></div>
        <p class="err" id="${iid}_err"></p></div>`;
    }).join('');
    const ok = `${path}_other`, oid = 'f_' + ok.replace(/\W/g, '_');
    return `<fieldset class="fld group" data-field="${esc(path)}"><legend class="lbl">${esc(f.l)}${star}</legend>
      <p class="hint">${esc(f.tip || '')}</p>
      <div class="levels">${rows}</div>
      <label class="lbl" for="${oid}">Інше або уточнення</label>
      <input id="${oid}" type="text" maxlength="200" data-path="${esc(ok)}" value="${esc(item?.[`${f.k}_other`] ?? '')}" placeholder="наприклад: 1 водій пройшов курс зупинки кровотечі" autocomplete="off">
      ${err}</fieldset>`;
  }
  if (f.t === 'seg') {
    const opts = f.o.map(o => `<button type="button" role="radio" aria-checked="${v === o}" class="seg-btn${v === o ? ' on' : ''}" data-val="${esc(o)}">${esc(o)}</button>`).join('');
    return `<div class="fld" data-field="${esc(path)}"${show}${hidden}><span class="lbl" id="${id}_l">${esc(f.l)}${star}</span>${hint}
      <div class="seg" role="radiogroup" aria-labelledby="${id}_l" data-path="${esc(path)}" id="${id}">${opts}</div>${err}</div>`;
  }
  if (f.none) {
    const none = v === NONE;
    return `<div class="fld" data-field="${esc(path)}"${hidden}>
      <span class="lbl" id="${id}_l">${f.icon ? `<i class="ico">${iconSvg(f.icon)}</i>` : ''}${esc(f.l)}${star}</span>
      <div class="withnone">
        <input id="${id}" type="text" aria-labelledby="${id}_l" data-path="${esc(path)}" data-kind="${esc(f.v || '')}" maxlength="${maxLen(f)}" placeholder="${esc(ph)}" value="${none ? '' : esc(v)}"${none ? ' disabled' : ''}${im} autocomplete="off" autocapitalize="off" spellcheck="false">
        <label class="none${none ? ' on' : ''}"><input type="checkbox" data-none="${esc(path)}"${none ? ' checked' : ''}> ${NONE}</label>
      </div>${err}</div>`;
  }
  let ctl;
  if (f.t === 'area') ctl = `<textarea id="${id}" data-path="${esc(path)}" rows="2" maxlength="${maxLen(f)}" placeholder="${esc(ph)}">${esc(v)}</textarea><span class="cnt" data-cnt="${esc(path)}"></span>`;
  else if (f.t === 'date') ctl = `<input id="${id}" type="date" data-path="${esc(path)}" value="${esc(v)}" max="${todayISO()}">`;
  else ctl = `<input id="${id}" type="text" data-path="${esc(path)}" data-kind="${esc(f.v || '')}" maxlength="${maxLen(f)}" placeholder="${esc(ph)}" value="${esc(v)}"${im} autocomplete="off"${f.v === 'unit' ? ' autocapitalize="characters"' : ''}>`;
  return `<div class="fld" data-field="${esc(path)}"${show}${hidden}>${label}${hint}${ctl}${err}</div>`;
}

const cardStatus = (listKey, i) => {
  const e = errors().filter(p => p.path.startsWith(`${listKey}.${i}.`)).length;
  return e ? `<span class="badge bad">${e} ${plural(e, 'помилка', 'помилки', 'помилок')}</span>` : attempted.has(stepOfSection(listKey === 'points' ? 'points' : 'drops').id) || Object.keys(data[listKey][i]).length > 2 ? '<span class="badge ok">✓ заповнено</span>' : '';
};

function cardHtml(listKey, i) {
  const def = listDef(listKey), item = data[listKey][i], open = openCard[listKey] === i;
  const title = hasText(item.name) ? item.name.trim() : '';
  const sub = hasText(item.coords) ? item.coords : '';
  const body = def.groups
    ? def.groups.map(g => `<div class="grp"><h4>${esc(g.title)}</h4>${g.fields.map(f => fieldHtml(f, `${listKey}.${i}.${f.k}`, item)).join('')}</div>`).join('')
    : def.fields.map(f => fieldHtml(f, `${listKey}.${i}.${f.k}`, item)).join('');
  return `<article class="card${open ? ' open' : ''}" data-card="${listKey}" data-idx="${i}">
    <header class="card-h">
      <button type="button" class="card-t" data-toggle="${listKey}:${i}" aria-expanded="${open}">
        <span class="num">${esc(def.item)} ${i + 1}</span>
        <span class="ttl">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
        ${cardStatus(listKey, i)}
        <span class="chev" aria-hidden="true"></span>
      </button>
      ${listKey === 'points' && data[listKey].length <= 1 ? '' : `<button type="button" class="del" data-del="${listKey}:${i}" aria-label="Видалити ${esc(def.item.toLowerCase())} ${i + 1}">Видалити</button>`}
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
  return `<section class="sec" data-section="${s.id}">${STEPS.find(st => st.sections.length > 1) && stepOfSection(s.id).sections.length > 1 ? `<h3>${esc(s.title)}</h3>` : ''}${note}${hint}${fields}${s.list ? listHtml(s) : ''}</section>`;
}

// ---------- крок перевірки ----------
function checkHtml() {
  const errs = errors(), warns = warnings(), pr = progressOf(normalizeData(data));
  const byStep = STEPS.filter(s => !s.final).map(s => ({ s, e: errs.filter(p => p.step === s.id) })).filter(x => x.e.length);
  const unacked = warns.filter(w => !ack.has(ackKey(w)));
  const canDownload = !errs.length && !unacked.length;
  const pts = (data.points || []).length, pos = data.drops === 'Так' ? (data.positions || []).length : 0;
  return `<section class="sec check">
    <div class="sum">
      <div><span>Підрозділ</span><b>${esc(hasText(data.unit) ? data.unit.toUpperCase() : '—')}</b></div>
      <div><span>Дата</span><b>${esc(fmtDate(data.date) || '—')}</b></div>
      <div><span>Точок передачі</span><b>${pts}</b></div>
      <div><span>Позицій для скидів</span><b>${data.drops === 'Так' ? pos : data.drops === 'Ні' ? 'немає' : '—'}</b></div>
      <div><span>Заповнено обов’язкових</span><b>${pr.done} з ${pr.total}</b></div>
    </div>
    ${errs.length ? `<div class="box bad"><h3>Потрібно виправити: ${errs.length} ${plural(errs.length, 'помилка', 'помилки', 'помилок')}</h3>
      <p>Звіт можна завантажити лише після виправлення всіх помилок. Натисніть на рядок, щоб перейти до поля.</p>
      ${byStep.map(({ s, e }) => `<h4>${esc(s.title)} <span class="badge bad">${e.length}</span></h4><ul>${e.map(p => `<li><button type="button" class="link" data-goto="${esc(p.path)}">${esc(p.item != null ? `${listDef(p.path.split('.')[0]).item} ${p.item + 1} · ` : '')}${esc(p.label)}: <span>${esc(p.msg)}</span></button></li>`).join('')}</ul>`).join('')}
    </div>` : `<div class="box ok"><h3>Помилок немає</h3><p>Усі обов’язкові поля заповнені, формати перевірено.</p></div>`}
    ${warns.length ? `<div class="box warn"><h3>Перевірте: ${warns.length} ${plural(warns.length, 'зауваження', 'зауваження', 'зауважень')}</h3>
      <p>Це не помилки, але підтвердіть, що дані правильні, або виправте їх.</p>
      <ul>${warns.map(w => `<li><label class="ackl"><input type="checkbox" data-ack="${esc(ackKey(w))}"${ack.has(ackKey(w)) ? ' checked' : ''}> <span>${esc(w.item != null ? `${listDef(w.path.split('.')[0]).item} ${w.item + 1} · ` : '')}${esc(w.label)}: ${esc(w.msg)}</span></label> <button type="button" class="link small" data-goto="${esc(w.path)}">до поля</button></li>`).join('')}</ul>
    </div>` : ''}
    <div class="dl">
      <button type="button" class="btn primary big" id="report"${canDownload ? '' : ' disabled'}>Завантажити звіт PDF</button>
      ${canDownload ? '' : `<p class="hint">${errs.length ? 'Кнопка стане активною після виправлення помилок.' : 'Підтвердьте всі зауваження вище.'}</p>`}
      <p class="rule"><b>Готовий PDF передавайте виключно через Element</b> черговому медичної служби. Передача будь-якими іншими месенджерами суворо заборонена.</p>
      <div class="draftrow"><button type="button" class="btn" id="draft">Зберегти чернетку PDF</button>
        <p class="hint">Чернетку можна відкрити в цій формі пізніше й продовжити. Для подання вона не придатна — на ній є позначка «ЧЕРНЕТКА».</p></div>
    </div>
  </section>`;
}

// ---------- каркас ----------
function render() {
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
  window.scrollTo({ top: 0 });
}

function introHtml() {
  return `<details class="intro"><summary>Як працює анкета</summary>
    <ol>
      <li>Заповніть кроки по черзі. Поля з <span class="req">*</span> обов’язкові. Якщо щось не так — поле підсвітиться й з’явиться підказка.</li>
      <li>На останньому кроці форма покаже все, що треба виправити. Звіт PDF завантажиться лише коли помилок не буде.</li>
      <li>Готовий PDF надішліть черговому медслужби <b>лише через Element</b>. Інші месенджери заборонені.</li>
      <li>Наступного разу не починайте з нуля: натисніть <b>«Відкрити PDF»</b> і завантажте попередній звіт або чернетку — дані підставляться у форму.</li>
      <li>Чернетка зберігається на цьому пристрої автоматично (${DRAFT_TTL_DAYS} днів). Кнопка «Очистити» видаляє її.</li>
    </ol></details>`;
}

// ---------- помилки у полях ----------
function showFieldError(path) {
  const fld = app.querySelector(`[data-field="${CSS.escape(path)}"]`);
  const list = fieldProblems(path);
  const p = list.find(x => x.level === 'error') || null;
  const showIt = p && (touched.has(path) || attempted.has(p.step));
  // для групи підготовки помилка може стояти на першому рівні
  if (fld) {
    const errEl = fld.querySelector(':scope > .err') || fld.querySelector('.err');
    fld.classList.toggle('bad', !!showIt);
    if (errEl) errEl.textContent = showIt ? p.msg : '';
  }
  // окремі рядки групи
  const inp = app.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (inp && inp.closest('.lvl')) {
    const lvl = inp.closest('.lvl'), e = lvl.querySelector('.err');
    const own = list.find(x => x.level === 'error' && !/хоча б/.test(x.msg));
    lvl.classList.toggle('bad', !!(own && (touched.has(path) || attempted.has(own.step))));
    if (e) e.textContent = own && (touched.has(path) || attempted.has(own.step)) ? own.msg : '';
  }
}
function refreshErrors() {
  $$('[data-field]', app).forEach(el => showFieldError(el.dataset.field));
  $$('.lvl [data-path]', app).forEach(el => showFieldError(el.dataset.path));
  // статуси карток і кроків без повного перерендеру
  $$('.card', app).forEach(c => { const b = c.querySelector('.card-t'); const old = b.querySelector('.badge'); const html = cardStatus(c.dataset.card, +c.dataset.idx); if (old) old.outerHTML = html || ''; else if (html) b.querySelector('.ttl').insertAdjacentHTML('afterend', html); });
  const errs = errors();
  $$('.stp', app).forEach((b, i) => { const s = STEPS[i]; if (s.final || i === step) return; const e = errs.filter(p => p.step === s.id).length; b.className = `stp ${attempted.has(s.id) ? (e ? 'bad' : 'ok') : ''}`; const bb = b.querySelector('b'); if (e && attempted.has(s.id)) { if (bb) bb.textContent = e; else b.insertAdjacentHTML('beforeend', `<b>${e}</b>`); } else if (bb) bb.remove(); });
  const pr = progressOf(normalizeData(data));
  const bar = $('.prog i', app); if (bar) bar.style.width = `${pr.total ? Math.round(100 * pr.done / pr.total) : 0}%`;
  const mid = $('.nav-mid', app); if (mid) mid.textContent = `${pr.done} / ${pr.total}`;
}

function refreshVisibility(root) {
  $$('[data-showif]', root).forEach(el => {
    const path = el.dataset.field, p = parsePath(path);
    const item = p.list ? data[p.list][p.idx] : data;
    const vals = JSON.parse(el.dataset.showvals);
    const on = vals.includes(item?.[el.dataset.showif]);
    el.hidden = !on;
    if (!on) {
      // очищаємо значення прихованого поля, щоб не потрапило у звіт
      const inner = el.querySelector('[data-path]');
      if (inner && getAt(inner.dataset.path) !== '') { setAt(inner.dataset.path, ''); if (inner.tagName !== 'DIV') inner.value = ''; else $$('.seg-btn', inner).forEach(b => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); }); }
    }
  });
  $$('[data-list]', root).forEach(el => { const l = listDef(el.dataset.list); el.hidden = !visible({ showIf: l.showIf }, data); });
  // обов’язковість залежить від інших полів (напр. алгоритм від drops) — оновлюємо зірочки
  $$('[data-field]', root).forEach(el => {
    const path = el.dataset.field, p = parsePath(path);
    const s = SECTIONS.find(x => x.fields?.some(f => f.k === path)) ;
    const f = s ? s.fields.find(f => f.k === path) : p.list ? listDef(p.list).fields.find(f => f.k === p.key) : null;
    if (!f) return;
    const star = el.querySelector('.lbl .req');
    const req = required(f, itemOf(path), data);
    if (req && !star) el.querySelector('.lbl')?.insertAdjacentHTML('beforeend', '<span class="req" aria-hidden="true">*</span>');
    if (!req && star) star.remove();
  });
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
  if (touched.has(el.dataset.path) || attempted.has(STEPS[step].id)) { showFieldError(el.dataset.path); }
  if (el.dataset.path === 'unit' || el.dataset.path === 'date') { const b = $('.brand p', app); if (b) b.textContent = `${hasText(data.unit) ? data.unit.toUpperCase() : 'медична служба'}${hasText(data.date) ? ' · ' + fmtDate(data.date) : ''}`; }
  scheduleAutosave();
});
app.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.path) {
    const kind = KINDS[el.dataset.kind];
    if (kind?.norm && hasText(el.value)) { el.value = kind.norm(el.value); setAt(el.dataset.path, el.value); }
    else if (el.tagName !== 'SELECT') { const t = el.value.trim(); if (t !== el.value) { el.value = t; setAt(el.dataset.path, t); } }
    touched.add(el.dataset.path);
    showFieldError(el.dataset.path);
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
    showFieldError(path); refreshErrors(); scheduleAutosave();
  }
  if (el.dataset.ack) {
    if (el.checked) ack.add(el.dataset.ack); else ack.delete(el.dataset.ack);
    render();
  }
});
app.addEventListener('focusout', e => {
  const el = e.target;
  if (el.dataset?.path && !touched.has(el.dataset.path)) { touched.add(el.dataset.path); showFieldError(el.dataset.path); refreshErrors(); }
});
app.addEventListener('click', e => {
  const t = e.target.closest('button, .seg-btn');
  if (!t) return;
  if (t.classList.contains('seg-btn')) {
    const seg = t.closest('.seg'), path = seg.dataset.path;
    const was = t.classList.contains('on');
    $$('.seg-btn', seg).forEach(b => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); });
    if (!was) { t.classList.add('on'); t.setAttribute('aria-checked', 'true'); setAt(path, t.dataset.val); } else setAt(path, '');
    touched.add(path);
    refreshVisibility(t.closest('.card-b') || app);
    if (listDef('positions').showIf[0] === path) refreshVisibility(app);
    showFieldError(path); refreshErrors(); scheduleAutosave();
    return;
  }
  if (t.dataset.step != null) { goStep(+t.dataset.step); return; }
  if (t.id === 'next') { attempted.add(STEPS[step].id); const errs = stepErrors(STEPS[step].id); if (errs.length) { refreshErrors(); toast(`На цьому кроці ${errs.length} ${plural(errs.length, 'помилка', 'помилки', 'помилок')} — їх можна виправити зараз або пізніше, на кроці «Перевірка».`); } goStep(step + 1); return; }
  if (t.id === 'prev') { goStep(step - 1); return; }
  if (t.dataset.add) { const key = t.dataset.add; data[key].push({}); openCard[key] = data[key].length - 1; dirty = true; problemsCache = null; render(); const card = $(`.card[data-idx="${openCard[key]}"]`, app); card?.scrollIntoView({ behavior: 'smooth', block: 'start' }); card?.querySelector('input,textarea,button.seg-btn')?.focus({ preventScroll: true }); scheduleAutosave(); return; }
  if (t.dataset.del) {
    const [key, i] = t.dataset.del.split(':'); const def = listDef(key);
    if (data[key].length <= 1 && key === 'points') { toast('Має бути хоча б одна точка передачі. Можна очистити поля, але не видалити останню точку.'); return; }
    if (!confirm(`Видалити ${def.item.toLowerCase()} ${+i + 1}?`)) return;
    data[key].splice(+i, 1); openCard[key] = Math.max(0, Math.min(openCard[key], data[key].length - 1));
    // переносимо touched/ack не варто — просто скидаємо кеш
    dirty = true; problemsCache = null; render(); scheduleAutosave(); return;
  }
  if (t.dataset.toggle) { const [key, i] = t.dataset.toggle.split(':'); openCard[key] = openCard[key] === +i ? -1 : +i; render(); return; }
  if (t.dataset.goto) { gotoPath(t.dataset.goto); return; }
  if (t.id === 'report') { download('report'); return; }
  if (t.id === 'draft') { download('draft'); return; }
  if (t.id === 'clear') { if (confirm('Очистити всі поля й видалити збережену чернетку з цього пристрою?')) { reset(); clearDraft(); toast('Форму очищено.'); } return; }
});
$('#app').addEventListener('keydown', e => { if (e.target.id === 'openl' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('#open').click(); } });
app.addEventListener('change', e => { if (e.target.id === 'open') { openPdf(e.target.files[0]); e.target.value = ''; } });

function updateCardTitle(key, i) {
  const card = $(`.card[data-card="${key}"][data-idx="${i}"] .ttl`, app); if (!card) return;
  const it = data[key][i];
  card.innerHTML = `${esc(hasText(it.name) ? it.name.trim() : '')}${hasText(it.coords) ? `<small>${esc(it.coords)}</small>` : ''}`;
}

function goStep(i) {
  if (i < 0 || i >= STEPS.length) return;
  if (i === STEPS.length - 1) STEPS.forEach(s => { if (!s.final) attempted.add(s.id); });
  step = i; render();
}
function gotoPath(path) {
  const p = parsePath(path);
  const sectionId = p.list ? (p.list === 'points' ? 'points' : 'drops') : SECTIONS.find(s => s.fields?.some(f => f.k === path || (f.t === 'group' && path.startsWith(f.k))))?.id || (path === 'points' ? 'points' : path === 'positions' ? 'drops' : null);
  const st = STEPS.findIndex(s => s.sections.includes(sectionId));
  if (p.list) openCard[p.list] = p.idx;
  if (st >= 0) { step = st; render(); }
  requestAnimationFrame(() => {
    const el = app.querySelector(`[data-path="${CSS.escape(path)}"]`) || app.querySelector(`[data-field="${CSS.escape(path)}"]`) || app.querySelector(`[data-list="${CSS.escape(path)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = el.matches('input,textarea') ? el : el.querySelector('input:not([disabled]),textarea,.seg-btn');
    focusable?.focus({ preventScroll: true });
    (el.closest('.fld') || el).classList.add('flash'); setTimeout(() => (el.closest('.fld') || el).classList.remove('flash'), 1600);
  });
}

// ---------- чернетка на пристрої ----------
let saveTimer = null;
function scheduleAutosave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 600); }
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ saved: new Date().toISOString(), step, data })); } catch { /* приватний режим або content:// — без автозбереження */ }
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY); if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || !d.data) { clearDraft(); return null; }
    if (Date.now() - Date.parse(d.saved) > DRAFT_TTL_DAYS * 86400000) { clearDraft(); return null; }
    return d;
  } catch { return null; }
}

function reset(d) {
  data = d ? { ...emptyData(), ...d } : emptyData();
  if (!Array.isArray(data.points) || !data.points.length) data.points = [{}];
  if (!Array.isArray(data.positions)) data.positions = [];
  if (!hasText(data.date) && !d) data.date = todayISO();
  step = 0; dirty = false; problemsCache = null; attempted.clear(); touched.clear(); ack = new Set(); openCard = { points: 0, positions: 0 };
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
    toast(kind === 'draft' ? `Чернетку збережено: ${name}` : `Звіт збережено: ${name}. Надішліть його черговому медслужби через Element.`);
  } catch (e) { console.error(e); alert('Не вдалося створити PDF: ' + (e && e.message || e)); }
  finally { btn.disabled = kind === 'report' ? false : false; btn.textContent = text; render(); }
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

async function openPdf(file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) { alert('Файл завеликий.'); return; }
  if (dirty && !confirm('Поточні незбережені дані буде замінено даними з файлу. Продовжити?')) return;
  try {
    const p = await readPdfBytes(new Uint8Array(await file.arrayBuffer()));
    reset(p.data);
    STEPS.forEach(s => { if (!s.final) attempted.add(s.id); });
    const errs = errors();
    const what = p.kind === 'draft' ? 'Чернетку' : 'Звіт';
    let msg = `${what} ${hasText(p.data.unit) ? `«${p.data.unit}» ` : ''}від ${fmtDate(p.data.date) || '—'} завантажено.`;
    if (p.legacy || p.data.migratedFrom) msg += ' Це файл старої версії форми: з’явилися нові поля (НРК, гіпотермія, хімзахист) — їх треба заповнити.';
    if (errs.length) msg += ` Залишилося виправити: ${errs.length} ${plural(errs.length, 'помилка', 'помилки', 'помилок')}.`;
    msg += ' Не забудьте оновити дату актуальності.';
    delete data.migratedFrom;
    step = STEPS.length - 1; render();
    toast(msg, 9000);
    scheduleAutosave();
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
    step = Math.min(Math.max(0, draft.step | 0), STEPS.length - 1); render();
    toast(`Відновлено чернетку з цього пристрою (${new Date(draft.saved).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}). Щоб почати з нуля — натисніть «Очистити».`, 8000);
  } else reset();
})();
