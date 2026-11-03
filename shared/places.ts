// "Places" are the continuous runs of the same location in the itinerary, e.g. Tokyo
// appears twice (3.11–7.11 and 18.11–26.11), so it is two places. Hotels added in the
// app belong to a place; a hotel's nights are dates inside that place's run.

import type { HotelEntry, HotelStay, Itinerary, ScheduleEntry } from './types.ts';

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
export const LIMITS = { text: 500, hotelName: 200, note: 1000 } as const;

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
