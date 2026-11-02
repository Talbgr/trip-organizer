import type { Person } from '../../shared/types.ts';
import { CityView } from './components/CityView.tsx';
import { NeighborhoodView } from './components/NeighborhoodView.tsx';
import { GeneralView, PlanView } from './components/PlanView.tsx';
import { ReminderPopup, TodoView } from './components/Reminders.tsx';
import { href, useRoute, type Route } from './router.ts';
import { useApp } from './state.tsx';

export function App() {
  const route = useRoute();
  const { person, error, dismissError, online } = useApp();
  return (
    <div class="shell">
      {!online && <div class="offline">📴 אין חיבור — מוצג המידע האחרון שנשמר</div>}
      {error && (
        <div class="toast" role="alert" onClick={dismissError}>
          {error}
        </div>
      )}
      <main class="main">
        <Page route={route} />
      </main>
      <BottomNav route={route} />
      {person ? <ReminderPopup /> : <WhoAmI />}
    </div>
  );
}

function Page({ route }: { route: Route }) {
  const { trip } = useApp();
  switch (route.name) {
    case 'todo':
      return <TodoView />;
    case 'plan':
      return <PlanView />;
    case 'general':
      return <GeneralView />;
    case 'neighborhood': {
      for (const city of trip.cities) {
        const n = city.neighborhoods.find((x) => x.id === route.id);
        if (n) return <NeighborhoodView city={city} n={n} initial={route.category} />;
      }
      return <NotFound />;
    }
    case 'city': {
      const city = trip.cities.find((c) => c.id === route.cityId) ?? trip.cities[0];
      return city ? <CityView city={city} /> : <NotFound />;
    }
  }
}

function NotFound() {
  return (
    <p class="empty">
      לא נמצא. <a href="#/">לדף הראשי</a>
    </p>
  );
}

function BottomNav({ route }: { route: Route }) {
  const { pending, person, setPerson } = useApp();
  const on = (names: Route['name'][]) => (names.includes(route.name) ? 'tab tab--on' : 'tab');
  return (
    <nav class="bottom-nav" aria-label="ניווט">
      <a class={on(['city', 'neighborhood'])} href="#/">
        <span class="tab__icon">🗾</span>
        <span>ערים</span>
      </a>
      <a class={on(['todo'])} href={href.todo()}>
        <span class="tab__icon">
          🔔{pending.length > 0 && <span class="tab__badge">{pending.length}</span>}
        </span>
        <span>להזמין/לשלם</span>
      </a>
      <a class={on(['plan'])} href={href.plan()}>
        <span class="tab__icon">📅</span>
        <span>לו״ז</span>
      </a>
      <a class={on(['general'])} href={href.general()}>
        <span class="tab__icon">🚄</span>
        <span>כללי</span>
      </a>
      <button
        class="tab"
        onClick={() => setPerson(person === 'טל' ? 'עדי' : 'טל')}
        aria-label={`משתמש: ${person ?? ''}. לחיצה להחלפה`}
        title="החלפת משתמש"
      >
        <span class="tab__icon">👤</span>
        <span>{person ?? '—'}</span>
      </button>
    </nav>
  );
}

function WhoAmI() {
  const { setPerson } = useApp();
  const people: Person[] = ['טל', 'עדי'];
  return (
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="who-title">
      <div class="modal__box modal__box--small">
        <h2 id="who-title">מי משתמש בטלפון הזה?</h2>
        <div class="who">
          {people.map((p) => (
            <button class="btn btn--big" onClick={() => setPerson(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
