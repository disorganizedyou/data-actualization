// Плакат A4 «Довідка чергового» — друкує медслужба для себе зі звіту підрозділу.

import { ROLES, CONTACT, sectionById, dropsDone, noDrops, NONE } from './schema.mjs';
import { hasText, fmtDate, plural } from './text.mjs';
import { kit, C, THEME, PAGE, ROLE_STYLE, T, textWidth, starWidth } from './pdfkit.mjs';
import { iconSvg } from './icons.mjs';
import { nrkShort, nonEmpty, collectNeeds } from './report.mjs';

export const MIN_SCALE = 0.5;

// warn — напис-попередження у шапці (наприклад, «ЧЕРНЕТКА» або «звіт із помилками»)
export function buildPoster(d, sc = 1, { version = '', warn = '' } = {}) {
  const k = kit(sc), { z, val, sec } = k;
  const pts = sectionById('points'), pos = sectionById('drops'), algo = sectionById('algo');
  const unit = hasText(d.unit) ? d.unit.trim().toUpperCase() : '—';
  const UNIT_W = +(PAGE.cw * .42).toFixed(1), unitFs = Math.min(z(64), UNIT_W / Math.max(textWidth(unit, THEME.unitFont), .01) * .97);

  const header = { columns: [
    { width: '*', stack: [
      { text: 'Довідка чергового', font: THEME.head, bold: true, fontSize: z(22), lineHeight: 1 },
      { text: 'Медична служба: чергові, точки передачі поранених, медичні скиди', color: C.grey, fontSize: z(9), margin: [0, z(6), 0, 0] },
      { text: [{ text: 'Актуально на  ', color: C.grey }, { text: fmtDate(d.date) || '—', bold: true }], fontSize: z(10), margin: [0, z(6), 0, 0] },
      ...(warn ? [{ text: warn.toUpperCase(), color: '#fff', background: C.bad, bold: true, fontSize: z(8), margin: [0, z(6), 0, 0] }] : [])] },
    { width: UNIT_W, stack: [
      { text: 'Підрозділ', color: C.grey, fontSize: z(8), alignment: 'right' },
      { text: unit, font: THEME.head, bold: true, fontSize: unitFs, lineHeight: .95, noWrap: true, alignment: 'right' }] },
  ] };

  const G = z(12), cardW = +((PAGE.cw - 2 * G) / 3).toFixed(1), IW = z(11), VW = cardW - IW - z(6), VS = z(11);
  const wrapV = k.wrapTo(VW, VS), wrapCall = k.wrapTo(cardW, z(17), THEME.unitFont);
  const gap = { text: '', border: [false, false, false, false] };
  const row = cells => cells.flatMap((c, i) => i ? [gap, c] : [c]);
  const bottom = c => ({ ...c, border: [false, false, false, true] });
  const cards = { layout: { paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => z(4), paddingBottom: () => z(3.5),
    hLineWidth: () => .5, vLineWidth: () => 0, hLineColor: () => C.rule },
  table: { widths: ROLES.flatMap((_, i) => i ? [G, cardW] : [cardW]), body: [
    row(ROLES.map(r => ({ border: [false, false, false, false], stack: [
      { canvas: [{ type: 'rect', x: 0, y: 0, w: cardW, h: z(4), color: THEME.roles[r.role] }] },
      { columnGap: z(7), margin: [0, z(7), 0, 0], columns: [k.badge(r.role, z(24)), { width: '*', stack: [
        { text: ROLE_STYLE[r.role].name, bold: true, fontSize: z(9.5) },
        { text: ROLE_STYLE[r.role].sub, color: r.note ? THEME.roles[r.role] : C.grey, bold: !!r.note, fontSize: z(8.5) }] }] }] }))),
    row(ROLES.map(r => bottom({ ...val(wrapCall(d[`${r.role}_callsign`]), z(17)), font: THEME.head, margin: [0, z(4), 0, z(2)] }))),
    ...CONTACT.filter(c => c.icon).map(c => row(ROLES.map(r => bottom({ columnGap: z(6), columns: [
      { svg: iconSvg(c.icon, C.ink), width: IW, height: IW, margin: [0, z(1), 0, 0] }, { width: '*', ...val(wrapV(d[`${r.role}_${c.k}`]), VS) }] })))),
  ] } };

  const head = t => ({ text: t, color: C.grey, fontSize: z(7.5) });
  const num = i => ({ text: String(i + 1), font: THEME.head, bold: true, fontSize: z(14), color: C.ink, lineHeight: 1 });
  const pointRows = (d.points || []).filter(nonEmpty);
  const nrkCell = p => {
    if (!hasText(p.nrk)) return val('', z(9.5));
    if (p.nrk !== 'Є') return { text: NONE, color: C.grey, fontSize: z(9.5) };
    const feats = [['nrk_reb', 'РЕБ'], ['nrk_cam', 'камера'], ['nrk_mic', 'мікрофон']].filter(([kk]) => p[kk] === 'Так').map(([, n]) => n);
    return { stack: [{ text: nrkShort(p), bold: true, fontSize: z(9.5) }, ...(feats.length ? [{ text: feats.join(', '), color: C.grey, fontSize: z(8) }] : [])] };
  };
  const PW = [z(18), '*', z(116), z(72), z(72), '*'], PSW = starWidth(PW, PAGE.cw), fitP11 = k.fit(PSW, z(11)), fitP9 = k.fit(PSW, z(9.5));
  const points = pointRows.length ? { layout: k.lines(true, 4), table: { headerRows: 1, dontBreakRows: true,
    widths: PW,
    body: [[head('№'), head('Назва / орієнтир'), head('Координати MGRS'), head('Інтернет'), head('НРК'), head('Зв’язок з точкою')],
      ...pointRows.map((p, i) => [num(i), val(fitP11(p.name), z(11)), { ...val(p.coords, z(10.5)), noWrap: true },
        { stack: [val(p.net, z(9.5)), ...(hasText(p.net_note) ? [{ text: p.net_note.trim(), color: C.grey, fontSize: z(8.5) }] : [])] },
        nrkCell(p), val(fitP9(p.contact), z(9.5))])] } }
    : { text: 'Точок не вказано', color: C.grey };

  const posRows = (d.positions || []).filter(nonEmpty);
  const positions = d.drops === 'Так' && posRows.length ? { layout: k.lines(true, 4), table: { headerRows: 1, dontBreakRows: true,
    widths: [z(18), '*', z(112), z(70), z(70)],
    body: [[head('№'), head('Назва / позивний'), head('Координати MGRS'), head('Вага скиду'), head('Підліт')],
      ...posRows.map((p, i) => [num(i), val(k.fit(starWidth([z(18), '*', z(112), z(70), z(70)], PAGE.cw), z(11))(p.name), z(11)), { ...val(p.coords, z(10.5)), noWrap: true },
        val(hasText(p.weight) ? p.weight.trim() + ' кг' : '', z(11)), val(hasText(p.flight) ? p.flight.trim() + ' хв' : '', z(11))])] } }
    : { text: d.drops === 'Ні' ? 'Позицій для медичних скидів немає' : '—', color: C.grey };

  const step = (n, label, body) => ({ width: '*', stack: [
    { text: String(n).padStart(2, '0'), font: THEME.head, bold: true, fontSize: z(16), color: C.ink, lineHeight: 1 },
    { text: label, color: C.grey, fontSize: z(8), margin: [0, z(4), 0, z(2)] }, body] });
  const algoBlock = !dropsDone(d) ? [{ text: noDrops(d) ? 'Медичні скиди для підрозділу не здійснюються' : '—', color: C.grey }] : [
    { columnGap: G, columns: [
      step(1, 'Хто доставляє й куди', val(d.algo_carry, z(10))),
      step(2, 'Хто здійснює скид', val(d.algo_hand, z(10))),
      step(3, 'Від запиту до скиду', hasText(d.algo_time)
        ? { text: [{ text: d.algo_time.trim(), fontSize: z(24), font: THEME.head }, { text: '  хв', fontSize: z(11) }], bold: true, lineHeight: 1 }
        : val('')),
    ] },
    ...(hasText(d.algo_note) ? [{ margin: [0, z(8), 0, 0], text: [{ text: 'Додатково:  ', color: C.grey }, { text: d.algo_note.trim(), bold: true }], fontSize: z(9.5) }] : []),
  ];

  return {
    pageSize: 'A4', pageMargins: [PAGE.m, PAGE.m, PAGE.m, 40],
    info: { title: ['Довідка чергового', d.unit, fmtDate(d.date)].filter(hasText).join(' — '), creator: `Медслужба — плакати ${version}`.trim(), producer: 'pdfmake' },
    defaultStyle: { font: 'eU', fontSize: z(9), lineHeight: 1.15, color: C.ink },
    content: [header,
      sec('Чергові'), cards,
      sec(T(pts)), points,
      sec(T(pos)), positions,
      sec(T(algo)), ...algoBlock],
    footer: (cur, total) => ({ margin: [PAGE.m, 14, PAGE.m, 0], fontSize: 6.5, color: C.grey, columns: [
      { text: `Актуально на ${fmtDate(d.date) || '—'}. Змінні дані (забезпечення, потреби, підготовка) — у повному звіті підрозділу.${warn ? ' ' + warn + '.' : ''}` },
      { text: total > 1 ? `${cur} / ${total}` : '', alignment: 'right', width: 40 }] }),
  };
}

