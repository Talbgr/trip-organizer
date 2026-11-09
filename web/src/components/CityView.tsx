import { CATEGORY_ORDER, type City, type Neighborhood } from '../../../shared/types.ts';
import { href } from '../router.ts';
import { useApp } from '../state.tsx';
import { checkKey } from '../../../shared/places.ts';
import { CATEGORY_TABS, textOn } from '../ui.ts';
import { CheckBox, checkClass } from './CheckBox.tsx';
import { CityHotels } from './Hotels.tsx';

export function CityTabs({ current }: { current: string }) {
  const { trip } = useApp();
  return (
    <nav class="city-tabs" aria-label="ערים">
      {trip.cities.map((c) => (
        <a class={`chip ${c.id === current ? 'chip--on' : ''}`} href={href.city(c.id)} aria-current={c.id === current ? 'page' : undefined}>
          {c.name}
        </a>
      ))}
    </nav>
  );
}

export function CityView({ city }: { city: City }) {
  // Group by city-label part (Tokyo has two), keeping workbook order inside each.
  const groups: Array<{ part: string | null; items: Neighborhood[] }> = [];
  for (const n of city.neighborhoods) {
    const last = groups.at(-1);
    if (last && last.part === n.part) last.items.push(n);
    else groups.push({ part: n.part, items: [n] });
  }
  return (
    <>
      <CityTabs current={city.id} />
      <CityHotels cityId={city.id} />
      {groups.map((g) => (
        <section class="group">
          {g.part && <h2 class="group__title">{g.part}</h2>}
          <div class="cards">
            {g.items.map((n) => (
              <NeighborhoodCard n={n} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function NeighborhoodCard({ n }: { n: Neighborhood }) {
  const { status, checks } = useApp();
  const items = n.sections.flatMap((s) => s.items);
  const done = items.filter((i) => checks[checkKey.item(i.id)]?.state === 'done').length;
  const missed = items.filter((i) => checks[checkKey.item(i.id)]?.state === 'missed').length;
  const counts = CATEGORY_ORDER.map((cat) => ({
    cat,
    count: n.sections.filter((s) => s.category === cat).reduce((k, s) => k + s.items.length, 0),
  })).filter((c) => c.count > 0);
  const attention = n.sections
    .flatMap((s) => s.items)
    .filter((i) => i.marking === 'attention' && i.reminderKey && !status[i.reminderKey]).length;
  const subtitle = n.sections.find((s) => s.category === 'uncategorized' && s.subtitle)?.subtitle;
  const areaKey = checkKey.area(n.id);
  return (
    <div class={`ncard-wrap ${checkClass(checks[areaKey]?.state)}`}>
    <CheckBox checkKey={areaKey} name={n.title} />
    <a class="ncard" href={href.neighborhood(n.id)} style={{ '--accent': n.color ?? 'var(--muted)' }}>
      <span class="ncard__swatch" style={{ background: n.color ?? 'transparent', color: textOn(n.color) }} />
      <span class="ncard__body">
        <span class="ncard__title">
          {n.title}
          {subtitle && <span class="ncard__sub"> · {subtitle}</span>}
        </span>
        <span class="ncard__counts">
          {counts.length === 0 && <span class="muted small">ריק בטבלה</span>}
          {counts.map(({ cat, count }) => (
            <span class="count" title={CATEGORY_TABS[cat].full}>
              {CATEGORY_TABS[cat].icon}
              {CATEGORY_TABS[cat].label && <small>{CATEGORY_TABS[cat].label}</small>} {count}
            </span>
          ))}
        </span>
        {(done > 0 || missed > 0) && (
          <span class="ncard__progress" aria-label={`בוצעו ${done}, פוספסו ${missed}, מתוך ${items.length}`}>
            {done > 0 && <span class="progress progress--done">✓ {done}</span>}
            {missed > 0 && <span class="progress progress--missed">✕ {missed}</span>}
          </span>
        )}
      </span>
      {attention > 0 && (
        <span class="dot" aria-label={`${attention} לטיפול`}>
          {attention}
        </span>
      )}
    </a>
    </div>
  );
}
