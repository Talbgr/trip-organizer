import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKBOOK, importWorkbook } from '../importer/cli.ts';
import { categorize, isGreen, isRed } from '../importer/interpret.ts';
import { readNumbers09, type Rgb } from '../importer/numbers09.ts';

const tables = readNumbers09(readFileSync(DEFAULT_WORKBOOK));
const { trip, notes } = importWorkbook();
// Independent reading of the same file by LibreOffice (see tools/make-oracle.py).
const oracle: { cells: Record<string, { text: string | null; fill: string | null }> }[] = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/oracle.json'), 'utf8'),
);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const hexToRgb = (h: string): Rgb => ({
  r: parseInt(h.slice(1, 3), 16) / 255,
  g: parseInt(h.slice(3, 5), 16) / 255,
  b: parseInt(h.slice(5, 7), 16) / 255,
});

describe('Numbers reader agrees with an independent conversion', () => {
  it('reads every text cell at the same position with the same text', () => {
    let checked = 0;
    const mismatches: string[] = [];
    oracle.forEach((sheet, i) => {
      for (const [key, v] of Object.entries(sheet.cells)) {
        if (v.text == null) continue;
        const [r, c] = key.split(',').map(Number) as [number, number];
        const cell = tables[i]!.cells[r]?.[c];
        if (cell?.date != null) continue; // LibreOffice exports dates as serial numbers
        checked++;
        const mine = cell?.number != null ? Number(cell.number) : norm(cell?.text ?? '');
        const theirs = cell?.number != null ? Number(v.text) : norm(v.text);
        // LibreOffice repeats a hyperlink paragraph that Numbers stores once with an empty twin.
        if (typeof theirs === 'string' && typeof mine === 'string' && theirs === `${mine} ${mine}` && mine.startsWith('http')) continue;
        if (mine !== theirs) mismatches.push(`table ${i} ${key}: ${JSON.stringify(mine)} vs ${JSON.stringify(theirs)}`);
      }
    });
    expect(checked).toBeGreaterThan(1000);
    expect(mismatches).toEqual([]);
  });

  it('classifies red and green cells the same way', () => {
    const differences: string[] = [];
    oracle.forEach((sheet, i) => {
      for (const [key, v] of Object.entries(sheet.cells)) {
        const [r, c] = key.split(',').map(Number) as [number, number];
        // Row 0 holds table titles, whose colors are never read as markings (and the two
        // readers convert some title greens slightly differently).
        if (r === 0) continue;
        const mine = tables[i]!.cells[r]?.[c]?.fill ?? null;
        const theirs = v.fill ? hexToRgb(v.fill) : null;
        if (isRed(mine) !== isRed(theirs) || isGreen(mine) !== isGreen(theirs)) differences.push(`table ${i} ${key}`);
      }
    });
    expect(differences).toEqual([]);
  });
});

