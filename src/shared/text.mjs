// Дрібні текстові помічники, спільні для форми, звіту, плаката та тестів.

export const hasText = v => typeof v === 'string' && v.trim() !== '';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// 2026-10-31 → 31.10.2026 (усе інше повертається як є)
export const fmtDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v.split('-').reverse().join('.') : (v || '');

// Відмінювання «особа / особи / осіб»
export const people = n => {
  const a = n % 10, b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? 'особа' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'особи' : 'осіб'}`;
};

export const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};

// Транслітерація за правилами КМУ (постанова №55 від 27.01.2010) — для імен файлів,
// бо кирилиця в іменах завантажень ламається в частині браузерів і месенджерів.
const TR = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', ʼ: '', '’': '', "'": '',
  ё: 'e', ы: 'y', э: 'e', ъ: '' };
const TR_START = { є: 'ye', ї: 'yi', й: 'y', ю: 'yu', я: 'ya' };
export const translit = s => String(s).replace(/зг/gi, m => m[0] === 'З' ? 'Zgh' : 'zgh').replace(/[\p{Script=Cyrillic}ʼ’']/gu, (ch, i, str) => {
  const low = ch.toLowerCase(), start = i === 0 || !/[\p{L}]/u.test(str[i - 1]);
  const t = (start && TR_START[low]) || TR[low] || '';
  return ch === low ? t : t.charAt(0).toUpperCase() + t.slice(1);
});

// Безпечна ASCII-назва файла: латиниця/цифри/крапка/дефіс/підкреслення
export const safeFileName = s => translit(s).replace(/[\\/:*?"<>|\s]+/g, '_').replace(/[^A-Za-z0-9._-]/g, '').replace(/_+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 80);

// Поточна дата в локальному часі у форматі YYYY-MM-DD (toISOString дає UTC і вночі «зсуває» день)
export const todayISO = (now = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
};

export const daysBetween = (isoA, isoB) => Math.round((Date.parse(isoB) - Date.parse(isoA)) / 86400000);
