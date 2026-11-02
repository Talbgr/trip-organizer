// Turns the raw grids from `numbers09.ts` into the Trip structure the app shows.
// Rules (agreed with Tal & Adi before the build):
//  - Text, names, notes and links are copied verbatim (only surrounding whitespace is trimmed).
//  - A row is "needs attention" only if one of its cells has a red fill; green fill = already booked.
//  - Section headers map to the five categories; anything else stays "uncategorized".
//  - Nothing is merged across cities; city membership comes from layout.ts.
// Everything unusual is collected in `notes` and written to docs/data-report.md.

import { createHash } from 'node:crypto';
import type {
  CategoryId,
  City,
  GeneralSection,
  Item,
  Itinerary,
  Marking,
  Neighborhood,
  Reminder,
  Section,
  Stay,
  Trip,
} from '../shared/types.ts';
import { CITIES, PLACEMENT } from './layout.ts';
import { numbersDateToIso, rgbHex, type Cell, type Rgb, type Table } from './numbers09.ts';

export interface ImportResult {
  trip: Trip;
  notes: string[];
}

const clean = (s: string | undefined | null) => (s ?? '').trim();

/** Cell display text: numbers keep their stored value but drop float noise (16.109999 → 16.11). */
function cellText(c: Cell | null | undefined): string {
  if (!c) return '';
  if (c.number != null) return String(Number(Number(c.number).toPrecision(12)));
  if (c.date != null) return numbersDateToIso(c.date);
  return clean(c.text);
}

export function isRed(c: Rgb | null): boolean {
  return !!c && c.r > 0.85 && c.g < 0.5 && c.b < 0.5;
}
export function isGreen(c: Rgb | null): boolean {
  return !!c && c.g > c.r + 0.18 && c.g > c.b + 0.18 && c.r < 0.6;
}

const CATEGORY_BY_HEADER: Array<[RegExp, CategoryId]> = [
  [/^אטרקציות(\s|$)/, 'attractions'],
  [/^קניות$/, 'shopping'],
  [/^מסעדות עדי$/, 'rest_adi'],
  [/^מסעדות כשרות\/טבעוניות$/, 'rest_adi'], // agreed: these are Adi's restaurants
  [/^מסעדות (ל)?טל$/, 'rest_tal'],
  [/^מסעדות משותפות$/, 'rest_both'],
];
/** Header texts that are just the category's own name (no need to repeat them in the UI). */
const PLAIN_HEADERS = new Set(['אטרקציות', 'קניות', 'מסעדות עדי', 'מסעדות כשרות/טבעוניות', 'מסעדות לטל', 'מסעדות טל', 'מסעדות משותפות']);

export function categorize(header: string): CategoryId {
  for (const [re, id] of CATEGORY_BY_HEADER) if (re.test(header)) return id;
  return 'uncategorized';
}

const COLUMN_HEADER_WORDS = /^(עלות|תיאור|שם |סוג |מרחק|זמן הליכה|מיקום|מה רואים)/;

class Consumed {
  private seen = new Set<string>();
  constructor(private table: Table) {}
  mark(r: number, c: number) {
    this.seen.add(`${r},${c}`);
  }
  markRow(r: number) {
    for (let c = 0; c < this.table.numCols; c++) this.mark(r, c);
  }
  leftovers(): string[] {
    const out: string[] = [];
    this.table.cells.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (cell && cellText(cell) && !this.seen.has(`${r},${c}`)) out.push(`r${r + 1}c${c + 1}: "${cellText(cell)}"`);
      }),
    );
    return out;
  }
}

function rowCells(t: Table, r: number): (Cell | null)[] {
  return t.cells[r] ?? [];
}
function isFullSpan(t: Table, r: number): boolean {
  const first = rowCells(t, r)[0];
  return !!first && first.colSpan >= t.numCols && cellText(first) !== '';
}
function isColumnHeaderRow(t: Table, r: number): boolean {
  if (r >= t.numRows) return false;
  const texts = rowCells(t, r).map(cellText).filter(Boolean);
  return texts.length > 0 && texts.every((x) => COLUMN_HEADER_WORDS.test(x));
}
function rowIsEmpty(t: Table, r: number): boolean {
  return rowCells(t, r).every((c) => !cellText(c) && !(c?.links.length));
}
function rowMarking(t: Table, r: number): Marking | null {
  const cells = rowCells(t, r).filter((c): c is Cell => !!c);
  if (cells.some((c) => isRed(c.fill))) return 'attention';
  if (cells.some((c) => isGreen(c.fill))) return 'booked';
  return null;
}

