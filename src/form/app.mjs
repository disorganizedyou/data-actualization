// Анкета для підрозділів: покрокова форма з живою перевіркою, чернетками й звітом PDF.

import { STEPS, SECTIONS, NONE, FORM_NAME, CONTACTS_NOTE, SCHEMA_VERSION, LIST_KEYS, sectionById, listDef, listSection, visible, required, emptyData, stepOfSection } from './schema.mjs';
import { hasText, esc, fmtDate, todayISO, safeFileName, plural } from './text.mjs';
import { KINDS, kindOf, maxLen, validateData, normalizeData, errorsOf, warningsOf, missingOf, invalidOf, progressOf, OTHER_MAX } from './validate.mjs';
import { readPdfBytes, migrate } from './codec.mjs';
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
const firstCards = () => Object.fromEntries(LIST_KEYS.map(k => [k, 0]));
let openCard = firstCards();
let problemsCache = null;
let reopened = null;           // { date, kind } — з якого файла підставлено дані (нагадування оновити дату)
let draftOk = true;            // чи працює сховище браузера
let nextArmed = null;          // id кроку, на якому «Далі» вже натиснули попри пропуски (друге натискання переходить)
let notices = [];              // повідомлення вгорі сторінки, що не зникають самі: { id, kind: 'info'|'warn'|'ok', text }

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');
const finePointer = () => { try { return matchMedia('(pointer: fine)').matches; } catch { return false; } };

// ---------- доступ до даних за шляхом ----------
const parsePath = path => {
  const m = path.match(new RegExp(`^(${LIST_KEYS.join('|')})\\.(\\d+)\\.(.+)$`));
  return m ? { list: m[1], idx: +m[2], key: m[3] } : { key: path };
};
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
const hasAnyData = () => Object.keys(data).some(k => !['v', 'date', ...LIST_KEYS].includes(k)) || LIST_KEYS.some(k => (data[k] || []).some(it => Object.keys(it).length));
const canDownload = () => !errors().length && warnings().every(w => ack.has(ackKey(w)));
const dlHintText = () => errors().length ? 'Кнопка стане активною, коли всі поля буде заповнено й помилки виправлено.' : 'Підтвердьте всі зауваження вище.';

