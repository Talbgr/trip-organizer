// Usage: npm run import [-- path/to/workbook.numbers]
// Reads the workbook and writes data/trip.json (served by the app) and
// docs/data-report.md (everything the importer could not place cleanly).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpret } from './interpret.ts';
import { readNumbers09 } from './numbers09.ts';
import { renderReport } from './report.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_WORKBOOK = resolve(root, 'data/workbook/trip.numbers');

export function importWorkbook(path = DEFAULT_WORKBOOK) {
  const bytes = readFileSync(path);
  return interpret(readNumbers09(bytes), { file: basename(path), bytes });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_WORKBOOK;
  const { trip, notes } = importWorkbook(path);
  const out = resolve(root, 'data/trip.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(trip, null, 1) + '\n');
  mkdirSync(resolve(root, 'docs'), { recursive: true });
  writeFileSync(resolve(root, 'docs/data-report.md'), renderReport(trip, notes));
  const items = trip.cities.reduce((n, c) => n + c.neighborhoods.reduce((m, h) => m + h.sections.reduce((k, s) => k + s.items.length, 0), 0), 0);
  console.log(
    `Imported ${trip.cities.length} cities, ${trip.cities.reduce((n, c) => n + c.neighborhoods.length, 0)} neighborhoods, ${items} items, ` +
      `${trip.itinerary.days.length} itinerary days, ${trip.reminders.length} reminders. ${notes.length} note(s) in docs/data-report.md.`,
  );
}
