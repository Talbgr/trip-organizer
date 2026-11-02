import type { HandledState, Person, StatusEntry, StatusMap, Trip } from '../../shared/types.ts';

// The service worker keeps the last good copies of /api/trip and /api/status, so
// these calls keep working offline. localStorage is a second fallback for browsers
// where the service worker is not active yet (first visit, private mode).

const TRIP_CACHE = 'trip-cache-v1';
const STATUS_CACHE = 'status-cache-v1';

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

export async function loadStatus(): Promise<{ status: StatusMap; fresh: boolean }> {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const status = (await res.json()) as StatusMap;
    writeLocal(STATUS_CACHE, status);
    return { status, fresh: true };
  } catch {
    return { status: readLocal<StatusMap>(STATUS_CACHE) ?? {}, fresh: false };
  }
}

export async function setStatus(key: string, state: HandledState, by: Person): Promise<StatusEntry> {
  const res = await fetch(`/api/status/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, by }),
  });
  if (!res.ok) throw new Error(`save failed (${res.status})`);
  return (await res.json()) as StatusEntry;
}

export async function clearStatus(key: string, by: Person): Promise<void> {
  const res = await fetch(`/api/status/${encodeURIComponent(key)}?by=${encodeURIComponent(by)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`undo failed (${res.status})`);
}

export function rememberStatus(status: StatusMap) {
  writeLocal(STATUS_CACHE, status);
}