describe('trip structure', () => {
  it('places every piece of workbook text somewhere', () => {
    expect(notes.filter((n) => n.includes('text not placed'))).toEqual([]);
  });

  it('has the four cities in trip order', () => {
    expect(trip.cities.map((c) => c.name)).toEqual(['טוקיו', 'פוג׳י', 'קיוטו', 'אוסקה']);
  });

  it('keeps cities separate even when colors repeat (Akihabara and Kyoto share a blue)', () => {
    const tokyo = trip.cities.find((c) => c.id === 'tokyo')!;
    const kyoto = trip.cities.find((c) => c.id === 'kyoto')!;
    const aki = tokyo.neighborhoods.find((n) => n.title === 'אקיהברה')!;
    expect(kyoto.neighborhoods.every((n) => n.color === aki.color)).toBe(true);
    expect(kyoto.neighborhoods.map((n) => n.title)).toEqual(['11.11', '12.11', '13.11', '14.11', '15.11']);
    expect(tokyo.neighborhoods.some((n) => n.title.includes('.11'))).toBe(false);
  });

  it('tags Tokyo neighborhoods with their part, Ginza in part 2', () => {
    const tokyo = trip.cities.find((c) => c.id === 'tokyo')!;
    expect(tokyo.neighborhoods.find((n) => n.title === 'גינזה')!.part).toBe('טוקיו חלק 2');
    expect(tokyo.neighborhoods.find((n) => n.title === 'שינג׳וקו')!.part).toBe('טוקיו חלק 1');
  });

  it('splits 15.11 between Kyoto (blue part) and Osaka (orange part)', () => {
    const kyoto15 = trip.cities.find((c) => c.id === 'kyoto')!.neighborhoods.find((n) => n.title === '15.11')!;
    const osaka15 = trip.cities.find((c) => c.id === 'osaka')!.neighborhoods.find((n) => n.title === '15.11')!;
    expect(kyoto15.sections.flatMap((s) => s.items.map((i) => i.name))).toContain('Nishiki Market');
    expect(osaka15.sections.flatMap((s) => s.items.map((i) => i.name))).toContain('Dotonbori');
    expect(osaka15.sections.map((s) => s.category)).toEqual(['attractions', 'shopping', 'rest_adi', 'rest_tal', 'rest_both']);
  });

  it('maps section headers to the agreed categories', () => {
    expect(categorize('מסעדות כשרות/טבעוניות')).toBe('rest_adi');
    expect(categorize('מסעדות עדי')).toBe('rest_adi');
    expect(categorize('מסעדות לטל')).toBe('rest_tal');
    expect(categorize('מסעדות טל')).toBe('rest_tal');
    expect(categorize('מסעדות משותפות')).toBe('rest_both');
    expect(categorize('אטרקציות יום 3')).toBe('attractions');
    expect(categorize('קניות')).toBe('shopping');
    expect(categorize('ARASHIYAMA')).toBe('uncategorized');
  });

  it('does not show the kosher/vegan header as a subtitle', () => {
    const all = trip.cities.flatMap((c) => c.neighborhoods.flatMap((n) => n.sections));
    expect(all.some((s) => s.subtitle === 'מסעדות כשרות/טבעוניות')).toBe(false);
    expect(all.some((s) => s.subtitle === 'אטרקציות יום 2')).toBe(true);
  });

  it('collects exactly the red-filled items as reminders, merged by name', () => {
    expect(trip.reminders.map((r) => r.name).sort()).toEqual(
      ['Fujikyu-Highland Station', 'Godaime Hanayama Udon Ginza', 'HOZUGAWA BOAT', 'Hikiniku to Come Shibuya', 'Kyoto', 'Maguro Mart'].sort(),
    );
    const maguro = trip.reminders.find((r) => r.name === 'Maguro Mart')!;
    expect(maguro.places.map((p) => p.city)).toEqual(['טוקיו', 'נסיעות ואטרקציות']);
  });

  it('marks the green "הוזמן" restaurants as booked', () => {
    const booked = trip.general.sections.flatMap((s) => s.rows).filter((r) => r.marking === 'booked');
    expect(booked.map((b) => b.name)).toEqual(['Gonpachi', 'EBISU SUSHI KENSHIN']);
  });

  it('reads the itinerary with dates, hotels and prices', () => {
    const it = trip.itinerary;
    expect(it.days).toHaveLength(43);
    expect(it.days[0]).toMatchObject({ date: '2026-11-03', day: 'יום 1', location: 'טוקיו' });
    expect(it.days[1]!.stay).toBe(0);
    expect(it.stays[0]).toMatchObject({ price: '2496' });
    expect(it.stays[0]!.hotel).toContain('Amanek');
    expect(it.days.at(-1)).toMatchObject({ activity: 'טיסה חזור' });
  });

  it('keeps names and notes verbatim', () => {
    const shinjuku = trip.cities[0]!.neighborhoods.find((n) => n.title === 'שינג׳וקו')!;
    const gyoza = shinjuku.sections.flatMap((s) => s.items).find((i) => i.name === 'Shinjuku Hikeshi Gyoza')!;
    expect(gyoza).toMatchObject({ description: 'גיוזה+ מנות יפניות (פתוח 24/7)', info: { label: 'עלות', value: '$$-$' } });
  });

  it('data/trip.json is up to date with the workbook (run `npm run import`)', () => {
    const committed = JSON.parse(readFileSync(resolve(__dirname, '../data/trip.json'), 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(trip)));
  });
});