// ---------- рендер полів ----------
const idOf = path => 'f_' + path.replace(/\W/g, '_');
// Однорядкові поля не обрізаємо мовчки: дозволяємо ввести більше, а задовгий текст показуємо як помилку
const inputMax = f => Math.max(maxLen(f) * 4, 60);
function fieldHtml(f, path, item) {
  const id = idOf(path);
  const hidden = !visible(f, item) ? ' hidden' : '';   // атрибут hidden, не клас
  const show = f.showIf ? ' data-cond' : '';
  const req = required(f, item, data);
  const star = req ? '<span class="req" aria-hidden="true">*</span>' : '';
  const label = `<label class="lbl" for="${id}">${esc(f.l)}${star}</label>`;
  const hint = f.hint ? `<p class="hint">${esc(f.hint)}</p>` : '';
  const err = `<p class="err" id="${id}_err"></p>`;
  const v = item?.[f.k] ?? '';
  const kind = kindOf(f);
  const ph = f.ph || kind?.ph || '';
  const im = kind?.inputmode ? ` inputmode="${kind.inputmode}"` : '';
  const caps = kind?.autocapitalize || null;
  const textAttrs = ` autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="next" aria-describedby="${id}_err"${caps ? ` autocapitalize="${caps}"` : ''}`;

  if (f.t === 'group') {
    const rows = f.items.map(([k, l]) => {
      const pk = `${path}_${k}`, iid = idOf(pk);
      return `<div class="lvl"><label for="${iid}">${esc(l)}</label>
        <div class="lvl-in"><input id="${iid}" type="text" inputmode="numeric" maxlength="${inputMax({ v: 'count' })}" data-path="${esc(pk)}" data-kind="count" value="${esc(item?.[`${f.k}_${k}`] ?? '')}" placeholder="0" autocomplete="off" enterkeyhint="next" aria-describedby="${iid}_err"><span>ос.</span></div>
        <p class="err" id="${iid}_err"></p></div>`;
    }).join('');
    const ok = `${path}_other`, oid = idOf(ok);
    return `<fieldset class="fld group" data-field="${esc(path)}"><legend class="lbl">${esc(f.l)}${star}</legend>
      <p class="hint">${esc(f.tip || '')}</p>
      <div class="levels">${rows}</div>
      <label class="lbl" for="${oid}">Інше або уточнення</label>
      <input id="${oid}" type="text" maxlength="${inputMax({ max: OTHER_MAX })}" data-path="${esc(ok)}" value="${esc(item?.[`${f.k}_other`] ?? '')}" placeholder="наприклад: 1 водій пройшов курс зупинки кровотечі" autocomplete="off" enterkeyhint="next" aria-describedby="${id}_err">
      ${err}</fieldset>`;
  }
  if (f.t === 'seg') {
    // радіогрупа: одна зупинка Tab на питання (обраний варіант, або перший), вибір стрілками
    const cur = f.o.includes(v) ? v : f.o[0];
    const opts = f.o.map(o => `<button type="button" role="radio" aria-checked="${v === o}" tabindex="${o === cur ? 0 : -1}" class="seg-btn${v === o ? ' on' : ''}" data-val="${esc(o)}">${esc(o)}</button>`).join('');
    return `<div class="fld" data-field="${esc(path)}"${show}${hidden}><span class="lbl" id="${id}_l">${esc(f.l)}${star}</span>${hint}
      <div class="seg" role="radiogroup" aria-labelledby="${id}_l" aria-describedby="${id}_err" data-path="${esc(path)}" id="${id}">${opts}</div>${err}</div>`;
  }
  if (f.none) {
    const none = v === NONE;
    return `<div class="fld" data-field="${esc(path)}"${hidden}>
      <label class="lbl" for="${id}">${f.icon ? `<i class="ico" aria-hidden="true">${iconSvg(f.icon)}</i>` : ''}${esc(f.l)}${star}</label>${hint}
      <div class="withnone">
        <input id="${id}" type="text" data-path="${esc(path)}" data-kind="${esc(f.v || '')}" maxlength="${inputMax(f)}" placeholder="${esc(ph)}" value="${none ? '' : esc(v)}"${none ? ' disabled' : ''}${im}${textAttrs.replace(/ autocapitalize="[^"]*"/, '')} autocapitalize="off">
        <label class="none${none ? ' on' : ''}"><input type="checkbox" data-none="${esc(path)}"${none ? ' checked' : ''}> ${NONE}</label>
      </div>${err}</div>`;
  }
  let ctl;
  if (f.t === 'area') ctl = `<textarea id="${id}" data-path="${esc(path)}" rows="2" maxlength="${maxLen(f)}" placeholder="${esc(ph)}" aria-describedby="${id}_err">${esc(v)}</textarea><span class="cnt" data-cnt="${esc(path)}"></span>`;
  else if (f.t === 'sel') ctl = `<select id="${id}" data-path="${esc(path)}" data-kind="${esc(f.v || '')}" aria-describedby="${id}_err">
      <option value=""${f.o.includes(v) ? '' : ' selected'}>— оберіть зі списку —</option>
      ${f.o.map((o, i) => `<option value="${esc(o)}"${v === o ? ' selected' : ''}>${esc(f.ol?.[i] ?? o)}</option>`).join('')}</select>`;
  else if (f.t === 'date') ctl = `<input id="${id}" type="date" data-path="${esc(path)}" value="${esc(v)}" max="${todayISO()}" aria-describedby="${id}_err">`;
  else ctl = `<input id="${id}" type="text" data-path="${esc(path)}" data-kind="${esc(f.v || '')}" maxlength="${inputMax(f)}" placeholder="${esc(ph)}" value="${esc(v)}"${im}${textAttrs}>`;
  return `<div class="fld" data-field="${esc(path)}"${show}${hidden}>${label}${hint}${ctl}${err}</div>`;
}

