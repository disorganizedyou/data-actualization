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
//   showIf   [ключ, [значення…]] — показувати лише коли інше поле має одне зі значень;
//            або функція (item) => boolean для складніших умов
//   max      максимальна довжина
//   ph       плейсхолдер
//   hint     підказка під полем

export const SCHEMA_VERSION = 3;
export const NONE = 'Немає';
export const TITLE = 'Актуалізація даних для медичної служби';
export const FORM_NAME = 'Анкета актуалізації даних';

export const OPT = {
  yn: ['Так', 'Ні'],
  ypn: ['Так', 'Частково', 'Ні'],
  have: ['Є', 'Немає'],
  havePart: ['Є', 'Частково', 'Немає'],
  supply: ['Повна', 'Часткова', 'Немає'],
  net: ['Є, стабільний', 'Є, нестабільний', 'Немає'],
};

// Рівні підготовки: [ключ, повна назва, коротка назва]
export const LEVELS = [
  ['asm', 'ASM — базовий курс TCCC', 'Базова (ASM)'],
  ['cls', 'CLS — Combat Lifesaver', 'CLS'],
  ['cmc', 'CMC — Combat Medic / Corpsman', 'CMC'],
  ['cpp', 'CPP — Combat Paramedic / Provider', 'CPP'],
  ['med', 'Медична освіта (фельдшер, медсестра / медбрат, лікар)', 'Медосвіта'],
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
    note: 'Черговий медпункту має бути на зв’язку цілодобово', badge: 'cross', color: '#e30613' },
];

export const CONTACTS_NOTE = 'Вказуйте лише службові контакти чергової зміни: номери й акаунти, якими користується будь-хто на черговій зміні. '
  + 'Особисті контакти не вказуйте.';

const is = (key, ...values) => it => values.includes(it?.[key]);
// Скиди для підрозділу відбуваються: з власних позицій або силами інших підрозділів
export const dropsDone = d => d?.drops === 'Так' || (d?.drops === 'Ні' && d?.drops_other === 'Так');
// Обидві відповіді «Ні» — скидів для підрозділу немає взагалі
export const noDrops = d => d?.drops === 'Ні' && d?.drops_other === 'Ні';

// ---- Точка передачі поранених: поля згруповані для зручності заповнення ----
export const POINT_GROUPS = [
  { id: 'loc', title: 'Розташування', fields: [
    { k: 'name', l: 'Назва або орієнтир точки', pl: 'Назва / орієнтир', v: 'name', max: 60, req: true, ph: 'наприклад: «Сосна», підвал біля школи' },
    { k: 'coords', l: 'Координати точки (MGRS)', pl: 'Координати', v: 'coords', req: true },
  ] },
  { id: 'link', title: 'Зв’язок', fields: [
    { k: 'contact', l: 'Як зв’язатися з точкою', pl: 'Зв’язок з точкою', t: 'area', max: 300, req: true,
      ph: 'позивний, телефон або месенджер, частота' },
    { k: 'net', l: 'Інтернет на точці', pl: 'Інтернет', t: 'seg', o: OPT.net, req: true },
    { k: 'net_note', l: 'Тип підключення', pl: 'Тип підключення', max: 100, req: true,
      showIf: ['net', ['Є, стабільний', 'Є, нестабільний']], ph: 'мобільний інтернет, Starlink…' },
  ] },
  { id: 'supply', title: 'Медичне майно', fields: [
    { k: 'supplied', l: 'Забезпеченість медичним майном', pl: 'Забезпеченість майном', t: 'seg', o: OPT.supply, req: true },
    { k: 'supplied_note', l: 'Чого бракує і скільки потрібно', pl: 'Чого бракує, скільки', t: 'area', max: 400, req: true,
      showIf: ['supplied', ['Часткова', 'Немає']], ph: 'наприклад: турнікети — 10 шт.' },
  ] },
  { id: 'nrk', title: 'НРК — наземний роботизований комплекс', fields: [
    { k: 'nrk', l: 'Чи є НРК на точці', pl: 'НРК', t: 'seg', o: OPT.have, req: true },
    { k: 'nrk_count', l: 'Кількість НРК', pl: 'Кількість НРК', v: 'count', min: 1, max: 3, req: true, showIf: ['nrk', ['Є']] },
    { k: 'nrk_reb', l: 'Чи обладнані засобами РЕБ', pl: 'РЕБ', t: 'seg', o: OPT.ypn, req: true, showIf: ['nrk', ['Є']] },
    { k: 'nrk_cam', l: 'Чи обладнані камерою', pl: 'Камера', t: 'seg', o: OPT.ypn, req: true, showIf: ['nrk', ['Є']] },
    { k: 'nrk_mic', l: 'Чи обладнані мікрофоном', pl: 'Мікрофон', t: 'seg', o: OPT.ypn, req: true, showIf: ['nrk', ['Є']] },
    { k: 'nrk_note', l: 'Модель, уточнення', pl: 'Уточнення', max: 200, showIf: ['nrk', ['Є']], ph: 'наприклад: модель, стан' },
  ] },
  { id: 'hypo', title: 'Засоби проти гіпотермії', fields: [
    { k: 'hypo_heat', l: 'Хімічні грілки', pl: 'Хімічні грілки', t: 'seg', o: OPT.have, req: true },
    { k: 'hypo_bag', l: 'Спальники', pl: 'Спальники', t: 'seg', o: OPT.have, req: true },
    { k: 'hypo_ready', l: 'Ковдри, що самонагріваються (Ready-Heat)', pl: 'Ready-Heat', t: 'seg', o: OPT.have, req: true },
    { k: 'hypo_note', l: 'Кількість, уточнення', pl: 'Уточнення', max: 200, ph: 'наприклад: грілки — 20 шт.' },
  ] },
  { id: 'ppe', title: 'Засоби хімзахисту', fields: [
    { k: 'ppe', l: 'Засоби хімзахисту на точці', pl: 'Хімзахист', t: 'seg', o: OPT.havePart, req: true },
    { k: 'ppe_note', l: 'Що саме є та чого бракує', pl: 'Уточнення', max: 300, req: is('ppe', 'Частково'),
      showIf: ['ppe', ['Є', 'Частково']], ph: 'наприклад: протигази — 4 шт., костюми — немає' },
  ] },
  { id: 'training', title: 'Підготовка персоналу', fields: [
    { k: 'training', l: 'Скільки осіб на точці мають медичну підготовку', pl: 'Підготовка персоналу', t: 'group', items: LEVELS, req: true,
      tip: 'Кожну особу рахуйте один раз — за найвищим рівнем. Порожнє поле означає «0». Заповніть хоча б один рівень або поле «Інше або уточнення».' },
  ] },
];
export const POINT_FIELDS = POINT_GROUPS.flatMap(g => g.fields);

