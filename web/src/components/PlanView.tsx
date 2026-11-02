import type { ItineraryDay } from '../../../shared/types.ts';
import { useApp } from '../state.tsx';
import { formatDate, textOn } from '../ui.ts';
import { ItemCard } from './ItemCard.tsx';

/** The day-by-day sheet exactly as written, grouped by hotel stay. */
export function PlanView() {
  const { trip } = useApp();
  const { itinerary } = trip;
  const today = new Date().toISOString().slice(0, 10);
  const blocks: Array<{ stay: number | null; days: ItineraryDay[] }> = [];
  for (const d of itinerary.days) {
    const last = blocks.at(-1);
    if (last && last.stay === d.stay && d.stay !== null) last.days.push(d);
    else blocks.push({ stay: d.stay, days: [d] });
  }
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
            {b.days.map((d) => (
              <div class={`day ${d.date === today ? 'day--today' : ''}`}>
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
                </div>
              </div>
            ))}
          </section>
        );
      })}
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
