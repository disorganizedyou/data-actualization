// Схема даних анкети (версія 2). Єдине джерело правди для форми, валідації, звіту, плаката й тестів.
//
// Поле (field):
//   k        ключ у даних (для елементів списку — відносний)
//   l        підпис у формі
//   pl       короткий підпис у PDF (за замовчуванням = l)
//   t        тип: text (типово) | date | sel | seg | area | count | group
//   v        «вид» значення для нормалізації/перевірки (див. validate.mjs KINDS)
//   o        варіанти для sel/seg
//   req      обов’язкове: true | (item, data) => boolean
//   showIf   [ключ, [значення…]] — показувати лише коли інше поле має одне зі значень
//   max      максимальна довжина
//   ph       плейсхолдер
//   hint     підказка під полем

export const SCHEMA_VERSION = 2;
export const NONE = 'Немає';
export const TITLE = 'Актуалізація даних для медичної служби';
export const FORM_NAME = 'Анкета актуалізації даних';

export const OPT = {
  yn: ['Так', 'Ні'],
  ypn: ['Так', 'Частково', 'Ні'],
  have: ['Є', 'Немає'],
  havePart: ['Є', 'Частково', 'Немає'],
  net: ['Є, стабільна', 'Є, нестабільна', 'Немає'],
};

// Рівні підготовки: [ключ, повна назва, коротка назва]
export const LEVELS = [
  ['asm', 'Базова домедична допомога (TCCC ASM)', 'Базова (ASM)'],
  ['cls', 'CLS (Combat Lifesaver)', 'CLS'],
  ['cmc', 'CMC (Combat Medic / Corpsman)', 'CMC'],
  ['cpp', 'CPP (Combat Paramedic / Provider)', 'CPP'],
  ['med', 'Медична освіта (фельдшер, медсестра, лікар)', 'Медосвіта'],
];

// Контакти чергового (поля однакові для всіх трьох ролей; у даних ключ = роль + '_' + k)
export const CONTACT = [
  { k: 'callsign', l: 'Позивний чергового', pl: 'Позивний', v: 'callsign', max: 30, req: true, ph: 'наприклад: Сокіл' },
  { k: 'phone', l: 'WhatsApp', icon: 'whatsapp', v: 'phone', none: true, req: true },
  { k: 'signal', l: 'Signal', icon: 'signal', v: 'signal', none: true, req: true },
  { k: 'element', l: 'Element', icon: 'element', v: 'element', none: true, req: true },
  { k: 'discord', l: 'Discord', icon: 'discord', v: 'discord', none: true, req: true },
];

export const ROLES = [
  { role: 'kb', title: 'Черговий капітан бою', short: 'Черговий КБ', sub: 'підрозділу', badge: 'КБ', color: '#1f4fa3' },
  { role: 's4', title: 'Черговий S4', short: 'Черговий S4', sub: 'підрозділу', badge: 'S4', color: '#b26b00' },
  { role: 'mp', title: 'Черговий медичного пункту', short: 'Черговий медпункту', sub: 'підрозділу · цілодобово',
    note: 'Обов’язково чергує цілодобово', badge: 'cross', color: '#e30613' },
];

export const CONTACTS_NOTE = 'Вказуйте контакти саме чергових акаунтів — службових номерів і месенджерів, якими користується черговий зміни. '
  + 'Не вказуйте особисті контакти окремих військовослужбовців.';

const is = (key, ...values) => it => values.includes(it?.[key]);

