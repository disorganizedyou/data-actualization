// Повний звіт (PDF) — те, що підрозділ надсилає медслужбі.

import { ROLES, CONTACT, TITLE, FORM_NAME, LEVELS, POINT_GROUPS, POSITION_FIELDS, HEAD_CONTACTS, sectionById, visible, required, dropsDone, noDrops, NONE } from './schema.mjs';
import { hasText, fmtDate, people, plural } from './text.mjs';
import { kit, C, THEME, PAGE, ROLE_STYLE, L, T, keepHeadings, starWidth } from './pdfkit.mjs';
import { pdfEmbedding, makePayload } from './codec.mjs';
import { iconSvg } from './icons.mjs';
import { validateData, errorsOf } from './validate.mjs';

export const cellText = (f, o) => f.t !== 'group' ? o[f.k] : [
  ...f.items.filter(([k]) => +o[`${f.k}_${k}`] > 0).map(([k, , short]) => `${short} — ${people(+o[`${f.k}_${k}`])}`),
  ...(hasText(o[`${f.k}_other`]) ? ['Інше: ' + o[`${f.k}_other`].trim()] : []),
].join('\n');

export const trainingTotal = p => LEVELS.reduce((s, [k]) => s + (+p[`training_${k}`] > 0 ? +p[`training_${k}`] : 0), 0);
export const nrkShort = p => p.nrk === 'Є' ? `Є${hasText(p.nrk_count) ? ` · ${p.nrk_count.trim()}` : ''}` : p.nrk;
export const nonEmpty = p => p && Object.values(p).some(hasText);

// Контакти начальника медпункту стовпчиком: іконка + значення. skipNone — не показувати «Немає» (плакат)
export function headContacts(k, m, { width, size, iconColor, skipNone = false }) {
  const wrap = k.wrapTo(width - size - 4, size);
  const rows = HEAD_CONTACTS.filter(c => !skipNone || (hasText(m[c.k]) && m[c.k] !== NONE));
  if (!rows.length) return k.val('', size);
  return { stack: rows.map(c => ({ columnGap: 4, columns: [
    { svg: iconSvg(c.icon, iconColor), width: size * .85, height: size * .85, margin: [0, size * .15, 0, 0] },
    { width: '*', ...k.val(wrap(m[c.k]), size) }] })) };
}

// Список потреб і зауваг з усієї анкети (для розділу «Потреби та зауваги»)
export function collectNeeds(d) {
  const out = [];
  (d.points || []).forEach((p, i) => {
    const at = `Точка ${i + 1}${hasText(p.name) ? ` «${p.name.trim()}»` : ''}`;
    if ((p.supplied === 'Часткова' || p.supplied === 'Немає') && hasText(p.supplied_note))
      out.push({ where: at, what: `Бракує медмайна: ${p.supplied_note.trim()}`, level: 'bad' });
    const hypo = [['hypo_heat', 'хімічних грілок'], ['hypo_bag', 'спальників'], ['hypo_ready', 'Ready-Heat']].filter(([k]) => p[k] === NONE).map(([, n]) => n);
    if (hypo.length) out.push({ where: at, what: 'Немає засобів проти гіпотермії: ' + hypo.join(', '), level: 'bad' });
    if (p.ppe === NONE) out.push({ where: at, what: 'Немає засобів хімзахисту', level: 'bad' });
    if (p.ppe === 'Частково') out.push({ where: at, what: 'Хімзахист — частково' + (hasText(p.ppe_note) ? ': ' + p.ppe_note.trim() : ''), level: 'warn' });
    if (p.nrk === NONE) out.push({ where: at, what: 'НРК немає', level: 'note' });
    if (p.net === NONE) out.push({ where: at, what: 'Інтернету немає', level: 'note' });
    if (trainingTotal(p) === 0 && !hasText(p.training_other)) out.push({ where: at, what: 'Підготовленого персоналу не вказано', level: 'bad' });
  });
  if (d.mp_help === 'Так' && hasText(d.mp_help_note)) out.push({ where: 'Медпункт', what: 'Потрібна допомога у формуванні скидів: ' + d.mp_help_note.trim(), level: 'bad' });
  if (d.mp_std === 'Так' && hasText(d.mp_std_qty)) out.push({ where: 'Медпункт', what: 'Скиди встановленого зразка: ' + d.mp_std_qty.trim(), level: 'warn' });
  return out;
}