// Стан картки: червоне — помилки введення; сіре — лишилося заповнити; зелене — усе гаразд
const cardStatus = (listKey, i) => {
  const mine = errors().filter(p => p.path.startsWith(`${listKey}.${i}.`));
  const bad = invalidOf(mine).length, todo = missingOf(mine).length;
  if (bad) return `<span class="badge bad">${bad} ${plural(bad, 'помилка', 'помилки', 'помилок')}</span>`;
  if (todo) return `<span class="badge todo">лишилося заповнити: ${todo}</span>`;
  return '<span class="badge ok">✓ заповнено</span>';
};

function cardHtml(listKey, i) {
  const def = listDef(listKey), item = data[listKey][i], open = openCard[listKey] === i;
  const title = hasText(item.name) ? item.name.trim() : '';
  const sub = hasText(item.coords) ? item.coords : '';
  const body = def.groups
    ? def.groups.map(g => `<div class="grp"><h4>${esc(g.title)}</h4>${g.fields.map(f => fieldHtml(f, `${listKey}.${i}.${f.k}`, item)).join('')}</div>`).join('')
    : def.fields.map(f => fieldHtml(f, `${listKey}.${i}.${f.k}`, item)).join('');
  const canDelete = !(def.keepOne && data[listKey].length <= 1);
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
    <p class="err" data-list-err="${l.key}"></p>
    <button type="button" class="btn add" data-add="${l.key}">+ Додати ${esc(l.addText)}</button></div>`;
}

function sectionHtml(s) {
  const fields = s.fields ? `<div class="fields">${s.fields.map(f => fieldHtml(f, f.k, data)).join('')}</div>` : '';
  // пояснення про службові контакти — у кожному розділі чергового (а не на рівні кроку: на кроці «Медичний пункт»
  // поруч є контакти начальника, для якого воно не діє)
  const lead = s.role ? `<p class="lead">${esc(CONTACTS_NOTE)}</p>` : '';
  const note = s.note ? `<p class="note">${esc(s.note)}</p>` : '';
  const hint = s.hint ? `<p class="hint">${esc(s.hint)}</p>` : '';
  const multi = stepOfSection(s.id).sections.length > 1;
  const cond = s.showIf ? ` data-cond${visible(s, data) ? '' : ' hidden'}` : '';
  return `<section class="sec" data-section="${s.id}"${cond}>${multi ? `<h3>${esc(s.title)}</h3>` : ''}${lead}${note}${hint}${fields}${s.list ? listHtml(s) : ''}</section>`;
}

// ---------- крок перевірки ----------
const itemPrefix = p => p.item != null ? `${listDef(p.path.split('.')[0]).item} ${p.item + 1} · ` : '';
const byStep = list => STEPS.filter(s => !s.final).map(s => ({ s, e: list.filter(p => p.step === s.id) })).filter(x => x.e.length);
const problemList = list => byStep(list).map(({ s, e }) => `<h4>${esc(s.title)} <span class="badge ${e[0].kind === 'missing' ? 'todo' : 'bad'}">${e.length}</span></h4>
  <ul>${e.map(p => `<li><button type="button" class="link" data-goto="${esc(p.path)}">${esc(itemPrefix(p))}${esc(p.label)}: <span>${esc(p.msg)}</span></button></li>`).join('')}</ul>`).join('');

function checkHtml() {
  const errs = errors(), warns = warnings(), pr = progressOf(normalizeData(data));
  const bad = invalidOf(errs), todo = missingOf(errs);
  const can = canDownload();
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
    ${bad.length ? `<div class="box bad"><h3>Потрібно виправити: ${bad.length} ${plural(bad.length, 'помилка', 'помилки', 'помилок')}</h3>
      <p>Ці поля заповнено неправильно. Натисніть на рядок, щоб перейти до поля.</p>${problemList(bad)}</div>` : ''}
    ${todo.length ? `<div class="box warn"><h3>Лишилося заповнити: ${todo.length} ${plural(todo.length, 'поле', 'поля', 'полів')}</h3>
      <p>Натисніть на рядок, щоб перейти до поля.</p>${problemList(todo)}</div>` : ''}
    ${!errs.length ? `<div class="box ok"><h3>Усе заповнено, помилок немає</h3><p>Усі обов’язкові поля заповнені, формати перевірено.</p></div>` : ''}
    ${warns.length ? `<div class="box warn" id="warnbox"><h3>Перевірте: ${warns.length} ${plural(warns.length, 'зауваження', 'зауваження', 'зауважень')}</h3>
      <p>Це не помилки, але підтвердіть, що дані правильні, або виправте їх.</p>
      <ul>${warns.map(w => `<li><label class="ackl"><input type="checkbox" data-ack="${esc(ackKey(w))}"${ack.has(ackKey(w)) ? ' checked' : ''}> <span>${esc(itemPrefix(w))}${esc(w.label)}: ${esc(w.msg)}</span></label> <button type="button" class="link small" data-goto="${esc(w.path)}">до поля</button></li>`).join('')}</ul>
    </div>` : ''}
    <div class="dl">
      <button type="button" class="btn primary big" id="report"${can ? '' : ' disabled'}>Завантажити звіт PDF</button>
      <p class="hint" id="dlhint"${can ? ' hidden' : ''}>${esc(dlHintText())}</p>
      <p class="rule"><b>Готовий PDF передавайте виключно через Element</b> черговому медичної служби. Передача будь-якими іншими месенджерами суворо заборонена.</p>
      <div class="draftrow"><button type="button" class="btn" id="draft">Зберегти чернетку PDF</button>
        <p class="hint">Чернетку можна відкрити в цій формі пізніше й продовжити. Для подання вона не придатна — на ній є позначка «ЧЕРНЕТКА».</p></div>
    </div>
  </section>`;
}

