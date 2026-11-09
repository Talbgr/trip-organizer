import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { placesOf, type HotelInput, type Place, type ScheduleInput } from '../../shared/places.ts';
import type { CheckEntry, DayOverride, HandledState, HotelEntry, Person, Reminder, ScheduleEntry, StatusMap, Trip, UserState } from '../../shared/types.ts';
import { api, ApiError, EMPTY_STATE, loadState, rememberState } from './api.ts';

const PERSON_KEY = 'trip-person';
const POLL_MS = 30_000;

export interface AppState {
  trip: Trip;
  places: Place[];
  status: StatusMap;
  schedule: ScheduleEntry[];
  hotels: HotelEntry[];
  /** Edits to the workbook's day text, keyed by ISO date. */
  days: Record<string, DayOverride>;
  /** Done / missed marks, keyed by checkKey. */
  checks: Record<string, CheckEntry>;
  online: boolean;
  person: Person | null;
  setPerson(p: Person): void;
  /** Red workbook items not marked Booked/Paid yet. */
  pending: Reminder[];
  handled: Reminder[];
  /** Hotels added in the app and not marked paid. */
  unpaidHotels: HotelEntry[];
  mark(key: string, state: HandledState): Promise<void>;
  undo(key: string): Promise<void>;
  saveSchedule(id: string | null, input: ScheduleInput): Promise<boolean>;
  deleteSchedule(id: string): Promise<void>;
  saveHotel(id: string | null, input: HotelInput): Promise<boolean>;
  deleteHotel(id: string): Promise<void>;
  setHotelPaid(h: HotelEntry, paid: boolean): Promise<void>;
  /** Replace (text) or remove (null) the workbook's text for a day. */
  saveDayText(date: string, text: string | null): Promise<boolean>;
  restoreDay(date: string): Promise<void>;
  /** ☐ → ✅ done → ❌ missed → ☐ */
  cycleCheck(key: string): Promise<void>;
  /** Key of the thing being saved right now (reminder key or entry id), to disable its buttons. */
  busy: string | null;
  error: string | null;
  dismissError(): void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

function readPerson(): Person | null {
  try {
    const p = localStorage.getItem(PERSON_KEY);
    return p === 'טל' || p === 'עדי' ? p : null;
  } catch {
    return null;
  }
}

export function AppProvider({ trip, children }: { trip: Trip; children: ComponentChildren }) {
  const [user, setUser] = useState<UserState>(EMPTY_STATE);
  const [online, setOnline] = useState(navigator.onLine);
  const [person, setPersonState] = useState<Person | null>(readPerson);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const places = useMemo(() => placesOf(trip.itinerary), [trip]);

  const refresh = useCallback(async () => {
    const { state, fresh } = await loadState();
    setUser(state);
    setOnline(fresh && navigator.onLine);
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => document.visibilityState === 'visible' && void refresh();
    const goOnline = () => void refresh();
    const goOffline = () => setOnline(false);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const timer = setInterval(() => document.visibilityState === 'visible' && void refresh(), POLL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(timer);
    };
  }, [refresh]);

  const setPerson = useCallback((p: Person) => {
    setPersonState(p);
    try {
      localStorage.setItem(PERSON_KEY, p);
    } catch {
      /* ignore */
    }
  }, []);

  /** Runs a change against the server, applies it locally, and reports failures. */
  const run = useCallback(
    async (key: string, change: (by: Person) => Promise<(u: UserState) => UserState>): Promise<boolean> => {
      if (!person) return false;
      setBusy(key);
      try {
        const apply = await change(person);
        setUser((u) => {
          const next = apply(u);
          rememberState(next);
          return next;
        });
        return true;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'משהו השתבש — לא נשמר.');
        if (!navigator.onLine) setOnline(false);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [person],
  );

  const value = useMemo<AppState>(() => {
    const replace = <T extends { id: string }>(list: T[], item: T) =>
      list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
    return {
      trip,
      places,
      status: user.status,
      schedule: user.schedule,
      hotels: user.hotels,
      days: user.days,
      checks: user.checks,
      online,
      person,
      setPerson,
      pending: trip.reminders.filter((r) => !user.status[r.key]),
      handled: trip.reminders.filter((r) => user.status[r.key]),
      unpaidHotels: user.hotels.filter((h) => !h.paid),
      mark: async (key, state) => {
        await run(key, async (by) => {
          const entry = await api.setStatus(key, state, by);
          return (u) => ({ ...u, status: { ...u.status, [key]: entry } });
        });
      },
      undo: async (key) => {
        await run(key, async (by) => {
          await api.clearStatus(key, by);
          return (u) => {
            const status = { ...u.status };
            delete status[key];
            return { ...u, status };
          };
        });
      },
      saveSchedule: (id, input) =>
        run(id ?? 'new-schedule', async (by) => {
          const entry = id ? await api.updateSchedule(id, input, by) : await api.addSchedule(input, by);
          return (u) => ({ ...u, schedule: replace(u.schedule, entry) });
        }),
      deleteSchedule: async (id) => {
        await run(id, async (by) => {
          await api.deleteSchedule(id, by);
          return (u) => ({ ...u, schedule: u.schedule.filter((e) => e.id !== id) });
        });
      },
      saveHotel: (id, input) =>
        run(id ?? 'new-hotel', async (by) => {
          const entry = id ? await api.updateHotel(id, input, by) : await api.addHotel(input, by);
          return (u) => ({ ...u, hotels: replace(u.hotels, entry) });
        }),
      deleteHotel: async (id) => {
        await run(id, async (by) => {
          await api.deleteHotel(id, by);
          return (u) => ({ ...u, hotels: u.hotels.filter((h) => h.id !== id) });
        });
      },
      setHotelPaid: async (h, paid) => {
        await run(h.id, async (by) => {
          const entry = await api.updateHotel(h.id, { place: h.place, name: h.name, stay: h.stay, note: h.note, paid }, by);
          return (u) => ({ ...u, hotels: replace(u.hotels, entry) });
        });
      },
      saveDayText: (date, text) =>
        run(`day-${date}`, async (by) => {
          const entry = await api.setDayText(date, text, by);
          return (u) => ({ ...u, days: { ...u.days, [date]: entry } });
        }),
      restoreDay: async (date) => {
        await run(`day-${date}`, async (by) => {
          await api.restoreDay(date, by);
          return (u) => {
            const days = { ...u.days };
            delete days[date];
            return { ...u, days };
          };
        });
      },
      cycleCheck: async (key) => {
        const current = user.checks[key]?.state;
        await run(`check-${key}`, async (by) => {
          if (current === 'missed') {
            await api.clearCheck(key, by);
            return (u) => {
              const checks = { ...u.checks };
              delete checks[key];
              return { ...u, checks };
            };
          }
          const entry = await api.setCheck(key, current === 'done' ? 'missed' : 'done', by);
          return (u) => ({ ...u, checks: { ...u.checks, [key]: entry } });
        });
      },
      busy,
      error,
      dismissError: () => setError(null),
    };
  }, [trip, places, user, online, person, setPerson, run, busy, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
