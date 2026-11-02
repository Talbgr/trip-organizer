// How the workbook's canvas maps onto cities. Sheet 2 places each neighborhood
// table under a city label table ("טוקיו חלק 1", "פוג׳י", ...). Labels are not
// containers in the file, so the assignment below was read off the sheet once
// and is checked on every import: a table that is missing here, or an entry here
// with no matching table, fails the import loudly instead of being guessed.

export interface CityDef {
  id: string;
  name: string;
  /** Label tables (1-row tables on sheet 2) that belong to this city. */
  labels: string[];
}

export const CITIES: CityDef[] = [
  { id: 'tokyo', name: 'טוקיו', labels: ['טוקיו חלק 1', 'טוקיו חלק 2'] },
  { id: 'fuji', name: 'פוג׳י', labels: ['פוג׳י'] },
  { id: 'kyoto', name: 'קיוטו', labels: ['קיוטו'] },
  { id: 'osaka', name: 'אוסקה', labels: ['אוסקה'] },
];

export interface TablePlacement {
  /** City label the table sits under. */
  label: string;
  /**
   * Sections from this index onward belong to another city label. Used for 15.11,
   * whose top (blue) part is Kyoto and whose orange part is the arrival in Osaka.
   */
  splitFromSection?: { index: number; label: string };
}

/** Keyed by the table's title (its first cell), trimmed. */
export const PLACEMENT: Record<string, TablePlacement> = {
  'שינג׳וקו': { label: 'טוקיו חלק 1' },
  'קודוקאן- ג׳ודו': { label: 'טוקיו חלק 1' },
  'אואנו': { label: 'טוקיו חלק 1' },
  'אומוטסנדו+הרג׳וקו': { label: 'טוקיו חלק 1' },
  'שיבויה': { label: 'טוקיו חלק 1' },
  'שימוקיטאזווה+נאקאנו': { label: 'טוקיו חלק 1' },
  'גינזה': { label: 'טוקיו חלק 2' },
  'אקיהברה': { label: 'טוקיו חלק 2' },
  'אסקוסה': { label: 'טוקיו חלק 2' },
  'האקונה': { label: 'טוקיו חלק 2' },
  'ניקו': { label: 'טוקיו חלק 2' },
  'קווגוצ׳יקו': { label: 'פוג׳י' },
  '11.11': { label: 'קיוטו' },
  '12.11': { label: 'קיוטו' },
  '13.11': { label: 'קיוטו' },
  '14.11': { label: 'קיוטו' },
  '15.11': { label: 'קיוטו', splitFromSection: { index: 1, label: 'אוסקה' } },
  '16.11': { label: 'אוסקה' },
  '17.11': { label: 'אוסקה' },
  '18.11': { label: 'אוסקה' },
};