// ---------- каркас ----------
// Стан кроку в навігації: червоне — помилки введення (завжди); сіре — незаповнене (після спроби пройти крок)
function stepState(s, i) {
  if (s.final) return { cls: i === step ? 'cur' : '', badge: '' };
  const mine = errors().filter(p => p.step === s.id);
  const bad = invalidOf(mine).length, todo = attempted.has(s.id) ? missingOf(mine).length : 0;
  const cls = i === step ? 'cur' : bad ? 'bad' : todo ? 'todo' : attempted.has(s.id) ? 'ok' : '';
  const badge = bad ? `<b class="bad" title="Помилок: ${bad}">${bad}</b>` : todo ? `<b class="todo" title="Не заповнено: ${todo}">${todo}</b>` : '';
  return { cls, badge };
}
const progressHtml = pr => `<span class="long">Заповнено </span>${pr.done} з ${pr.total}`;

function noticesHtml() {
  return notices.map(n => `<div class="box ${n.kind} notice" data-notice="${esc(n.id)}" role="status">
    <p>${esc(n.text)}</p><button type="button" class="x" data-dismiss="${esc(n.id)}" aria-label="Закрити повідомлення">✕</button></div>`).join('');
}
function addNotice(id, kind, text) {
  notices = [...notices.filter(n => n.id !== id), { id, kind, text }];
  const box = $('#notices', app); if (box) box.innerHTML = noticesHtml();
}
function dropNotice(id) {
  notices = notices.filter(n => n.id !== id);
  const box = $('#notices', app); if (box) box.innerHTML = noticesHtml();
}

