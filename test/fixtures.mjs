// Повністю заповнена коректна анкета (значення — вже у нормалізованому вигляді, крім того, що тести вводять «сирим»).
export const FULL = {
  unit: '2МБ', date: '2026-10-30', author: 'Сокіл',
  kb_callsign: 'Беркут', kb_phone: '+380 67 123 45 67', kb_signal: 'berkut.07', kb_element: 'berkut', kb_discord: 'Немає',
  s4_callsign: 'Тил', s4_phone: '+380 50 765 43 21', s4_signal: 'Немає', s4_element: 'tyl2', s4_discord: 'tyl_2mb',
  mp_callsign: 'Док', mp_phone: '+380 93 111 22 33', mp_signal: '+380 93 111 22 33', mp_element: 'doc.2mb', mp_discord: 'Немає',
  points: [
    { name: 'Сосна', coords: '37U DQ 12345 67890', contact: 'позивний Сосна, 149.500', net: 'Є, нестабільна', net_note: 'мобільний інтернет',
      supplied: 'Частково', supplied_note: 'бракує турнікетів і оклюзійних наліпок', need: 'Є', need_note: 'турнікети — 10 шт., наліпки — 6 шт.',
      nrk: 'Є', nrk_count: '2', nrk_reb: 'Частково', nrk_cam: 'Так', nrk_mic: 'Ні', nrk_note: 'Термінатор',
      hypo_heat: 'Є', hypo_bag: 'Немає', hypo_ready: 'Є', hypo_note: 'грілки — 20 шт.',
      ppe: 'Частково', ppe_note: 'протигази — 4 шт., костюми — немає',
      training_asm: '6', training_cls: '2', training_other: '1 водій пройшов курс зупинки кровотечі' },
    { name: 'Школа', coords: '37U DQ 22222 33333', contact: 'Школа, WhatsApp +380 97 000 11 22', net: 'Немає',
      supplied: 'Так', need: 'Немає',
      nrk: 'Немає',
      hypo_heat: 'Є', hypo_bag: 'Є', hypo_ready: 'Немає',
      ppe: 'Є',
      training_cmc: '1', training_med: '1' },
  ],
  drops: 'Так',
  positions: [
    { name: 'Птах-1', coords: '37U DQ 11111 22222', weight: '2,5', flight: '12' },
    { name: 'Птах-2', coords: '37U DQ 11111 44444', weight: '6', flight: '20' },
  ],
  algo_carry: 'Медик роти везе на позицію Птах-1', algo_hand: 'Оператор Птах-1', algo_time: '40',
  mp_help: 'Так', mp_help_note: 'потрібні термоковдри й пакування', mp_std: 'Є', mp_std_qty: 'пролонгований догляд — 5 шт.',
};

// Той самий звіт у форматі старої форми (версія 1): без НРК/гіпотермії/хімзахисту, деякі значення «сирі»
export const LEGACY_V1 = {
  unit: '2МБ', date: '2026-09-01', author: 'Сокіл',
  kb_callsign: 'Беркут', kb_phone: '+380 67 123 45 67', kb_signal: 'berkut.07', kb_element: 'berkut', kb_discord: 'Немає',
  s4_callsign: 'Тил', s4_phone: '+380 50 765 43 21', s4_signal: 'Немає', s4_element: 'tyl2', s4_discord: 'tyl_2mb',
  mp_callsign: 'Док', mp_phone: '+380 93 111 22 33', mp_signal: '+380 93 111 22 33', mp_element: 'doc.2mb', mp_discord: 'Немає',
  points: [{ name: 'Сосна', coords: '37U DQ 12345 67890', net: 'Є, нестабільна', net_note: 'мобільний', contact: 'Сосна', supplied: 'Так', supplied_note: 'застаріле значення — має зникнути',
    training_asm: '6', training_cls: '0', training_cmc: '', training_cpp: '', training_med: '', training_other: '', need: 'Немає', need_note: 'застаріле — має зникнути' }],
  drops: 'Ні',
  positions: [{ name: 'приховано бо drops=Ні', coords: '37U DQ 11111 22222', weight: '2.5', flight: '12' }],
  algo_carry: '', algo_hand: '', algo_time: '', algo_note: '',
  mp_help: 'Ні', mp_help_note: '', mp_std: 'Немає', mp_std_qty: '',
};
