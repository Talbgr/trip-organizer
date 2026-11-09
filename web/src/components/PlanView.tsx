import { useState } from 'preact/hooks';
import { checkDayText, checkKey, hotelDates } from '../../../shared/places.ts';
import type { ItineraryDay, ScheduleEntry } from '../../../shared/types.ts';
import { useApp } from '../state.tsx';
import { formatDate, formatWhen, localToday, textOn } from '../ui.ts';
import { ItemCard } from './ItemCard.tsx';
import { ScheduleEditor } from './ScheduleEditor.tsx';
import { CheckBox, checkClass } from './CheckBox.tsx';
import { Sheet } from './Sheet.tsx';

/** Timed entries first, by time; then untimed ones in the order they were added. */
function byTime(a: ScheduleEntry, b: ScheduleEntry): number {
  if (a.time && b.time) return a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt);
  if (a.time) return -1;
  if (b.time) return 1;
  return a.createdAt.localeCompare(b.createdAt);
}

/** The day-by-day sheet, grouped by hotel stay, plus what we added or changed in the app. */
export function PlanView() {
  const { trip, schedule, hotels, places, days, checks, online, person, deleteSchedule, saveDayText, restoreDay, busy } = useApp();
  const { itinerary } = trip;
  const [editMode, setEditMode] = useState(false);
  const [editing, setEditing] = useState<{ date: string; entry: ScheduleEntry | null } | null>(null);
  const [editingDay, setEditingDay] = useState<ItineraryDay | null>(null);
  const today = localToday();
  const blocks: Array<{ stay: number | null; days: ItineraryDay[] }> = [];
  for (const d of itinerary.days) {
    const last = blocks.at(-1);
    if (last && last.stay === d.stay && d.stay !== null) last.days.push(d);
    else blocks.push({ stay: d.stay, days: [d] });
  }
  const hotelsOn = (date: string) =>
    hotels.filter((h) => {
      const place = places.find((p) => p.id === h.place);
      return place ? hotelDates(h.stay, place).includes(date) : false;
    });
  const dates = new Set(itinerary.days.map((d) => d.date));
  const orphans = schedule.filter((e) => !dates.has(e.date));
  const canEdit = online && !!person;

  const removeEntry = async (e: ScheduleEntry) => {
    if (confirm(`למחוק מהלו״ז: "${e.text}"?`)) await deleteSchedule(e.id);
  };
  const removeDayText = async (d: ItineraryDay) => {
    if (confirm('להסיר את הטקסט של היום הזה? אפשר לשחזר אותו אחר כך.')) await saveDayText(d.date!, null);
  };

  return (
    <>
      <div class="page-head">
        <h1 class="page-title">{itinerary.title}</h1>
        <button
          class={`icon-btn ${editMode ? 'icon-btn--on' : ''}`}
          aria-pressed={editMode}
          aria-label={editMode ? 'סיום עריכה' : 'עריכת הלו״ז'}
          title={editMode ? 'סיום עריכה' : 'עריכת הלו״ז'}
          onClick={() => setEditMode(!editMode)}
        >
          {editMode ? '✓' : '✎'}
        </button>
      </div>
      {editMode && !canEdit && <p class="form__error">{online ? 'בחרו משתמש (👤) כדי לערוך.' : 'אין חיבור — אפשר לערוך רק עם אינטרנט.'}</p>}
      {blocks.map((b) => {
        const stay = b.stay !== null ? itinerary.stays[b.stay] : undefined;
        const color = stay?.color ?? b.days[0]?.color ?? null;
        return (
          <section class="stay" style={{ '--accent': color ?? 'var(--line)' }}>
            {stay && (
              <header class="stay__head" style={{ background: color ?? undefined, color: textOn(color) }}>
                <span class="stay__hotel" dir="auto">
                  🏨 {stay.hotel}
                </span>
                {stay.price && <span class="stay__price">₪{stay.price}</span>}
              </header>
            )}
            {b.days.map((d) => {
              const entries = d.date ? schedule.filter((e) => e.date === d.date).sort(byTime) : [];
              const added = d.date ? hotelsOn(d.date) : [];
              const override = d.date ? days[d.date] : undefined;
              const text = override ? override.text : d.activity;
              const dayBusy = busy === `day-${d.date}`;
              return (
                <div
                  class={`day ${d.date === today ? 'day--today' : ''} ${d.date ? checkClass(checks[checkKey.wholeDay(d.date)]?.state) : ''}`}
                  id={d.date ? `day-${d.date}` : undefined}
                >
                  <div class="day__when">
                    <strong>{formatDate(d.date)}</strong>
                    <span>{d.day}</span>
                    {d.date && <CheckBox checkKey={checkKey.wholeDay(d.date)} name={`${d.day} (${formatDate(d.date)}) כל היום`} />}
                  </div>
                  <div class="day__what">
                    <div class="day__loc">{d.location}</div>
                    {d.activity && (text || editMode) && (
                      <div class={`editable ${text ? checkClass(checks[checkKey.day(d.date!)]?.state) : ''}`}>
                        {text && d.date && <CheckBox checkKey={checkKey.day(d.date)} name={`${formatDate(d.date)} ${d.location}`} />}
                        <div class="editable__body">
                          {text ? (
                            <p class="day__act" dir="auto">
                              {text}
                            </p>
                          ) : (
                            <p class="day__act day__act--removed" dir="auto">
                              {d.activity}
                            </p>
                          )}
                          {override && (
                            <span class="edited">
                              {override.text === null ? '🗑' : '✎'} {override.by} · {formatWhen(override.at)}
                            </span>
                          )}
                        </div>
                        {editMode && d.date && (
                          <div class="editable__tools">
                            {text && (
                              <button class="icon-btn" disabled={!canEdit || dayBusy} onClick={() => setEditingDay(d)} aria-label="עריכת הטקסט">
                                ✎
                              </button>
                            )}
                            {text && (
                              <button class="icon-btn" disabled={!canEdit || dayBusy} onClick={() => void removeDayText(d)} aria-label="הסרת הטקסט">
                                🗑
                              </button>
                            )}
                            {override && (
                              <button class="icon-btn" disabled={!canEdit || dayBusy} onClick={() => void restoreDay(d.date!)} aria-label="שחזור הטקסט מהקובץ">
                                ↺
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {d.links.map((l) => (
                      <a class="small" href={l} target="_blank" rel="noopener noreferrer">
                        🔗 קישור
                      </a>
                    ))}
                    {added.map((h) => (
                      <div class={`added-hotel ${h.paid ? '' : 'added-hotel--unpaid'}`} dir="auto">
                        🏨 {h.name}
                        {!h.paid && <span class="badge badge--attention">לא שולם</span>}
                      </div>
                    ))}
                    {entries.map((e) => (
                      <div class={`entry ${checkClass(checks[checkKey.entry(e.id)]?.state)}`}>
                        <CheckBox checkKey={checkKey.entry(e.id)} name={e.text} />
                        {e.time && <span class="entry__time">{e.time}</span>}
                        <span class="entry__text" dir="auto">
                          {e.text}
                        </span>
                        {editMode ? (
                          <span class="entry__tools">
                            <button class="icon-btn icon-btn--small" disabled={!canEdit || busy === e.id} onClick={() => setEditing({ date: e.date, entry: e })} aria-label={`עריכה: ${e.text}`}>
                              ✎
                            </button>
                            <button class="icon-btn icon-btn--small" disabled={!canEdit || busy === e.id} onClick={() => void removeEntry(e)} aria-label={`מחיקה: ${e.text}`}>
                              🗑
                            </button>
                          </span>
                        ) : (
                          <span class="entry__by">{e.createdBy}</span>
                        )}
                      </div>
                    ))}
                    {editMode && d.date && (
                      <button class="icon-btn add-icon" disabled={!canEdit} onClick={() => setEditing({ date: d.date!, entry: null })} aria-label="הוספה ליום">
                        +
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
      {orphans.length > 0 && (
        <section class="stay">
          <header class="stay__head">יום שכבר לא קיים בלו״ז</header>
          {orphans.map((e) => (
            <div class="day">
              <div class="day__when">
                <strong>{formatDate(e.date)}</strong>
              </div>
              <div class="day__what">
                <p class="day__act" dir="auto">
                  {e.time && `${e.time} `}
                  {e.text}
                </p>
              </div>
            </div>
          ))}
        </section>
      )}
      {editing && <ScheduleEditor date={editing.date} entry={editing.entry} onClose={() => setEditing(null)} />}
      {editingDay && <DayTextEditor day={editingDay} onClose={() => setEditingDay(null)} />}
    </>
  );
}

/** Edit the workbook's text for one day (the workbook file is not changed). */
function DayTextEditor({ day, onClose }: { day: ItineraryDay; onClose(): void }) {
  const { trip, days, saveDayText, busy, online, person } = useApp();
  const current = days[day.date!]?.text ?? day.activity;
  const [text, setText] = useState(current);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    const error = checkDayText(day.date!, text, trip.itinerary);
    if (error) return setProblem(error);
    if (await saveDayText(day.date!, text)) onClose();
  };
  return (
    <Sheet title={`${formatDate(day.date)} · ${day.day}`} onClose={onClose}>
      <form class="form" onSubmit={submit}>
        <label class="field">
          <span>{day.location}</span>
          <textarea rows={6} value={text} onInput={(e) => setText(e.currentTarget.value)} dir="auto" />
        </label>
        {current !== day.activity && (
          <details class="original">
            <summary>מהקובץ</summary>
            <p dir="auto">{day.activity}</p>
          </details>
        )}
        {problem && <p class="form__error">{problem}</p>}
        <div class="form__actions">
          <button class="btn" type="submit" disabled={busy === `day-${day.date}` || !online || !person}>
            שמירה
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** The "נסיעות ואטרקציות" table from sheet 1, as written. */
export function GeneralView() {
  const { trip } = useApp();
  return (
    <>
      <h1 class="page-title">{trip.general.title}</h1>
      {trip.general.sections.map((s) => (
        <section class="section">
          <h2 class="section__title" style={{ borderColor: s.color ?? 'transparent' }}>
            {s.title}
          </h2>
          {s.rows.map((it) => (
            <ItemCard item={it} cityId={null} />
          ))}
        </section>
      ))}
    </>
  );
}