function render({ keepScroll = false } = {}) {
  const y = window.scrollY;
  const st = STEPS[step];
  const pr = progressOf(normalizeData(data));
  const stepsNav = STEPS.map((s, i) => {
    const { cls, badge } = stepState(s, i);
    return `<button type="button" class="stp ${cls}" data-step="${i}" aria-current="${i === step ? 'step' : 'false'}"><i>${s.final ? '✓' : i + 1}</i><span>${esc(s.short)}</span>${badge}</button>`;
  }).join('');
  const armed = nextArmed === st.id;
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
    <div id="notices" class="notices">${noticesHtml()}</div>
    ${step === 0 ? introHtml() : ''}
    <h2 class="h2" tabindex="-1"><small>Крок ${step + 1} з ${STEPS.length}</small>${esc(st.title)}</h2>
    ${st.final ? checkHtml() : st.sections.map(id => sectionHtml(sectionById(id))).join('')}
  </main>
  <footer class="nav">
    <p class="navnote" id="navnote"${armed ? '' : ' hidden'}>${armed ? esc(armedText(st.id)) : ''}</p>
    <button type="button" class="btn" id="prev"${step === 0 ? ' disabled' : ''}>← Назад</button>
    <span class="nav-mid">${progressHtml(pr)}</span>
    ${st.final ? '' : `<button type="button" class="btn primary" id="next">${nextLabel(armed)}</button>`}
  </footer>`;
  $$('textarea', app).forEach(counter);
  refreshErrors();
  // поточний крок — у видимій частині смужки кроків
  const nav = $('.steps', app), cur = $('.stp.cur', app);
  if (nav && cur) nav.scrollLeft = Math.max(0, cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2);
  if (keepScroll) window.scrollTo({ top: y }); else window.scrollTo({ top: 0 });
}
const nextLabel = armed => (step === STEPS.length - 2 ? 'До перевірки' : 'Далі') + (armed ? ' попри пропуски →' : ' →');
function armedText(id) {
  const mine = stepErrors(id), bad = invalidOf(mine).length, todo = missingOf(mine).length;
  const parts = [todo && `${todo} ${plural(todo, 'незаповнене поле', 'незаповнені поля', 'незаповнених полів')}`, bad && `${bad} ${plural(bad, 'помилка', 'помилки', 'помилок')}`].filter(Boolean);
  return `На цьому кроці: ${parts.join(', ')}. Виправте зараз або натисніть ще раз, щоб перейти далі.`;
}

function introHtml() {
  return `<details class="intro"><summary>Як працює анкета</summary>
    <ol>
      <li>Заповніть кроки по черзі. Поля з <span class="req">*</span> обов’язкові. Якщо щось не так — поле підсвітиться й з’явиться підказка.</li>
      <li>На останньому кроці форма покаже все, що треба заповнити чи виправити. Звіт PDF можна буде завантажити лише тоді, коли всі поля буде заповнено й помилок не залишиться.</li>
      <li>Готовий PDF надішліть черговому медслужби <b>лише через Element</b>. Інші месенджери заборонені.</li>
      <li>Наступного разу не починайте з нуля: натисніть <b>«Відкрити PDF»</b> і завантажте попередній звіт або чернетку — дані підставляться у форму.</li>
      <li>Щоб не втратити введене, зберігайте <b>чернетку PDF</b> на кроці «Перевірка та звіт». Браузер також тримає робочу копію на цьому пристрої до ${DRAFT_TTL_DAYS} ${plural(DRAFT_TTL_DAYS, 'дня', 'днів', 'днів')}, якщо браузер це дозволяє. Копія видаляється після завантаження звіту або кнопкою «Очистити».</li>
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
    fld.querySelectorAll(':scope > input, :scope > textarea, :scope > select, :scope > .withnone > input, :scope > .seg').forEach(el => el.setAttribute('aria-invalid', showIt ? 'true' : 'false'));
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
  // помилка самого списку (наприклад, «Так», але всі позиції видалено)
  $$('[data-list-err]', app).forEach(el => {
    const p = errors().find(x => x.path === el.dataset.listErr);
    el.textContent = p && attempted.has(p.step) ? p.msg : '';
  });
  // статуси карток і кроків без повного перерендеру
  $$('.card', app).forEach(c => { const b = c.querySelector('.card-t'); const old = b.querySelector('.badge'); const html = cardStatus(c.dataset.card, +c.dataset.idx); if (old) old.outerHTML = html || ''; else if (html) b.querySelector('.ttl').insertAdjacentHTML('afterend', html); });
  $$('.stp', app).forEach((b, i) => {
    const { cls, badge } = stepState(STEPS[i], i);
    b.className = `stp ${cls}`;
    b.querySelector('b')?.remove();
    if (badge) b.insertAdjacentHTML('beforeend', badge);
  });
  const pr = progressOf(normalizeData(data));
  const bar = $('.prog i', app); if (bar) bar.style.width = `${pr.total ? Math.round(100 * pr.done / pr.total) : 0}%`;
  const mid = $('.nav-mid', app); if (mid) mid.innerHTML = progressHtml(pr);
  // «Далі попри пропуски»: якщо пропуски вже виправлено — повертаємо звичайну кнопку
  if (nextArmed === STEPS[step].id) {
    const note = $('#navnote', app), btn = $('#next', app);
    if (!stepErrors(nextArmed).length) { nextArmed = null; if (note) note.hidden = true; if (btn) btn.textContent = nextLabel(false); }
    else if (note) note.textContent = armedText(nextArmed);
  }
}