// d — нормалізовані дані; opts.kind 'report' | 'draft'; opts.created — ISO-рядок часу формування; opts.version — версія збірки
export function buildReport(d, { kind = 'report', created = '', version = '', regenerated = '' } = {}) {
  const k = kit(1), { z, val, lab, sec, pill } = k;
  const pts = sectionById('points'), pos = sectionById('drops'), algo = sectionById('algo'), mp = sectionById('mphelp');
  const LW = +(PAGE.cw * .3).toFixed(1);
  const draft = kind === 'draft';
  const problems = validateData(d), errors = errorsOf(problems);
  const VW = starWidth([LW, '*'], PAGE.cw), fitV = k.fit(VW, z(9));
  const kv = (fields, o) => ({ layout: k.lines(false), table: { widths: [LW, '*'], dontBreakRows: true,
    body: fields.filter(f => visible(f, o)).map(f => [lab(L(f)), val(fitV(cellText(f, o)))]) } });

  // Контакти чергових
  const CL = 78, CW = +((PAGE.cw - CL - 6 - ROLES.length * 12) / ROLES.length).toFixed(1), wrapC = k.wrapTo(CW, z(10));
  const contacts = { layout: k.lines(true), table: { headerRows: 1, dontBreakRows: true, widths: [CL, ...ROLES.map(() => CW)],
    body: [['', ...ROLES.map(r => ({ columnGap: z(6), columns: [k.badge(r.role, z(18)), { width: '*', stack: [
      { text: ROLE_STYLE[r.role].name, bold: true }, { text: ROLE_STYLE[r.role].sub, color: C.grey }] }] }))],
    ...CONTACT.map(c => [lab(L(c), c.icon), ...ROLES.map(r => val(wrapC(d[`${r.role}_${c.k}`]), z(10)))])] } };

  const head = t => ({ text: t, color: C.grey, fontSize: z(7) });

  // Медичні пункти
  const meds = (d.medpoints || []).filter(nonEmpty);
  const MW = [14, '*', 96, 170], fitMed = k.fit(starWidth(MW, PAGE.cw), z(9.5));
  const medpoints = meds.length ? { layout: k.lines(true, 3), table: { headerRows: 1, dontBreakRows: true, widths: MW,
    body: [[head('№'), head('Медпункт'), head('Начальник'), head('Контакти начальника')],
      ...meds.map((m, i) => [
        { text: String(i + 1), color: C.grey },
        { stack: [{ ...val(fitMed(m.name), z(9.5)) }, { text: m.coords || '', color: C.grey, fontSize: z(8) }] },
        val(m.head_callsign, z(9.5)),
        headContacts(k, m, { width: 170, size: z(9), iconColor: C.grey }),
      ])] } } : { text: 'Медпунктів не вказано', color: C.grey };

  // Зведення по точках
  const points = (d.points || []).filter(nonEmpty);
  const SUMW = [12, '*', 52, 44, 40, 48, 50, 48, 40], fitName = k.fit(starWidth(SUMW, PAGE.cw), z(8.5));
  const summary = points.length ? { layout: k.lines(true, 3), table: { headerRows: 1, dontBreakRows: true,
    widths: SUMW,
    body: [[head('№'), head('Точка'), head('Майно'), head('НРК'), head('Грілки'), head('Спальники'), head('Ready-Heat'), head('Хімзахист'), head('Підгот.')],
      ...points.map((p, i) => [
        { text: String(i + 1), color: THEME.grey, fontSize: z(8) },
        { stack: [{ text: hasText(p.name) ? fitName(p.name.trim()) : '—', bold: true, fontSize: z(8.5) }, { text: p.coords || '', color: C.grey, fontSize: z(7) }] },
        pill('supplied', p.supplied), pill('nrk', nrkShort(p)),
        pill('hypo', p.hypo_heat), pill('hypo', p.hypo_bag), pill('hypo', p.hypo_ready), pill('ppe', p.ppe),
        { text: trainingTotal(p) > 0 ? people(trainingTotal(p)) : hasText(p.training_other) ? 'інше ↓' : '—', bold: trainingTotal(p) > 0, color: trainingTotal(p) > 0 ? C.ink : hasText(p.training_other) ? C.grey : C.bad, fontSize: z(8) },
      ])] } } : null;

  // Детально по точках
  const detail = points.map((p, i) => ({ margin: [0, 0, 0, z(10)], layout: k.lines(true), table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: [LW, '*'],
    body: [[{ colSpan: 2, text: [{ text: `Точка ${i + 1}`, color: C.ink }, hasText(p.name) ? '   ' + p.name.trim() : ''], bold: true, fontSize: z(10.5) }, {}],
      ...POINT_GROUPS.flatMap(g => {
        // необов’язкові порожні поля (уточнення) не показуємо; обов’язкові порожні — як «—»
        const rows = g.fields.filter(f => visible(f, p) && f.k !== 'name' && (required(f, p, d) || f.t === 'group' || hasText(cellText(f, p))));
        if (!rows.length) return [];
        // назва групи — у першому рядку групи, щоб не лишалася сиротою внизу сторінки
        const groupLab = { text: g.title.toUpperCase(), color: C.grey, fontSize: z(6.5), characterSpacing: .4, margin: [0, 0, 0, z(2)] };
        return rows.map((f, ri) => [ri === 0 ? { stack: [groupLab, lab(L(f))] } : lab(L(f)),
          f.t === 'seg' ? pill(f.k.startsWith('hypo') ? 'hypo' : f.k, p[f.k], z(9)) : val(fitV(cellText(f, p)))]);
      })] } }));

  // Позиції для скидів
  const posRows = (d.positions || []).filter(nonEmpty);
  const positions = d.drops === 'Так' && posRows.length
    ? { layout: k.lines(true), table: { headerRows: 1, dontBreakRows: true, widths: [18, '*', 110, 56, 64],
      body: [['№', ...POSITION_FIELDS.map(L)].map(t => ({ text: t, color: C.grey })),
        ...posRows.map((p, i) => [{ text: String(i + 1), color: C.grey }, ...POSITION_FIELDS.map(f => val(f.k === 'name' ? k.fit(starWidth([18, '*', 110, 56, 64], PAGE.cw), z(9))(p[f.k]) : p[f.k]))])] } }
    : kv(pos.fields, d);

  // Потреби та зауваги
  const needs = collectNeeds(d);
  const needsBlock = needs.length ? { layout: k.lines(false, 3), table: { widths: [LW, '*'], dontBreakRows: true,
    body: needs.map(n => [{ text: n.where, color: C.grey }, { text: fitV(n.what), bold: n.level !== 'note', color: n.level === 'bad' ? C.bad : n.level === 'warn' ? C.warn : C.grey }]) } }
    : { text: 'Потреб і зауваг не зазначено', color: C.grey };

  const unit = hasText(d.unit) ? d.unit.trim().toUpperCase() : '—';
  const meta = [['Підрозділ', unit], ['Дата актуальності', fmtDate(d.date)], ['Заповнив(-ла)', d.author]];
  const status = draft
    ? { text: `ЧЕРНЕТКА — ${errors.length ? `${errors.length} ${plural(errors.length, 'помилка', 'помилки', 'помилок')}, ` : ''}не для подання`, color: C.bad, bold: true }
    : errors.length
      ? { text: `Увага: ${errors.length} ${plural(errors.length, 'помилка', 'помилки', 'помилок')} — звіт неповний`, color: C.bad, bold: true }
      : { text: 'Перевірено формою · помилок немає', color: C.ok, bold: true };

  const content = [
    { columns: [{ text: draft ? 'Чернетка звіту' : 'Повний звіт', color: C.ink, bold: true }, { text: status.text, color: status.color, bold: true, alignment: 'right' }] },
    { text: TITLE, font: THEME.head, bold: true, fontSize: z(16), margin: [0, z(2), 0, z(10)] },
    { columns: meta.map(([l, v]) => ({ width: 'auto', margin: [0, 0, z(28), 0], stack: [{ text: l, color: C.grey }, val(v, z(12))] })) },
    { margin: [0, z(12), 0, 0], layout: 'noBorders', table: { widths: ['*'], body: [[{ fillColor: C.accent, color: '#fff', bold: true, fontSize: z(8.5),
      margin: [z(8), z(4), z(8), z(4)], text: 'Передавати лише через Element черговому медслужби. Інші месенджери суворо заборонені.' }]] } },
    sec('Контакти чергових'),
    { text: 'Службові контакти чергових акаунтів, а не особисті контакти військовослужбовців.', color: C.grey, margin: [0, 0, 0, z(6)] },
    contacts,
    sec('Медичні пункти'), medpoints,
    sec('Зведення по точках передачі'),
    summary || { text: 'Точок не вказано', color: C.grey },
    sec(T(pts) + ' — детально'),
    ...(detail.length ? detail : [{ text: 'Точок не вказано', color: C.grey }]),
    sec(T(pos)), positions,
    sec(T(algo)), dropsDone(d) ? kv(algo.fields, d)
      : { text: noDrops(d) ? 'Медичні скиди для підрозділу не здійснюються' : '—', color: C.grey },
    sec(T(mp)), kv(mp.fields, d),
    sec('Потреби та зауваги'), needsBlock,
  ];
  const payload = makePayload(d, { kind, created }), emb = pdfEmbedding(payload);
  const tag = [draft ? 'Чернетка' : 'Повний звіт', unit, fmtDate(d.date)].filter(hasText).join('  ·  ');
  return {
    pageSize: 'A4', pageMargins: [PAGE.m, 40, PAGE.m, 44], content, pageBreakBefore: keepHeadings,
    files: emb.files,
    info: { ...emb.info, title: [draft ? 'Чернетка' : 'Повний звіт', TITLE, d.unit, fmtDate(d.date)].filter(hasText).join(' — '),
      subject: TITLE, keywords: ['med-data-actualization', `schema-v${payload.v}`, kind].join(' '), creator: `Анкета актуалізації даних ${version}`.trim(), producer: 'pdfmake' },
    defaultStyle: { font: 'eU', fontSize: 9, lineHeight: 1.2, color: C.ink },
    ...(draft ? { background: () => ({ text: 'ЧЕРНЕТКА', color: '#f3d3d5', bold: true, fontSize: 78, font: THEME.head, alignment: 'center', margin: [0, 360, 0, 0] }) } : {}),
    header: cur => cur > 1 ? { margin: [PAGE.m, 18, PAGE.m, 0], fontSize: 7, color: C.grey, text: tag } : null,
    footer: (cur, total) => ({ margin: [PAGE.m, 14, PAGE.m, 0], fontSize: 6.5, color: C.grey, columns: [
      { text: `${draft ? 'Чернетка' : 'Повний звіт'}. Цей PDF можна відкрити у формі «${FORM_NAME}» для редагування.${created ? ` Сформовано ${fmtDate(created.slice(0, 10))}.` : ''}${regenerated ? ` Повторно сформовано медслужбою ${fmtDate(regenerated.slice(0, 10))}.` : ''}${version ? ` Форма ${version}.` : ''}` },
      { text: `${cur} / ${total}`, alignment: 'right', width: 40 }] }),
  };
}
