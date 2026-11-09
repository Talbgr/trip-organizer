// "Places" are the continuous runs of the same location in the itinerary, e.g. Tokyo
// appears twice (3.11–7.11 and 18.11–26.11), so it is two places. Hotels added in the
// app belong to a place; a hotel's nights are dates inside that place's run.

import type { CheckEntry, CheckState, DayOverride, HotelEntry, HotelStay, Itinerary, Person, ScheduleEntry, Trip } from './types.ts';

export interface Place {
  /** `<location>@<first date>` — stable as long as the workbook keeps that run. */
  id: string;
  location: string;
  /** App city for the four Japan cities, null elsewhere. */
  cityId: string | null;
  /** Dates of the run, in order. Each date is one night at that place. */
  dates: string[];
  /** Indexes into itinerary.stays of the workbook hotels during this run. */
  stays: number[];
}

/** Itinerary location (as written) → app city. Thailand places have no city page. */
const CITY_OF_LOCATION: Record<string, string> = {
  טוקיו: 'tokyo',
  'קוואגוצ׳יקו': 'fuji',
  קיוטו: 'kyoto',
  אוסקה: 'osaka',
};

export function placesOf(itinerary: Itinerary): Place[] {
  const places: Place[] = [];
  for (const d of itinerary.days) {
    if (!d.date || !d.location) continue;
    const last = places.at(-1);
    if (last && last.location === d.location) last.dates.push(d.date);
    else
      places.push({
        id: `${d.location}@${d.date}`,
        location: d.location,
        cityId: CITY_OF_LOCATION[d.location] ?? null,
        dates: [d.date],
        stays: [],
      });
    const p = places.at(-1)!;
    if (d.stay !== null && !p.stays.includes(d.stay)) p.stays.push(d.stay);
  }
  return places;
}

