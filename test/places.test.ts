import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkHotel, checkSchedule, hotelDates, placesOf } from '../shared/places.ts';
import type { Trip } from '../shared/types.ts';

const trip = JSON.parse(readFileSync(resolve(__dirname, '../data/trip.json'), 'utf8')) as Trip;
const places = placesOf(trip.itinerary);

describe('places', () => {
  it('splits the itinerary into continuous stays, in trip order', () => {
    expect(places.map((p) => p.location)).toEqual([
      'טוקיו', 'קוואגוצ׳יקו', 'קיוטו', 'אוסקה', 'טוקיו', 'בנגקוק+קראבי', 'קראבי', 'קופיפי', 'קו לאנטה', 'קראבי', 'בנגקוק',
    ]);
    const tokyo = places.filter((p) => p.cityId === 'tokyo');
    expect(tokyo).toHaveLength(2);
    expect(tokyo[0]!.dates[0]).toBe('2026-11-03');
    expect(places.find((p) => p.location === 'קופיפי')!.cityId).toBeNull();
  });

  it('links the workbook hotels to their place', () => {
    const kyoto = places.find((p) => p.cityId === 'kyoto')!;
    expect(kyoto.stays.map((i) => trip.itinerary.stays[i]!.hotel)).toEqual([expect.stringContaining('Agora kyoto')]);
  });

  it('computes the nights a hotel covers', () => {
    const kyoto = places.find((p) => p.cityId === 'kyoto')!;
    expect(hotelDates({ kind: 'full' }, kyoto)).toEqual(kyoto.dates);
    expect(hotelDates({ kind: 'nights', checkIn: kyoto.dates[1]!, nights: 2 }, kyoto)).toEqual(kyoto.dates.slice(1, 3));
  });
});

describe('validation', () => {
  const day = trip.itinerary.days[5]!.date!;
  it('accepts a normal schedule entry and rejects bad ones', () => {
    expect(checkSchedule({ date: day, time: '19:30', text: 'ארוחת ערב' }, trip.itinerary)).toBeNull();
    expect(checkSchedule({ date: day, time: null, text: 'x' }, trip.itinerary)).toBeNull();
    expect(checkSchedule({ date: '2030-01-01', time: null, text: 'x' }, trip.itinerary)).not.toBeNull();
    expect(checkSchedule({ date: day, time: '25:00', text: 'x' }, trip.itinerary)).not.toBeNull();
    expect(checkSchedule({ date: day, time: null, text: '   ' }, trip.itinerary)).not.toBeNull();
  });

  it('keeps hotel nights inside the place', () => {
    const kyoto = places.find((p) => p.cityId === 'kyoto')!;
    const base = { place: kyoto.id, name: 'Hotel', note: '', paid: false };
    expect(checkHotel({ ...base, stay: { kind: 'full' } }, places)).toBeNull();
    expect(checkHotel({ ...base, stay: { kind: 'nights', checkIn: kyoto.dates[0]!, nights: kyoto.dates.length } }, places)).toBeNull();
    expect(checkHotel({ ...base, stay: { kind: 'nights', checkIn: kyoto.dates[1]!, nights: kyoto.dates.length } }, places)).not.toBeNull();
    expect(checkHotel({ ...base, stay: { kind: 'nights', checkIn: '2026-12-30', nights: 1 } }, places)).not.toBeNull();
    expect(checkHotel({ ...base, place: 'nowhere', stay: { kind: 'full' } }, places)).not.toBeNull();
    expect(checkHotel({ ...base, name: ' ', stay: { kind: 'full' } }, places)).not.toBeNull();
  });
});