// ---- Точка передачі поранених: поля згруповані для зручності заповнення ----
export const POINT_GROUPS = [
  { id: 'loc', title: 'Розташування', fields: [
    { k: 'name', l: 'Назва або орієнтир точки', pl: 'Назва / орієнтир', v: 'name', max: 60, req: true, ph: 'наприклад: «Сосна», підвал біля школи' },
    { k: 'coords', l: 'Приблизні координати (MGRS)', pl: 'Координати', v: 'coords', req: true },
  ] },
  { id: 'link', title: 'Зв’язок', fields: [
    { k: 'contact', l: 'Контакт для зв’язку з точкою', pl: 'Зв’язок з точкою', t: 'area', max: 300, req: true,
      ph: 'позивний, телефон або месенджер, частота' },
    { k: 'net', l: 'Інтернет на точці', pl: 'Інтернет', t: 'seg', o: OPT.net, req: true },
    { k: 'net_note', l: 'Яке саме підключення', pl: 'Тип підключення', max: 100, req: true,
      showIf: ['net', ['Є, стабільна', 'Є, нестабільна']], ph: 'мобільний інтернет, Starlink…' },
  ] },
  { id: 'supply', title: 'Медичне майно', fields: [
    { k: 'supplied', l: 'Чи забезпечена точка медичним майном у належній кількості', pl: 'Забезпечення майном', t: 'seg', o: OPT.ypn, req: true },
    { k: 'supplied_note', l: 'Чого бракує', pl: 'Чого бракує', t: 'area', max: 300, req: true, showIf: ['supplied', ['Частково', 'Ні']] },
    { k: 'need', l: 'Потреба в дозабезпеченні медичним майном', pl: 'Потреба в дозабезпеченні', t: 'seg', o: OPT.have, req: true },
    { k: 'need_note', l: 'Що саме та в якій кількості', pl: 'Що саме, скільки', t: 'area', max: 400, req: true,
      showIf: ['need', ['Є']], ph: 'наприклад: турнікети — 10 шт.' },
  ] },
  { id: 'nrk', title: 'НРК — наземний роботизований комплекс', fields: [
    { k: 'nrk', l: 'Чи є НРК на точці', pl: 'НРК', t: 'seg', o: OPT.have, req: true },
    { k: 'nrk_count', l: 'Кількість НРК', pl: 'Кількість НРК', v: 'count', min: 1, max: 3, req: true, showIf: ['nrk', ['Є']] },
    { k: 'nrk_reb', l: 'Обладнані засобами РЕБ', pl: 'РЕБ', t: 'seg', o: OPT.ypn, req: true, showIf: ['nrk', ['Є']] },
    { k: 'nrk_cam', l: 'Обладнані камерою', pl: 'Камера', t: 'seg', o: OPT.ypn, req: true, showIf: ['nrk', ['Є']] },
    { k: 'nrk_mic', l: 'Обладнані мікрофоном', pl: 'Мікрофон', t: 'seg', o: OPT.ypn, req: true, showIf: ['nrk', ['Є']] },
    { k: 'nrk_note', l: 'Модель, уточнення', pl: 'Уточнення', max: 200, showIf: ['nrk', ['Є']], ph: 'необов’язково' },
  ] },
  { id: 'hypo', title: 'Засоби проти гіпотермії', fields: [
    { k: 'hypo_heat', l: 'Хімічні грілки', pl: 'Хімічні грілки', t: 'seg', o: OPT.have, req: true },
    { k: 'hypo_bag', l: 'Спальники', pl: 'Спальники', t: 'seg', o: OPT.have, req: true },
    { k: 'hypo_ready', l: 'Ready-Heat', pl: 'Ready-Heat', t: 'seg', o: OPT.have, req: true },
    { k: 'hypo_note', l: 'Кількість, уточнення', pl: 'Уточнення', max: 200, ph: 'необов’язково, наприклад: грілки — 20 шт.' },
  ] },
  { id: 'ppe', title: 'Засоби індивідуального захисту (хімзахист)', fields: [
    { k: 'ppe', l: 'Чи є на точці засоби хімзахисту', pl: 'Хімзахист', t: 'seg', o: OPT.havePart, req: true },
    { k: 'ppe_note', l: 'Що саме є та чого бракує', pl: 'Уточнення', max: 300, req: is('ppe', 'Частково'),
      showIf: ['ppe', ['Є', 'Частково']], ph: 'наприклад: протигази — 4 шт., костюми — немає' },
  ] },
  { id: 'training', title: 'Підготовка персоналу', fields: [
    { k: 'training', l: 'Рівень підготовки осіб, які надаватимуть допомогу', pl: 'Підготовка персоналу', t: 'group', items: LEVELS, req: true,
      tip: 'Вкажіть кількість осіб для кожного рівня. Якщо таких немає — залиште поле порожнім. Потрібен хоча б один рівень або уточнення.' },
  ] },
];
export const POINT_FIELDS = POINT_GROUPS.flatMap(g => g.fields);

export const POSITION_FIELDS = [
  { k: 'name', l: 'Назва або позивний позиції', pl: 'Назва / позивний', v: 'name', max: 60, req: true },
  { k: 'coords', l: 'Приблизні координати позиції (MGRS)', pl: 'Координати', v: 'coords', req: true },
  { k: 'weight', l: 'Вага, яку можуть скидати, кг', pl: 'Вага скиду, кг', v: 'kg', req: true },
  { k: 'flight', l: 'Час підльоту до позиції переднього краю, хв', pl: 'Час підльоту, хв', v: 'min', req: true },
];

const roleSection = r => ({
  id: r.role, role: r.role, title: r.title, pt: r.short, note: r.note,
  fields: CONTACT.map(f => ({ ...f, k: `${r.role}_${f.k}` })),
});