/** The dates (nights) a hotel covers, clipped to its place. */
export function hotelDates(stay: HotelStay, place: Place): string[] {
  if (stay.kind === 'full') return place.dates;
  const start = place.dates.indexOf(stay.checkIn);
  return start < 0 ? [] : place.dates.slice(start, start + stay.nights);
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const LIMITS = { text: 500, hotelName: 200, note: 1000, dayText: 3000 } as const;

export type ScheduleInput = Pick<ScheduleEntry, 'date' | 'time' | 'text'>;
export type HotelInput = Pick<HotelEntry, 'place' | 'name' | 'stay' | 'note' | 'paid'>;

/** Returns a Hebrew error message, or null when the input is valid. */
export function checkSchedule(input: ScheduleInput, itinerary: Itinerary): string | null {
  if (!itinerary.days.some((d) => d.date === input.date)) return 'היום הזה לא קיים בלו״ז';
  if (input.time !== null && !TIME_RE.test(input.time)) return 'שעה לא תקינה';
  const text = input.text.trim();
  if (!text) return 'צריך לכתוב מה מתוכנן';
  if (text.length > LIMITS.text) return `עד ${LIMITS.text} תווים`;
  return null;
}

export function checkHotel(input: HotelInput, places: Place[]): string | null {
  const place = places.find((p) => p.id === input.place);
  if (!place) return 'המקום הזה לא קיים בלו״ז';
  const name = input.name.trim();
  if (!name) return 'צריך שם מלון';
  if (name.length > LIMITS.hotelName) return `שם עד ${LIMITS.hotelName} תווים`;
  if (input.note.length > LIMITS.note) return `הערה עד ${LIMITS.note} תווים`;
  if (input.stay.kind === 'nights') {
    if (typeof input.stay.checkIn !== 'string') return 'חסר תאריך כניסה';
    const start = place.dates.indexOf(input.stay.checkIn);
    if (start < 0) return 'תאריך הכניסה לא בתוך השהייה במקום';
    const { nights } = input.stay;
    if (!Number.isInteger(nights) || nights < 1) return 'מספר לילות לא תקין';
    if (start + nights > place.dates.length) return `יש רק ${place.dates.length - start} לילות מהתאריך הזה במקום`;
  }
  return null;
}

/** Edited workbook text for a day: the day must exist and have workbook text; null removes it. */
export function checkDayText(date: string, text: string | null, itinerary: Itinerary): string | null {
  const day = itinerary.days.find((d) => d.date === date);
  if (!day) return 'היום הזה לא קיים בלו״ז';
  if (!day.activity) return 'אין ביום הזה טקסט מהקובץ';
  if (text === null) return null;
  if (!text.trim()) return 'הטקסט ריק — למחיקה יש כפתור נפרד';
  if (text.length > LIMITS.dayText) return `עד ${LIMITS.dayText} תווים`;
  return null;
}

/**
 * Keys for done/missed marks:
 *  - `item:<item id>`   a place in a neighborhood or the general table (id = table + row);
 *  - `day:<yyyy-mm-dd>` the workbook's text for a day in the itinerary;
 *  - `entry:<uuid>`     a schedule entry added in the app;
 *  - `area:<neighborhood id>` a whole neighborhood / area;
 *  - `wholeday:<yyyy-mm-dd>`  a whole day in the itinerary.
 * Marking an area or a day fills the empty boxes inside it (see checkChildren / markCheck).
 */
export const checkKey = {
  item: (id: string) => `item:${id}`,
  day: (date: string) => `day:${date}`,
  entry: (id: string) => `entry:${id}`,
  area: (neighborhoodId: string) => `area:${neighborhoodId}`,
  wholeDay: (date: string) => `wholeday:${date}`,
};

const ENTRY_KEY_RE = /^entry:[0-9a-f-]{36}$/;

/** Whether `key` names something that exists in the trip (entries: a well-formed id). */
export function isValidCheckKey(key: string, trip: Trip): boolean {
  if (key.startsWith('item:')) {
    const id = key.slice(5);
    const items = [
      ...trip.cities.flatMap((c) => c.neighborhoods.flatMap((n) => n.sections.flatMap((s) => s.items))),
      ...trip.general.sections.flatMap((s) => s.rows),
    ];
    return items.some((i) => i.id === id);
  }
  if (key.startsWith('day:')) return trip.itinerary.days.some((d) => d.date === key.slice(4));
  if (key.startsWith('wholeday:')) return trip.itinerary.days.some((d) => d.date === key.slice(9));
  if (key.startsWith('area:')) return trip.cities.some((c) => c.neighborhoods.some((n) => n.id === key.slice(5)));
  return ENTRY_KEY_RE.test(key);
}

/**
 * The boxes inside a whole-area / whole-day box: an area's places; a day's workbook text
 * (unless it was removed in the app) and the entries added to that day. Empty for other keys.
 */
export function checkChildren(key: string, trip: Trip, schedule: ScheduleEntry[], days: Record<string, DayOverride>): string[] {
  if (key.startsWith('area:')) {
    const id = key.slice(5);
    const n = trip.cities.flatMap((c) => c.neighborhoods).find((x) => x.id === id);
    return n ? n.sections.flatMap((s) => s.items.map((i) => checkKey.item(i.id))) : [];
  }
  if (key.startsWith('wholeday:')) {
    const date = key.slice(9);
    const day = trip.itinerary.days.find((d) => d.date === date);
    if (!day) return [];
    const hasText = day.activity && !(days[date] && days[date]!.text === null);
    return [...(hasText ? [checkKey.day(date)] : []), ...schedule.filter((e) => e.date === date).map((e) => checkKey.entry(e.id))];
  }
  return [];
}

/**
 * The whole-area / whole-day boxes that contain `key`: a place's area, the whole day of a day's
 * text or of an added entry. Clearing a box by hand clears these, since they no longer cover
 * everything inside them (and the next tap on them fills it again).
 */
export function checkParents(key: string, trip: Trip, schedule: ScheduleEntry[]): string[] {
  if (key.startsWith('item:')) {
    const id = key.slice(5);
    return trip.cities
      .flatMap((c) => c.neighborhoods)
      .filter((n) => n.sections.some((s) => s.items.some((i) => i.id === id)))
      .map((n) => checkKey.area(n.id));
  }
  if (key.startsWith('day:')) return [checkKey.wholeDay(key.slice(4))];
  if (key.startsWith('entry:')) {
    const entry = schedule.find((e) => e.id === key.slice(6));
    return entry ? [checkKey.wholeDay(entry.date)] : [];
  }
  return [];
}

/**
 * The same rules as the server's markCheck, applied to a copy of the marks — used by the app to
 * show a tap's full effect immediately: the box itself is marked by hand; empty boxes inside a
 * whole area/day get the same mark and ones it filled before follow it; boxes marked by hand are
 * kept; clearing a box also clears the whole area/day boxes around it.
 */
export function applyCheck(
  checks: Record<string, CheckEntry>,
  key: string,
  state: CheckState | null,
  by: Person,
  at: string,
  { children = [], parents = [] }: { children?: string[]; parents?: string[] } = {},
): Record<string, CheckEntry> {
  const next = { ...checks };
  if (state === null) {
    delete next[key];
    for (const p of parents) delete next[p];
  } else next[key] = { state, by, at, auto: null };
  for (const child of children) {
    const existing = next[child];
    if (existing && existing.auto !== key) continue;
    if (state === null) delete next[child];
    else next[child] = { state, by, at, auto: key };
  }
  return next;
}