// Зведений аркуш контактів чергових усіх підрозділів (для стіни медслужби)
export function buildContactsSheet(reports, { version = '' } = {}) {
  const k = kit(1), { z, val, sec } = k;
  const rows = reports.map(r => r.data);
  const CW = +((PAGE.cw - 60 - 6 - 3 * 12) / 3).toFixed(1), wrap = k.wrapTo(CW - 30, z(8));
  const cell = (d, role) => ({ stack: [
    { text: hasText(d[`${role}_callsign`]) ? d[`${role}_callsign`].trim() : '—', bold: true, fontSize: z(9.5) },
    ...CONTACT.filter(c => c.icon).map(c => ({ columnGap: z(4), columns: [
      { svg: iconSvg(c.icon, C.grey), width: z(7), height: z(7), margin: [0, z(1.5), 0, 0] },
      { width: '*', ...val(wrap(d[`${role}_${c.k}`]), z(8)) }] })),
  ] });
  return {
    pageSize: 'A4', pageMargins: [PAGE.m, PAGE.m, PAGE.m, 40],
    info: { title: 'Чергові підрозділів — зведення', creator: `Медслужба — плакати ${version}`.trim(), producer: 'pdfmake' },
    defaultStyle: { font: 'eU', fontSize: 9, lineHeight: 1.15, color: C.ink },
    content: [
      { text: 'Чергові підрозділів', font: THEME.head, bold: true, fontSize: z(22), lineHeight: 1 },
      { text: `${rows.length === 1 ? 'Зі звіту 1 підрозділу' : `Зі звітів ${rows.length} ${plural(rows.length, 'підрозділу', 'підрозділів', 'підрозділів')}`} · службові контакти чергових акаунтів`, color: C.grey, fontSize: z(9), margin: [0, z(6), 0, 0] },
      sec('Контакти'),
      { layout: k.lines(true, 5), table: { headerRows: 1, dontBreakRows: true, widths: [60, CW, CW, CW],
        body: [[{ text: 'Підрозділ', color: C.grey, fontSize: z(7.5) }, ...ROLES.map(r => ({ columnGap: z(5), columns: [k.badge(r.role, z(14)), { width: '*', text: ROLE_STYLE[r.role].name, bold: true, fontSize: z(8.5) }] }))],
          ...rows.map(d => [{ stack: [{ text: hasText(d.unit) ? d.unit.trim().toUpperCase() : '—', font: THEME.head, bold: true, fontSize: z(12) }, { text: fmtDate(d.date), color: C.grey, fontSize: z(7) }] },
            ...ROLES.map(r => cell(d, r.role))])] } },
    ],
    footer: (cur, total) => ({ margin: [PAGE.m, 14, PAGE.m, 0], fontSize: 6.5, color: C.grey, columns: [
      { text: 'Зведення контактів чергових. Дата біля назви підрозділу — дата актуальності його звіту.' },
      { text: total > 1 ? `${cur} / ${total}` : '', alignment: 'right', width: 40 }] }),
  };
}