// ---- Розділи даних ----
export const SECTIONS = [
  { id: 'general', title: 'Загальні дані', fields: [
    { k: 'unit', l: 'Підрозділ — коротка назва', pl: 'Підрозділ', v: 'unit', max: 12, req: true, ph: 'МР, 2МБ, 1 РОТА…',
      hint: 'Так, як підрозділ називають у документах. Назва автоматично запишеться великими літерами.' },
    { k: 'date', l: 'Дата актуальності даних', pl: 'Дата', t: 'date', req: true },
    { k: 'author', l: 'Позивний того, хто заповнив', pl: 'Заповнив(-ла)', v: 'callsign', max: 30, req: true },
  ] },
  ...ROLES.map(roleSection),
  { id: 'points', title: 'Точки передачі поранених', pt: 'Точки передачі поранених',
    list: { key: 'points', item: 'Точка', addText: 'точку', min: 1, groups: POINT_GROUPS, fields: POINT_FIELDS } },
  { id: 'drops', title: 'Позиції, які можуть здійснювати медичні скиди', pt: 'Позиції для медичних скидів',
    fields: [{ k: 'drops', l: 'Чи є в підрозділі позиції, які можуть здійснювати медичні скиди', pl: 'Чи є такі позиції', t: 'seg', o: OPT.yn, req: true }],
    list: { key: 'positions', item: 'Позиція', addText: 'позицію', min: 1, showIf: ['drops', ['Так']], fields: POSITION_FIELDS } },
  { id: 'algo', title: 'Алгоритм передачі медичних скидів', pt: 'Алгоритм медичних скидів',
    hint: 'Якщо позицій для скидів немає, але скиди для вашого підрозділу здійснюють інші — опишіть, як це відбувається.',
    fields: [
      { k: 'algo_carry', l: 'Хто везе й куди', pl: 'Хто везе й куди', t: 'area', max: 500, req: is('drops', 'Так') },
      { k: 'algo_hand', l: 'Хто передає (хто здійснює скид)', pl: 'Хто передає / скидає', t: 'area', max: 500, req: is('drops', 'Так') },
      { k: 'algo_time', l: 'Орієнтовний час від запиту до скиду, хв', pl: 'Від запиту до скиду, хв', v: 'min', req: is('drops', 'Так') },
      { k: 'algo_note', l: 'Додатково (за потреби)', pl: 'Додатково', t: 'area', max: 500 },
    ] },
  { id: 'mphelp', title: 'Можливості медичних пунктів щодо формування скидів', pt: 'Формування скидів медпунктами', fields: [
    { k: 'mp_help', l: 'Чи потрібна медпункту допомога у формуванні скидів', pl: 'Потрібна допомога', t: 'seg', o: OPT.yn, req: true },
    { k: 'mp_help_note', l: 'Яка саме допомога потрібна', pl: 'Яка саме', t: 'area', max: 400, req: true, showIf: ['mp_help', ['Так']] },
    { k: 'mp_std', l: 'Потреба в медичних скидах установленого зразка (наприклад, для пролонгованого догляду)', pl: 'Скиди встановленого зразка',
      t: 'seg', o: OPT.have, req: true },
    { k: 'mp_std_qty', l: 'Які саме та скільки', pl: 'Які саме, скільки', t: 'area', max: 400, req: true, showIf: ['mp_std', ['Є']],
      ph: 'наприклад: пролонгований догляд — 5 шт.' },
  ] },
];
export const sectionById = id => SECTIONS.find(s => s.id === id);
export const listDef = key => SECTIONS.find(s => s.list && s.list.key === key).list;

// ---- Кроки форми (екрани) ----
export const STEPS = [
  { id: 'general', title: 'Загальні дані', short: 'Загальне', sections: ['general'] },
  { id: 'kb', title: 'Черговий капітан бою', short: 'КБ', sections: ['kb'] },
  { id: 's4', title: 'Черговий S4', short: 'S4', sections: ['s4'] },
  { id: 'mp', title: 'Черговий медичного пункту', short: 'Медпункт', sections: ['mp'] },
  { id: 'points', title: 'Точки передачі поранених', short: 'Точки', sections: ['points'] },
  { id: 'drops', title: 'Медичні скиди', short: 'Скиди', sections: ['drops', 'algo'] },
  { id: 'mphelp', title: 'Можливості медпунктів', short: 'Медпункти', sections: ['mphelp'] },
  { id: 'check', title: 'Перевірка та звіт', short: 'Звіт', sections: [], final: true },
];
export const stepOfSection = id => STEPS.find(s => s.sections.includes(id));

// Ключі полів групи «підготовка» всередині елемента
export const groupKeys = f => [...f.items.map(([k]) => `${f.k}_${k}`), `${f.k}_other`];

// Чи поле видиме за поточних значень (item — об’єкт, у якому живе поле)
export const visible = (f, item) => !f.showIf || f.showIf[1].includes(item?.[f.showIf[0]]);
export const required = (f, item, data) => visible(f, item) && (typeof f.req === 'function' ? !!f.req(item, data) : !!f.req);

// Порожній документ
export const emptyData = () => ({ v: SCHEMA_VERSION, points: [{}], positions: [] });
