import type { CategoryId } from '../../shared/types.ts';

export const CATEGORY_TABS: Record<CategoryId, { icon: string; label: string | null; full: string }> = {
  attractions: { icon: '🎡', label: null, full: 'אטרקציות' },
  shopping: { icon: '🛍️', label: null, full: 'קניות' },
  rest_adi: { icon: '🍴', label: 'עדי', full: 'מסעדות עדי' },
  rest_tal: { icon: '🍴', label: 'טל', full: 'מסעדות טל' },
  rest_both: { icon: '🍴', label: 'שנינו', full: 'מסעדות משותפות' },
  uncategorized: { icon: '•', label: 'לא מסווג', full: 'לא מסווג' },
};

/** Black or white text, whichever reads better on the given background. */
export function textOn(hex: string | null): string {
  if (!hex) return 'var(--fg)';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? '#111' : '#fff';
}

// Used only to build a Google Maps search query; never shown as data.
const CITY_QUERY: Record<string, string> = {
  tokyo: 'Tokyo',
  fuji: 'Fujikawaguchiko',
  kyoto: 'Kyoto',
  osaka: 'Osaka',
};

export function mapsSearchUrl(name: string, cityId: string | null): string {
  const q = [name, cityId ? CITY_QUERY[cityId] : 'Japan'].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}`;
}
