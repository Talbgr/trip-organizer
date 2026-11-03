import type { HotelInput, ScheduleInput } from '../../shared/places.ts';
import type { HandledState, HotelEntry, Person, ScheduleEntry, StatusEntry, Trip, UserState } from '../../shared/types.ts';

// The service worker keeps the last good copies of /api/trip and /api/state, so the app
// keeps showing everything offline. localStorage is a second fallback for browsers where
// the service worker is not active yet (first visit, private mode).

const TRIP_CACHE = 'trip-cache-v1';
const STATE_CACHE = 'state-cache-v2';

function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the service worker cache still has it */
  }
}

export async function loadTrip(): Promise<Trip> {
  try {
    const res = await fetch('/api/trip');
    if (!res.ok) throw new Error(`trip ${res.status}`);
    const trip = (await res.json()) as Trip;
    writeLocal(TRIP_CACHE, trip);
    return trip;
  } catch (err) {
    const cached = readLocal<Trip>(TRIP_CACHE);
    if (cached) return cached;
    throw err;
  }
}

const EMPTY: UserState = { status: {}, schedule: [], hotels: [] };

export async function loadState(): Promise<{ state: UserState; fresh: boolean }> {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error(`state ${res.status}`);
    const state = (await res.json()) as UserState;
    writeLocal(STATE_CACHE, state);
    return { state, fresh: true };
  } catch {
    return { state: readLocal<UserState>(STATE_CACHE) ?? EMPTY, fresh: false };
  }
}

export function rememberState(state: UserState) {
  writeLocal(STATE_CACHE, state);
}

/** Error with the server's (Hebrew) message when it sent one. */
export class ApiError extends Error {}

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('אין חיבור לשרת — לא נשמר. נסו שוב כשיש אינטרנט.');
  }
  if (!res.ok) {
    const msg = await res
      .json()
      .then((j: { error?: string }) => j.error)
      .catch(() => null);
    throw new ApiError(msg && /[א-ת]/.test(msg) ? msg : `לא נשמר (שגיאה ${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const q = (by: Person) => `?by=${encodeURIComponent(by)}`;

export const api = {
  setStatus: (key: string, state: HandledState, by: Person) =>
    send<StatusEntry>('PUT', `/api/status/${encodeURIComponent(key)}`, { state, by }),
  clearStatus: (key: string, by: Person) => send<void>('DELETE', `/api/status/${encodeURIComponent(key)}${q(by)}`),

  addSchedule: (input: ScheduleInput, by: Person) => send<ScheduleEntry>('POST', '/api/schedule', { ...input, by }),
  updateSchedule: (id: string, input: ScheduleInput, by: Person) => send<ScheduleEntry>('PUT', `/api/schedule/${id}`, { ...input, by }),
  deleteSchedule: (id: string, by: Person) => send<void>('DELETE', `/api/schedule/${id}${q(by)}`),

  addHotel: (input: HotelInput, by: Person) => send<HotelEntry>('POST', '/api/hotels', { ...input, by }),
  updateHotel: (id: string, input: HotelInput, by: Person) => send<HotelEntry>('PUT', `/api/hotels/${id}`, { ...input, by }),
  deleteHotel: (id: string, by: Person) => send<void>('DELETE', `/api/hotels/${id}${q(by)}`),
};
