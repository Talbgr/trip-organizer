import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks';
import type { HandledState, Person, Reminder, StatusMap, Trip } from '../../shared/types.ts';
import { clearStatus, loadStatus, rememberStatus, setStatus } from './api.ts';

const PERSON_KEY = 'trip-person';
const STATUS_POLL_MS = 30_000;

export interface AppState {
  trip: Trip;
  status: StatusMap;
  online: boolean;
  person: Person | null;
  setPerson(p: Person): void;
  pending: Reminder[];
  handled: Reminder[];
  mark(key: string, state: HandledState): Promise<void>;
  undo(key: string): Promise<void>;
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
  const [status, setStatusMap] = useState<StatusMap>({});
  const [online, setOnline] = useState(navigator.onLine);
  const [person, setPersonState] = useState<Person | null>(readPerson);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { status: s, fresh } = await loadStatus();
    setStatusMap(s);
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
    const timer = setInterval(() => document.visibilityState === 'visible' && void refresh(), STATUS_POLL_MS);
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

  const mark = useCallback(
    async (key: string, state: HandledState) => {
      if (!person) return;
      setBusy(key);
      try {
        const entry = await setStatus(key, state, person);
        setStatusMap((s) => {
          const next = { ...s, [key]: entry };
          rememberStatus(next);
          return next;
        });
      } catch {
        setError('לא נשמר — אין חיבור לשרת. נסו שוב כשיש אינטרנט.');
        setOnline(false);
      } finally {
        setBusy(null);
      }
    },
    [person],
  );

  const undo = useCallback(
    async (key: string) => {
      if (!person) return;
      setBusy(key);
      try {
        await clearStatus(key, person);
        setStatusMap((s) => {
          const next = { ...s };
          delete next[key];
          rememberStatus(next);
          return next;
        });
      } catch {
        setError('לא נשמר — אין חיבור לשרת. נסו שוב כשיש אינטרנט.');
        setOnline(false);
      } finally {
        setBusy(null);
      }
    },
    [person],
  );

  const value = useMemo<AppState>(() => {
    const pending = trip.reminders.filter((r) => !status[r.key]);
    const handled = trip.reminders.filter((r) => status[r.key]);
    return {
      trip,
      status,
      online,
      person,
      setPerson,
      pending,
      handled,
      mark,
      undo,
      busy,
      error,
      dismissError: () => setError(null),
    };
  }, [trip, status, online, person, setPerson, mark, undo, busy, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