// Зведення потреб і зауваг усіх підрозділів — для планування дозабезпечення
export function buildNeedsSheet(reports, { version = '' } = {}) {
  const k = kit(1), { z, sec } = k;
  const LW = 70, WW = 110, fitT = k.fit(starWidth([LW, WW, '*'], PAGE.cw), z(9));
  const blocks = reports.flatMap(r => {
    const needs = collectNeeds(r.data).filter(n => n.level !== 'note');
    const unit = hasText(r.data.unit) ? r.data.unit.trim().toUpperCase() : '—';
    return needs.map((n, i) => [i === 0 ? { stack: [{ text: unit, font: THEME.head, bold: true, fontSize: z(11) }, { text: fmtDate(r.data.date), color: C.grey, fontSize: z(7) }] } : '',
      { text: n.where, color: C.grey, fontSize: z(8.5) }, { text: fitT(n.what), bold: n.level === 'bad', color: n.level === 'bad' ? C.bad : C.ink, fontSize: z(9) }]);
  });
  const total = reports.length;
  return {
    pageSize: 'A4', pageMargins: [PAGE.m, PAGE.m, PAGE.m, 40],
    info: { title: 'Потреби підрозділів — зведення', creator: `Медслужба — плакати ${version}`.trim(), producer: 'pdfmake' },
    defaultStyle: { font: 'eU', fontSize: 9, lineHeight: 1.15, color: C.ink },
    content: [
      { text: 'Потреби та зауваги підрозділів', font: THEME.head, bold: true, fontSize: z(22), lineHeight: 1 },
      { text: `${total === 1 ? 'Зі звіту 1 підрозділу' : `Зі звітів ${total} ${plural(total, 'підрозділу', 'підрозділів', 'підрозділів')}`} · червоним — брак майна чи засобів, чорним — зауваги`, color: C.grey, fontSize: z(9), margin: [0, z(6), 0, 0] },
      sec('Потреби'),
      blocks.length ? { layout: k.lines(false, 4), table: { widths: [LW, WW, '*'], dontBreakRows: true, body: blocks } } : { text: 'Потреб не зазначено', color: C.grey },
    ],
    footer: (cur, total) => ({ margin: [PAGE.m, 14, PAGE.m, 0], fontSize: 6.5, color: C.grey, columns: [
      { text: 'Зведення потреб. Дата біля назви підрозділу — дата актуальності його звіту.' }, { text: total > 1 ? `${cur} / ${total}` : '', alignment: 'right', width: 40 }] }),
  };
}
