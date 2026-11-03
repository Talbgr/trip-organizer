import { useState } from 'preact/hooks';
import type { Reminder } from '../../../shared/types.ts';
import { STATE_LABELS } from '../../../shared/labels.ts';
import { href } from '../router.ts';
import { useApp } from '../state.tsx';
import { formatWhen } from '../ui.ts';
import { UnpaidHotels } from './Hotels.tsx';
import { ReminderControls } from './ItemCard.tsx';
import { NavButton } from './NavButton.tsx';

function ReminderRow({ r }: { r: Reminder }) {
  const { status } = useApp();
  const entry = status[r.key];
  return (
    <article class={`item ${entry ? 'item--done' : 'item--attention'}`}>
      <div class="item__main">
        <h3 class="item__name" dir="auto">
          {r.name}
        </h3>
        {r.places.map((p) => (
          <div class="place">
            <p class="place__where">
              {p.neighborhoodId ? <a href={href.neighborhood(p.neighborhoodId)}>{`${p.city} · ${p.neighborhood}`}</a> : `${p.city} · ${p.neighborhood}`}
            </p>
            {p.note && (
              <p class="item__desc" dir="auto">
                {p.note}
              </p>
            )}
            {p.info && (
              <p class="item__info" dir="auto">
                {p.info}
              </p>
            )}
          </div>
        ))}
        {entry && (
          <span class="badge badge--ok">
            ✓ {STATE_LABELS[entry.state]} · {entry.by} · {formatWhen(entry.at)}
          </span>
        )}
        <ReminderControls reminderKey={r.key} />
      </div>
      <div class="item__links">
        <NavButton name={r.name} cityId={r.places.find((p) => p.cityId)?.cityId ?? null} />
      </div>
    </article>
  );
}

export function TodoView() {
  const { pending, handled, unpaidHotels } = useApp();
  const [showDone, setShowDone] = useState(false);
  return (
    <>
      <h1 class="page-title">להזמין / לשלם</h1>
      {pending.length + unpaidHotels.length === 0 && <p class="empty">הכל טופל 🎉</p>}
      {pending.map((r) => (
        <ReminderRow r={r} />
      ))}
      <UnpaidHotels />
      {handled.length > 0 && (
        <section class="section">
          <button class="btn btn--ghost wide" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'הסתר' : 'הצג'} טופלו ({handled.length})
          </button>
          {showDone && handled.map((r) => <ReminderRow r={r} />)}
        </section>
      )}
    </>
  );
}

const DISMISS_KEY = 'reminders-dismissed';

/** Shown when the app is opened while red items are still pending; closing it lasts for this visit only. */
export function ReminderPopup() {
  const { pending, unpaidHotels } = useApp();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const total = pending.length + unpaidHotels.length;
  if (dismissed || total === 0) return null;
  const close = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };
  return (
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="reminders-title" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="modal__box">
        <div class="modal__head">
          <h2 id="reminders-title">🔔 לטיפול ({total})</h2>
          <button class="icon-btn" onClick={close} aria-label="סגור">
            ✕
          </button>
        </div>
        <div class="modal__body">
          {pending.map((r) => (
            <ReminderRow r={r} />
          ))}
          <UnpaidHotels />
        </div>
        <button class="btn wide" onClick={close}>
          סגור
        </button>
      </div>
    </div>
  );
}