interface RawSection {
  title: string;
  color: string | null;
  columns: string[];
  rows: number[];
}

/** Splits a "title row + [section header, column header, rows...]*" table into sections. */
function splitSections(t: Table, used: Consumed): { title: string; color: string | null; sections: RawSection[] } {
  const titleCell = rowCells(t, 0)[0] ?? null;
  used.markRow(0);
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  for (let r = 1; r < t.numRows; r++) {
    if (rowIsEmpty(t, r)) {
      used.markRow(r);
      continue;
    }
    const fullSpan = isFullSpan(t, r);
    const headerFollows = isColumnHeaderRow(t, r + 1);
    const first = rowCells(t, r)[0];
    // A full-width row is a section header when column headers follow it, or when it is
    // colored (the "טפסים" checklist rows are full-width too, but plain and header-less).
    const coloredHeader = !!first?.fill && !isGreen(first.fill) && !isRed(first.fill);
    if (fullSpan && (headerFollows || coloredHeader)) {
      current = { title: cellText(first), color: rgbHex(first?.fill ?? null), columns: [], rows: [] };
      sections.push(current);
      used.markRow(r);
      if (headerFollows) {
        const hdr = rowCells(t, r + 1);
        current.columns = [cellText(hdr[0]), cellText(hdr[1]), cellText(hdr[t.numCols - 1])];
        used.markRow(r + 1);
        r++;
      }
      continue;
    }
    if (isColumnHeaderRow(t, r) && current && current.rows.length === 0 && current.columns.length === 0) {
      const hdr = rowCells(t, r);
      current.columns = [cellText(hdr[0]), cellText(hdr[1]), cellText(hdr[t.numCols - 1])];
      used.markRow(r);
      continue;
    }
    if (!current) {
      current = { title: '', color: null, columns: [], rows: [] };
      sections.push(current);
    }
    current.rows.push(r);
  }
  return { title: cellText(titleCell), color: rgbHex(titleCell?.fill ?? null), sections };
}

function readItem(t: Table, r: number, columns: string[], used: Consumed): Item {
  const cells = rowCells(t, r);
  const last = t.numCols - 1;
  const links = cells.flatMap((c) => c?.links ?? []);
  const first = cells[0];
  let info: Item['info'] = null;
  let description = '';
  let name = '';
  if (first && first.colSpan >= t.numCols) {
    // A single full-width cell (e.g. the "טפסים" checklist): the text is the item.
    name = cellText(first);
  } else {
    const v0 = cellText(cells[0]);
    if (v0) info = { label: columns[0] ?? '', value: v0 };
    description = cellText(cells[1]);
    name = cellText(cells[last]);
  }
  used.mark(r, 0);
  used.mark(r, 1);
  used.mark(r, last);
  return {
    id: `t${t.index}:r${r}`,
    name,
    description,
    info,
    links: [...new Set(links)],
    marking: rowMarking(t, r),
    reminderKey: null,
  };
}

export const reminderKeyFor = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

function readItinerary(t: Table, used: Consumed, notes: string[]): Itinerary {
  used.markRow(0);
  const headerRow = rowCells(t, 1);
  const col = (label: string) => {
    const i = headerRow.findIndex((c) => cellText(c) === label);
    if (i < 0) throw new Error(`itinerary: column "${label}" not found`);
    return i;
  };
  const c = {
    price: col('מחיר בשקלים'),
    hotel: col('תשלום מלון'),
    location: col('מיקום'),
    activity: col('פעילות'),
    day: col('יום'),
    date: col('תאריך'),
  };
  used.markRow(1);
  const stays: Stay[] = [];
  const days: Itinerary['days'] = [];
  let stayUntil = -1;
  for (let r = 2; r < t.numRows; r++) {
    const row = rowCells(t, r);
    const hotelCell = row[c.hotel];
    if (hotelCell && cellText(hotelCell)) {
      stays.push({
        hotel: cellText(hotelCell),
        price: cellText(row[c.price]),
        color: rgbHex(hotelCell.fill),
      });
      stayUntil = r + hotelCell.rowSpan - 1;
    }
    const inStay = r <= stayUntil;
    const dateCell = row[c.date];
    days.push({
      date: dateCell?.date != null ? numbersDateToIso(dateCell.date) : null,
      day: cellText(row[c.day]),
      location: cellText(row[c.location]),
      activity: cellText(row[c.activity]),
      links: [...new Set(row.flatMap((x) => x?.links ?? []))],
      color: rgbHex(row[c.location]?.fill ?? null),
      stay: inStay ? stays.length - 1 : null,
    });
    used.markRow(r);
  }
  if (!days.length) notes.push('Itinerary table has no rows.');
  return {
    title: cellText(rowCells(t, 0).find((x) => cellText(x))),
    headers: {
      date: cellText(headerRow[c.date]),
      day: cellText(headerRow[c.day]),
      activity: cellText(headerRow[c.activity]),
      location: cellText(headerRow[c.location]),
      hotel: cellText(headerRow[c.hotel]),
      price: cellText(headerRow[c.price]),
    },
    days,
    stays,
  };
}