export const POSITION_FIELDS = [
  { k: 'name', l: 'Назва або позивний позиції', pl: 'Назва / позивний', v: 'name', max: 60, req: true },
  { k: 'coords', l: 'Приблизні координати позиції (MGRS)', pl: 'Координати', v: 'coords', req: true },
  { k: 'weight', l: 'Максимальна вага скиду, кг', pl: 'Вага скиду, кг', v: 'kg', req: true },
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
      hint: 'Як у документах. Великі літери з’являться автоматично.' },
    { k: 'date', l: 'Дата актуальності даних', pl: 'Дата', t: 'date', req: true },
    { k: 'author', l: 'Ваш позивний', pl: 'Заповнив(-ла)', v: 'callsign', max: 30, req: true },
  ] },
  ...ROLES.map(roleSection),
  { id: 'points', title: 'Точки передачі поранених', pt: 'Точки передачі поранених',
    list: { key: 'points', item: 'Точка', addText: 'точку', min: 1, groups: POINT_GROUPS, fields: POINT_FIELDS } },
  { id: 'drops', title: 'Позиції, з яких можуть здійснювати медичні скиди', pt: 'Позиції для медичних скидів',
    fields: [
      { k: 'drops', l: 'Чи є в підрозділі позиції, з яких можна здійснювати медичні скиди', pl: 'Чи є такі позиції', t: 'seg', o: OPT.yn, req: true },
      { k: 'drops_other', l: 'Чи здійснюють медичні скиди для вашого підрозділу інші підрозділи', pl: 'Скиди здійснюють інші', t: 'seg', o: OPT.yn, req: true,
        showIf: ['drops', ['Ні']] },
    ],
    list: { key: 'positions', item: 'Позиція', addText: 'позицію', min: 1, showIf: ['drops', ['Так']], fields: POSITION_FIELDS } },
  { id: 'algo', title: 'Як відбувається медичний скид', pt: 'Як відбувається медичний скид', showIf: dropsDone,
    fields: [
      { k: 'algo_carry', l: 'Хто доставляє вантаж до місця скиду і куди саме', pl: 'Хто доставляє й куди', t: 'area', max: 500, req: true, showIf: dropsDone },
      { k: 'algo_hand', l: 'Хто здійснює скид', pl: 'Хто здійснює скид', t: 'area', max: 500, req: true, showIf: dropsDone },
      { k: 'algo_time', l: 'Орієнтовний час від запиту до скиду, хв', pl: 'Від запиту до скиду, хв', v: 'min', req: true, showIf: dropsDone },
      { k: 'algo_note', l: 'Додатково', pl: 'Додатково', t: 'area', max: 500, showIf: dropsDone },
    ] },
  { id: 'mphelp', title: 'Формування скидів медпунктом', pt: 'Формування скидів медпунктом', fields: [
    { k: 'mp_help', l: 'Чи потрібна медпункту допомога у формуванні скидів', pl: 'Потрібна допомога', t: 'seg', o: OPT.yn, req: true },
    { k: 'mp_help_note', l: 'Яка саме допомога потрібна', pl: 'Яка саме', t: 'area', max: 400, req: true, showIf: ['mp_help', ['Так']] },
    { k: 'mp_std', l: 'Чи потрібні медпункту скиди встановленого зразка (наприклад, для пролонгованого догляду)', pl: 'Скиди встановленого зразка',
      t: 'seg', o: OPT.yn, req: true },
    { k: 'mp_std_qty', l: 'Які саме та скільки', pl: 'Які саме, скільки', t: 'area', max: 400, req: true, showIf: ['mp_std', ['Так']],
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
  { id: 'mphelp', title: 'Медпункт і скиди', short: 'Скиди МП', sections: ['mphelp'] },
  { id: 'check', title: 'Перевірка та звіт', short: 'Звіт', sections: [], final: true },
];
export const stepOfSection = id => STEPS.find(s => s.sections.includes(id));

// Ключі полів групи «підготовка» всередині елемента
export const groupKeys = f => [...f.items.map(([k]) => `${f.k}_${k}`), `${f.k}_other`];

// Чи поле видиме за поточних значень (item — об’єкт, у якому живе поле)
export const visible = (f, item) => !f.showIf
  || (typeof f.showIf === 'function' ? !!f.showIf(item) : f.showIf[1].includes(item?.[f.showIf[0]]));
export const required = (f, item, data) => visible(f, item) && (typeof f.req === 'function' ? !!f.req(item, data) : !!f.req);

// Порожній документ
export const emptyData = () => ({ v: SCHEMA_VERSION, points: [{}], positions: [] });
