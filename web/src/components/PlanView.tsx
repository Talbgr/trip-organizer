import { useState } from 'preact/hooks';
import { hotelDates } from '../../../shared/places.ts';
import type { ItineraryDay, ScheduleEntry } from '../../../shared/types.ts';
import { useApp } from '../state.tsx';
import { formatDate, localToday, textOn } from '../ui.ts';
import { ItemCard } from './ItemCard.tsx';
import { ScheduleEditor } from './ScheduleEditor.tsx';

/** Timed entries first, by time; then untimed ones in the order they were added. */
function byTime(a: ScheduleEntry, b: ScheduleEntry): number {
  if (a.time && b.time) return a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt);
  if (a.time) return -1;
  if (b.time) return 1;
  return a.createdAt.localeCompare(b.createdAt);
}

/** The day-by-day sheet as written, grouped by hotel stay, plus what we added in the app. */
export function PlanView() {
  const { trip, schedule, hotels, places, online, person } = useApp();
  const { itinerary } = trip;
  const [editing, setEditing] = useState<{ date: string; entry: ScheduleEntry | null } | null>(null);
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
  const canAdd = online && !!person;

  return (
    <>
      <h1 class="page-title">{itinerary.title}</h1>
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
              return (
                <div class={`day ${d.date === today ? 'day--today' : ''}`} id={d.date ? `day-${d.date}` : undefined}>
                  <div class="day__when">
                    <strong>{formatDate(d.date)}</strong>
                    <span>{d.day}</span>
                  </div>
                  <div class="day__what">
                    <div class="day__loc">{d.location}</div>
                    {d.activity && (
                      <p class="day__act" dir="auto">
                        {d.activity}
                      </p>
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
                      <button class="entry" onClick={() => setEditing({ date: e.date, entry: e })} aria-label={`עריכה: ${e.text}`}>
                        {e.time && <span class="entry__time">{e.time}</span>}
                        <span class="entry__text" dir="auto">
                          {e.text}
                        </span>
                        <span class="entry__by">{e.createdBy}</span>
                      </button>
                    ))}
                    {d.date && (
                      <button class="add-link" disabled={!canAdd} onClick={() => setEditing({ date: d.date!, entry: null })}>
                        + הוסף
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
    </>
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
