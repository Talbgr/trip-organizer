// Data contract between the importer (which reads the workbook) and the app.
// Every string here is copied verbatim from the workbook; nothing is invented.

export type CategoryId = 'attractions' | 'shopping' | 'rest_adi' | 'rest_tal' | 'rest_both' | 'uncategorized';

export const CATEGORY_ORDER: readonly CategoryId[] = [
  'attractions',
  'shopping',
  'rest_adi',
  'rest_tal',
  'rest_both',
  'uncategorized',
];

/** Workbook fill markings that carry meaning. */
export type Marking = 'attention' | 'booked';

export interface Item {
  /** Stable id: `<tableId>:r<row>` (row in the source table, 0-based). */
  id: string;
  /** Name column ("שם המקום" / "שם החנות" ...). May be empty if the workbook row has none. */
  name: string;
  /** Description column ("תיאור" / "סוג האוכל"). */
  description: string;
  /** First column (cost / distance / location ...), with its header label from the workbook. */
  info: { label: string; value: string } | null;
  links: string[];
  marking: Marking | null;
  /** Key shared by all rows that are the same red-marked item (exact name match). */
  reminderKey: string | null;
}

export interface Section {
  /** Header text exactly as in the workbook, e.g. "אטרקציות יום 2". */
  title: string;
  /** Header text worth showing: set when it says more than the category name (e.g. "אטרקציות יום 2", "ARASHIYAMA"). */
  subtitle: string | null;
  category: CategoryId;
  color: string | null;
  items: Item[];
}

export interface Neighborhood {
  id: string;
  /** Title exactly as in the workbook (a name, or a date for Kyoto/Osaka). */
  title: string;
  /** Title-row fill color, meaningful only inside its city. */
  color: string | null;
  /** City-label tag when a city is split in the workbook (e.g. "טוקיו חלק 1"). */
  part: string | null;
  /** Source position on the workbook canvas, used only for ordering. */
  order: number;
  sections: Section[];
}

export interface City {
  id: string;
  name: string;
  neighborhoods: Neighborhood[];
}

export interface ItineraryDay {
  date: string | null; // ISO yyyy-mm-dd
  day: string;
  location: string;
  activity: string;
  links: string[];
  color: string | null;
  /** Index into `stays`, or null if the row has no hotel. */
  stay: number | null;
}

export interface Stay {
  hotel: string;
  price: string;
  color: string | null;
}

export interface Itinerary {
  title: string;
  headers: { date: string; day: string; activity: string; location: string; hotel: string; price: string };
  days: ItineraryDay[];
  stays: Stay[];
}

export interface GeneralSection {
  title: string;
  color: string | null;
  /** Column labels for this section, in source order (first, description, name). */
  columns: string[];
  rows: Item[];
}

export interface Reminder {
  key: string;
  name: string;
  /** Every place this item appears (it may appear in several tables). */
  places: { city: string; neighborhood: string; cityId: string | null; neighborhoodId: string | null; note: string; info: string }[];
}

export interface Trip {
  title: string;
  source: { file: string; sha256: string };
  cities: City[];
  itinerary: Itinerary;
  general: { title: string; color: string | null; sections: GeneralSection[] };
  reminders: Reminder[];
}

export type HandledState = 'booked' | 'paid';
export type Person = 'טל' | 'עדי';

export interface StatusEntry {
  state: HandledState;
  by: Person;
  at: string; // ISO timestamp
}

export type StatusMap = Record<string, StatusEntry>;

// ---- Things the two of us add in the app (stored on the server, not in the workbook) ----

export interface ScheduleEntry {
  id: string;
  /** ISO date of an itinerary day. */
  date: string;
  /** "HH:MM", or null when no time was given. */
  time: string | null;
  text: string;
  createdBy: Person;
  createdAt: string;
  updatedBy: Person;
  updatedAt: string;
}

export type HotelStay = { kind: 'full' } | { kind: 'nights'; checkIn: string; nights: number };

export interface HotelEntry {
  id: string;
  /** Id of a place (one continuous stay in the itinerary), see shared/places.ts. */
  place: string;
  name: string;
  stay: HotelStay;
  note: string;
  paid: boolean;
  createdBy: Person;
  createdAt: string;
  updatedBy: Person;
  updatedAt: string;
}

/** A change to the workbook's own text for a day. The workbook itself is never modified. */
export interface DayOverride {
  date: string;
  /** Replacement text, or null when the day's workbook text was removed. */
  text: string | null;
  by: Person;
  at: string;
}

/** Done / missed mark on a place or a schedule item. */
export type CheckState = 'done' | 'missed';
export interface CheckEntry {
  state: CheckState;
  by: Person;
  at: string;
}

export interface UserState {
  status: StatusMap;
  schedule: ScheduleEntry[];
  hotels: HotelEntry[];
  /** Keyed by ISO date. */
  days: Record<string, DayOverride>;
  /** Keyed by checkKey (see shared/places.ts). */
  checks: Record<string, CheckEntry>;
}
