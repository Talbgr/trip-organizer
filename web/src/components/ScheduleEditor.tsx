import { useState } from 'preact/hooks';
import { checkSchedule } from '../../../shared/places.ts';
import type { ScheduleEntry } from '../../../shared/types.ts';
import { useApp } from '../state.tsx';
import { formatDate } from '../ui.ts';
import { Sheet } from './Sheet.tsx';

/** Add a new entry to a day (entry = null) or edit/delete an existing one. */
export function ScheduleEditor({ date, entry, onClose }: { date: string; entry: ScheduleEntry | null; onClose(): void }) {
  const { trip, saveSchedule, deleteSchedule, busy, online, person } = useApp();
  const [day, setDay] = useState(entry?.date ?? date);
  const [time, setTime] = useState(entry?.time ?? '');
  const [text, setText] = useState(entry?.text ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const saving = busy === (entry?.id ?? 'new-schedule');

  const submit = async (e: Event) => {
    e.preventDefault();
    const input = { date: day, time: time || null, text };
    const error = checkSchedule(input, trip.itinerary);
    if (error) return setProblem(error);
    if (await saveSchedule(entry?.id ?? null, input)) onClose();
  };
  const remove = async () => {
    if (!entry || !confirm('למחוק את זה מהלו״ז?')) return;
    await deleteSchedule(entry.id);
    onClose();
  };

  return (
    <Sheet title={entry ? 'עריכה בלו״ז' : 'הוספה ללו״ז'} onClose={onClose}>
      <form class="form" onSubmit={submit}>
        <label class="field">
          <span>יום</span>
          <select value={day} onChange={(e) => setDay(e.currentTarget.value)}>
            {trip.itinerary.days
              .filter((d) => d.date)
              .map((d) => (
                <option value={d.date!}>
                  {formatDate(d.date)} · {d.day} · {d.location}
                </option>
              ))}
          </select>
        </label>
        <label class="field">
          <span>שעה (לא חובה)</span>
          <div class="row">
            <input type="time" value={time} onInput={(e) => setTime(e.currentTarget.value)} />
            {time && (
              <button type="button" class="btn btn--ghost" onClick={() => setTime('')}>
                בלי שעה
              </button>
            )}
          </div>
        </label>
        <label class="field">
          <span>מה מתוכנן</span>
          <textarea rows={3} value={text} onInput={(e) => setText(e.currentTarget.value)} dir="auto" autoFocus={!entry} />
        </label>
        {problem && <p class="form__error">{problem}</p>}
        {!online && <p class="form__error">אין חיבור — אפשר לשמור רק עם אינטרנט.</p>}
        <div class="form__actions">
          <button class="btn" type="submit" disabled={saving || !online || !person}>
            שמירה
          </button>
          {entry && (
            <button class="btn btn--danger" type="button" disabled={busy === entry.id || !online} onClick={() => void remove()}>
              מחיקה
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