// Показ/приховування умовних полів. Значення прихованих полів лишаються в data (на випадок, якщо відповідь повернуть),
// а зі звіту їх прибирає normalizeData.
function refreshVisibility(root) {
  $$('[data-field][data-cond]', root).forEach(el => {
    const f = fieldDef(el.dataset.field);
    if (f) el.hidden = !visible(f, itemOf(el.dataset.field));
  });
  $$('[data-section][data-cond]', root).forEach(el => { el.hidden = !visible(sectionById(el.dataset.section), data); });
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

// Список, що став видимим і має бути непорожнім (позиції для скидів після «Так»), одразу отримує першу картку
function ensureListItems() {
  let added = null;
  for (const k of LIST_KEYS) {
    const def = listDef(k);
    if ((def.min || 0) >= 1 && visible({ showIf: def.showIf }, data) && Array.isArray(data[k]) && !data[k].length) {
      data[k].push({}); openCard[k] = 0; added = k; problemsCache = null;
    }
  }
  return added;
}

function counter(el) {
  const c = app.querySelector(`[data-cnt="${CSS.escape(el.dataset.path)}"]`);
  if (c) c.textContent = el.value.length >= el.maxLength * .7 ? `${el.value.length} / ${el.maxLength}` : '';
}

const firstFocusable = root => root.querySelector('input:not([disabled]):not([type=checkbox]):not([type=file]), textarea, select, .seg-btn[tabindex="0"]');

// Вибір варіанта в перемикачі (клік мишею, дотик, стрілки чи пробіл з клавіатури)
function selectSeg(btn, { keyboard = false } = {}) {
  if (btn.classList.contains('on')) return;               // повторний вибір обраного — нічого не змінює
  const seg = btn.closest('.seg'), path = seg.dataset.path;
  $$('.seg-btn', seg).forEach(b => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); b.tabIndex = -1; });
  btn.classList.add('on'); btn.setAttribute('aria-checked', 'true'); btn.tabIndex = 0;
  setAt(path, btn.dataset.val);
  touched.add(path);
  const added = ensureListItems();
  if (added) {
    render({ keepScroll: true });
    const card = $(`.card[data-card="${added}"][data-idx="0"]`, app);
    if (keyboard) $(`.seg[data-path="${CSS.escape(path)}"] .seg-btn.on`, app)?.focus();
    else if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); firstFocusable(card)?.focus({ preventScroll: true }); }
  } else {
    refreshVisibility(btn.closest('.card-b') || app);
    if (!parsePath(path).list) refreshVisibility(app);
    refreshErrors();
  }
  scheduleAutosave();
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
  if (el.id === 'open') { openPdf(el.files[0]); el.value = ''; return; }
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
    const can = canDownload();
    const btn = $('#report', app), hint = $('#dlhint', app);
    if (btn) btn.disabled = !can;
    if (hint) { hint.hidden = can; hint.textContent = dlHintText(); }
  }
});
// Залишене порожнім поле не «сваримо» одразу: порожні обов’язкові показуємо після спроби пройти крок,
// а неправильно заповнене — щойно людина вийшла з поля
app.addEventListener('focusout', e => {
  const el = e.target;
  if (el.dataset?.path && !touched.has(el.dataset.path) && hasText(el.value)) { touched.add(el.dataset.path); refreshErrors(); }
});
app.addEventListener('click', e => {
  const t = e.target.closest('button, .seg-btn');
  if (!t) return;
  if (t.classList.contains('seg-btn')) { selectSeg(t, { keyboard: e.detail === 0 }); return; }
  if (t.dataset.step != null) { goStep(+t.dataset.step); return; }
  if (t.id === 'next') { onNext(); return; }
  if (t.id === 'prev') { goStep(step - 1); return; }
  if (t.dataset.dismiss) { dropNotice(t.dataset.dismiss); return; }
  if (t.id === 'today') { data.date = todayISO(); dirty = true; problemsCache = null; touched.add('date'); render({ keepScroll: true }); toast(`Дату оновлено: ${fmtDate(data.date)}.`); scheduleAutosave(); return; }
  if (t.dataset.add) {
    const key = t.dataset.add; data[key].push({}); openCard[key] = data[key].length - 1; dirty = true; problemsCache = null;
    render({ keepScroll: true });
    const card = $(`.card[data-card="${key}"][data-idx="${openCard[key]}"]`, app);
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (card) firstFocusable(card)?.focus({ preventScroll: true });
    scheduleAutosave(); return;
  }
  if (t.dataset.del) {
    const [key, iStr] = t.dataset.del.split(':'), i = +iStr, def = listDef(key);
    if (data[key].length <= 1 && def.keepOne) { toast(def.keepMsg); return; }
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
app.addEventListener('keydown', e => {
  if (e.target.id === 'openl' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('#open').click(); return; }
  // перемикач: стрілки переносять фокус на сусідній варіант і обирають його (як звичайні радіокнопки)
  if (e.target.classList?.contains('seg-btn') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    const btns = $$('.seg-btn', e.target.closest('.seg')), i = btns.indexOf(e.target);
    const next = btns[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + btns.length) % btns.length];
    next.focus(); selectSeg(next, { keyboard: true });
  }
});

// «Далі»: якщо на кроці є пропуски — спершу показуємо їх і лишаємось; друге натискання переходить
function onNext() {
  const cur = STEPS[step];
  attempted.add(cur.id);
  const errs = stepErrors(cur.id);
  if (!errs.length || nextArmed === cur.id) { goStep(step + 1); return; }
  nextArmed = cur.id;
  gotoPath(errs[0].path, { flash: true });
}

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

// ---------- кроки та історія браузера ----------
// Кожен перехід — запис в історії, тож кнопки браузера «Назад»/«Вперед» ходять між кроками
const pushHistory = () => { try { history.pushState({ step }, ''); } catch { /* перегляд без History API — працюємо без історії */ } };
const replaceHistory = () => { try { history.replaceState({ step }, ''); } catch { /* так само */ } };

function goStep(i, { push = true, focus = true } = {}) {
  if (i < 0 || i >= STEPS.length) return;
  if (i === STEPS.length - 1) STEPS.forEach(s => { if (!s.final) attempted.add(s.id); });
  const changed = i !== step;
  step = i; nextArmed = null; render(); scheduleAutosave();
  if (push && changed) pushHistory();
  if (focus) focusStepStart();
}
addEventListener('popstate', e => { const s = e.state?.step; if (Number.isInteger(s) && s >= 0 && s < STEPS.length) goStep(s, { push: false }); });

// Після переходу на крок: на комп’ютері — курсор у перше поле; на телефоні — на заголовок (щоб не вискакувала клавіатура)
function focusStepStart() {
  const h = $('.h2', app);
  const first = !STEPS[step].final && finePointer() ? firstFocusable($('.main', app)) : null;
  (first || h)?.focus({ preventScroll: true });
}

function gotoPath(path, { flash = true } = {}) {
  const p = parsePath(path);
  const sectionId = p.list ? listSection(p.list)
    : SECTIONS.find(s => s.fields?.some(f => f.k === path))?.id || listSection(path) || null;
  const st = STEPS.findIndex(s => s.sections.includes(sectionId));
  if (p.list) openCard[p.list] = p.idx;
  if (st >= 0) {
    const changed = st !== step;
    if (changed) nextArmed = null;
    step = st; render({ keepScroll: !changed });
    if (changed) pushHistory();
  }
  requestAnimationFrame(() => {
    const el = app.querySelector(`[data-path="${CSS.escape(path)}"]`) || app.querySelector(`[data-field="${CSS.escape(path)}"]`) || app.querySelector(`[data-list="${CSS.escape(path)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const box = el.closest('.fld') || el;
    const focusable = el.matches('input:not([disabled]),textarea,select') ? el : firstFocusable(box) || box.querySelector('.seg-btn') || box.querySelector('input[type=checkbox]');
    focusable?.focus({ preventScroll: true });
    if (flash) { box.classList.add('flash'); setTimeout(() => box.classList.remove('flash'), 1600); }
  });
}

// ---------- робоча копія на пристрої ----------
let saveTimer = null;
function scheduleAutosave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 600); }
function saveDraft() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ saved: new Date().toISOString(), step, attempted: [...attempted], data })); draftOk = true; }
  catch { if (draftOk) { draftOk = false; addNotice('nostore', 'warn', 'Браузер не дозволяє зберігати робочу копію на цьому пристрої. Зберігайте чернетку PDF, щоб не втратити введене.'); } }
}
function clearDraft() { clearTimeout(saveTimer); try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY); if (!raw) return null;
    const d = JSON.parse(raw);
    const age = Date.now() - Date.parse(d?.saved);
    if (!d || typeof d !== 'object' || !d.data || !Number.isFinite(age) || age > DRAFT_TTL_DAYS * 86400000) { clearDraft(); return null; }
    // робоча копія могла лишитися від попередньої версії форми — мігруємо так само, як файл
    const v = Number.isInteger(d.data.v) && d.data.v >= 1 && d.data.v <= SCHEMA_VERSION ? d.data.v : SCHEMA_VERSION;
    const data = migrate(d.data, v); delete data.migratedFrom;
    return { saved: d.saved, step: d.step | 0, attempted: Array.isArray(d.attempted) ? d.attempted.filter(x => typeof x === 'string') : [], data };
  } catch { clearDraft(); return null; }
}
addEventListener('pagehide', () => { if (dirty) saveDraft(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) saveDraft(); });

function reset(d) {
  data = d ? { ...emptyData(), ...d } : emptyData();
  for (const k of LIST_KEYS) {
    if (!Array.isArray(data[k])) data[k] = [];
    if (listDef(k).keepOne && !data[k].length) data[k] = [{}];
  }
  if (!hasText(data.date) && !d) data.date = todayISO();
  step = 0; dirty = false; problemsCache = null; attempted = new Set(); touched = new Set(); ack = new Set(); openCard = firstCards(); reopened = null;
  nextArmed = null; notices = [];
  ensureListItems();
  render();
}

// ---------- PDF ----------
async function download(kind) {
  if (kind === 'report' && !canDownload()) { toast('Спочатку заповніть усі поля, виправте помилки й підтвердьте зауваження.'); return; }
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
    if (kind === 'report') {
      clearDraft();     // звіт сформовано — робоча копія на пристрої більше не потрібна
      addNotice('saved', 'ok', `Звіт збережено: ${name}. Надішліть його черговому медслужби через Element.`);
    } else toast(`Чернетку збережено: ${name}`, 7000);
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
    const from = p.legacy ? 1 : p.data.migratedFrom;
    if (from) {
      const what = [from < 2 && 'НРК, гіпотермія, хімзахист', from < 3 && 'чи здійснюють скиди інші підрозділи', from < 4 && 'координати й начальник медпункту'].filter(Boolean);
      msg += from < 4 ? ` Це файл ${from === 1 ? 'старої' : 'попередньої'} версії форми: з’явилися нові питання (${what.join('; ')}) — їх треба заповнити.`
        : ' Це файл попередньої версії форми — дані перенесено автоматично.';
      if (from < 3) msg += ' Питання про медичне майно об’єднано в одне — перевірте відповідь.';
    }
    if (errs.length) msg += ` Лишилося заповнити або виправити: ${errs.length} ${plural(errs.length, 'поле', 'поля', 'полів')}.`;
    delete data.migratedFrom;
    goStep(STEPS.length - 1);
    addNotice('opened', from ? 'warn' : 'info', msg);
  } catch (e) { alert(e && e.message || 'Не вдалося прочитати файл.'); }
}
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); openPdf(e.dataTransfer.files[0]); });
addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------- короткі сповіщення ----------
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
    goStep(Math.min(Math.max(0, draft.step), STEPS.length - 1), { push: false });
    addNotice('restored', 'info', `Відновлено робочу копію з цього пристрою (${new Date(draft.saved).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}). Щоб почати з нуля — натисніть «Очистити».`);
  } else { reset(); focusStepStart(); }
  replaceHistory();
})();