export function interpret(tables: Table[], source: { file: string; bytes: Uint8Array }): ImportResult {
  const notes: string[] = [];
  const used = new Map<Table, Consumed>();
  const usedOf = (t: Table) => {
    if (!used.has(t)) used.set(t, new Consumed(t));
    return used.get(t)!;
  };

  const nonEmpty = tables.filter((t) => t.cells.some((row) => row.some((c) => cellText(c))));
  const skipped = tables.length - nonEmpty.length;
  if (skipped) notes.push(`${skipped} empty table(s) in the file were ignored (Numbers template leftovers with no text).`);

  // --- classify tables -------------------------------------------------------
  const itineraryTable = nonEmpty.find((t) => rowCells(t, 1).some((c) => cellText(c) === 'תאריך'));
  if (!itineraryTable) throw new Error('Could not find the itinerary table (header "תאריך").');
  const generalTable = nonEmpty.find((t) => cellText(rowCells(t, 0)[0]) === 'נסיעות ואטרקציות');
  if (!generalTable) throw new Error('Could not find the "נסיעות ואטרקציות" table.');

  const labelTables = nonEmpty.filter((t) => t.numRows === 1 && t !== itineraryTable && t !== generalTable);
  const labels = new Map(labelTables.map((t) => [cellText(rowCells(t, 0)[0]), t]));
  for (const t of labelTables) usedOf(t).markRow(0);
  for (const city of CITIES)
    for (const l of city.labels) if (!labels.has(l)) throw new Error(`City label "${l}" not found in the workbook.`);
  for (const l of labels.keys())
    if (!CITIES.some((c) => c.labels.includes(l))) throw new Error(`Workbook has a city label "${l}" that layout.ts does not know.`);

  const neighborhoodTables = nonEmpty.filter((t) => t !== itineraryTable && t !== generalTable && !labelTables.includes(t));
  const seenTitles = new Set<string>();
  for (const t of neighborhoodTables) {
    const title = cellText(rowCells(t, 0)[0]);
    if (!PLACEMENT[title]) throw new Error(`Table "${title}" is not placed in layout.ts — which city is it under?`);
    seenTitles.add(title);
  }
  for (const title of Object.keys(PLACEMENT))
    if (!seenTitles.has(title)) throw new Error(`layout.ts places "${title}" but the workbook has no such table.`);

  // --- neighborhoods -----------------------------------------------------------
  const cityByLabel = new Map(CITIES.flatMap((c) => c.labels.map((l) => [l, c] as const)));
  const cities: City[] = CITIES.map((c) => ({ id: c.id, name: c.name, neighborhoods: [] }));
  const cityById = new Map(cities.map((c) => [c.id, c]));

  const toSection = (t: Table, s: RawSection, u: Consumed): Section => {
    const category = categorize(s.title);
    if (category === 'uncategorized')
      notes.push(`"${cellText(rowCells(t, 0)[0])}": section "${s.title || '(no header)'}" is not one of the five categories → shown as "לא מסווג".`);
    return {
      title: s.title,
      subtitle: s.title && !PLAIN_HEADERS.has(s.title) ? s.title : null,
      category,
      color: s.color,
      items: s.rows.map((r) => readItem(t, r, s.columns, u)),
    };
  };

  for (const t of neighborhoodTables) {
    const u = usedOf(t);
    const { title, color, sections } = splitSections(t, u);
    const place = PLACEMENT[title]!;
    const parts: Array<{ label: string; sections: RawSection[]; idSuffix: string; color: string | null }> = [];
    if (place.splitFromSection) {
      const { index, label } = place.splitFromSection;
      parts.push({ label: place.label, sections: sections.slice(0, index), idSuffix: '', color });
      const moved = sections.slice(index);
      // The moved part keeps its own section color (the title row's color belongs to the first city).
      parts.push({ label, sections: moved, idSuffix: `-${cityByLabel.get(label)!.id}`, color: moved[0]?.color ?? color });
      notes.push(
        `"${title}" is split: sections 1–${index} → ${place.label}, sections ${index + 1}–${sections.length} (${moved
          .map((s) => s.title)
          .join(', ')}) → ${label}.`,
      );
    } else parts.push({ label: place.label, sections, idSuffix: '', color });

    for (const p of parts) {
      const cityDef = cityByLabel.get(p.label)!;
      const city = cityById.get(cityDef.id)!;
      const n: Neighborhood = {
        id: `t${t.index}${p.idSuffix}`,
        title,
        color: p.color,
        part: cityDef.labels.length > 1 ? p.label : null,
        order: t.x + t.y / 10000,
        sections: p.sections.map((s) => toSection(t, s, u)),
      };
      city.neighborhoods.push(n);
    }
  }
  for (const c of cities) {
    const def = CITIES.find((d) => d.id === c.id)!;
    c.neighborhoods.sort(
      (a, b) => def.labels.indexOf(a.part ?? def.labels[0]!) - def.labels.indexOf(b.part ?? def.labels[0]!) || a.order - b.order,
    );
  }

  // --- general table -----------------------------------------------------------
  const gu = usedOf(generalTable);
  const g = splitSections(generalTable, gu);
  const general = {
    title: g.title,
    color: g.color,
    sections: g.sections.map(
      (s): GeneralSection => ({
        title: s.title,
        color: s.color,
        columns: s.columns,
        rows: s.rows.map((r) => readItem(generalTable, r, s.columns, gu)),
      }),
    ),
  };

  // --- itinerary ---------------------------------------------------------------
  const itinerary = readItinerary(itineraryTable, usedOf(itineraryTable), notes);

  // --- reminders (red fills) ---------------------------------------------------
  const reminders = new Map<string, Reminder>();
  const addReminder = (item: Item, place: Reminder['places'][number]) => {
    const key = item.name ? reminderKeyFor(item.name) : item.id;
    item.reminderKey = key;
    const r = reminders.get(key) ?? { key, name: item.name || item.description, places: [] };
    r.places.push(place);
    reminders.set(key, r);
  };
  for (const city of cities)
    for (const n of city.neighborhoods)
      for (const s of n.sections)
        for (const it of s.items)
          if (it.marking === 'attention')
            addReminder(it, {
              city: city.name,
              neighborhood: n.title,
              cityId: city.id,
              neighborhoodId: n.id,
              note: it.description,
              info: it.info ? it.info.value : '',
            });
  for (const s of general.sections)
    for (const it of s.rows)
      if (it.marking === 'attention')
        addReminder(it, {
          city: general.title,
          neighborhood: s.title,
          cityId: null,
          neighborhoodId: null,
          note: it.description,
          info: it.info ? it.info.value : '',
        });

  // Same-named items elsewhere (not red there) still point at the shared reminder, so
  // marking it handled shows everywhere the item appears.
  const allItems = [
    ...cities.flatMap((c) => c.neighborhoods.flatMap((n) => n.sections.flatMap((s) => s.items))),
    ...general.sections.flatMap((s) => s.rows),
  ];
  for (const it of allItems) {
    if (!it.reminderKey && it.name && reminders.has(reminderKeyFor(it.name))) it.reminderKey = reminderKeyFor(it.name);
  }

  // --- leftovers -----------------------------------------------------------------
  for (const t of nonEmpty) {
    const left = usedOf(t).leftovers();
    if (left.length) notes.push(`Table "${cellText(rowCells(t, 0).find((c) => cellText(c)))}": text not placed anywhere: ${left.join('; ')}`);
  }
  for (const it of allItems) if (!it.name) notes.push(`Row ${it.id} has no name; shown by its description: "${it.description}".`);

  return {
    trip: {
      title: itinerary.title,
      source: { file: source.file, sha256: createHash('sha256').update(source.bytes).digest('hex') },
      cities,
      itinerary,
      general,
      reminders: [...reminders.values()],
    },
    notes,
  };
}
