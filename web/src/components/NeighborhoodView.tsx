import { useEffect, useState } from 'preact/hooks';
import { CATEGORY_ORDER, type CategoryId, type City, type Neighborhood } from '../../../shared/types.ts';
import { href } from '../router.ts';
import { CATEGORY_TABS, textOn } from '../ui.ts';
import { ItemCard } from './ItemCard.tsx';

export function NeighborhoodView({ city, n, initial }: { city: City; n: Neighborhood; initial: string | null }) {
  const available = CATEGORY_ORDER.filter((cat) => n.sections.some((s) => s.category === cat && s.items.length > 0));
  const start = (available.find((c) => c === initial) ?? available[0] ?? null) as CategoryId | null;
  const [cat, setCat] = useState<CategoryId | null>(start);
  useEffect(() => setCat(start), [n.id]);

  const sections = n.sections.filter((s) => s.category === cat && s.items.length > 0);
  const choose = (c: CategoryId) => {
    setCat(c);
    history.replaceState(null, '', href.neighborhood(n.id, c));
  };

  return (
    <>
      <header class="nhead" style={{ background: n.color ?? 'var(--card)', color: textOn(n.color) }}>
        <a class="nhead__back" href={href.city(city.id)} aria-label="חזרה">
          →
        </a>
        <div>
          <div class="nhead__city">
            {city.name}
            {n.part && ` · ${n.part.replace(`${city.name} `, '')}`}
          </div>
          <h1 class="nhead__title">{n.title}</h1>
        </div>
      </header>

      {available.length > 0 ? (
        <nav class="cat-tabs" role="tablist">
          {available.map((c) => (
            <button
              role="tab"
              aria-selected={c === cat}
              aria-label={CATEGORY_TABS[c].full}
              title={CATEGORY_TABS[c].full}
              class={`cat-tab ${c === cat ? 'cat-tab--on' : ''}`}
              onClick={() => choose(c)}
            >
              <span class="cat-tab__icon">{CATEGORY_TABS[c].icon}</span>
              {CATEGORY_TABS[c].label && <span class="cat-tab__label">{CATEGORY_TABS[c].label}</span>}
            </button>
          ))}
        </nav>
      ) : (
        <p class="empty">אין פריטים בטבלה הזו בקובץ.</p>
      )}

      {sections.map((s) => (
        <section class="section">
          {(s.subtitle || sections.length > 1) && (
            <h2 class="section__title" style={{ borderColor: s.color ?? 'transparent' }} dir="auto">
              {s.subtitle ?? s.title}
            </h2>
          )}
          {s.items.map((it) => (
            <ItemCard item={it} cityId={city.id} />
          ))}
        </section>
      ))}
    </>
  );
}
