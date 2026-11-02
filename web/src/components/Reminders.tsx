import { useState } from 'preact/hooks';
import type { Reminder } from '../../../shared/types.ts';
import { STATE_LABELS } from '../../../shared/labels.ts';
import { href } from '../router.ts';
import { useApp } from '../state.tsx';
import { formatWhen } from '../ui.ts';
import { ReminderControls } from './ItemCard.tsx';

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
    </article>
  );
}

export function TodoView() {
  const { pending, handled } = useApp();
  const [showDone, setShowDone] = useState(false);
  return (
    <>
      <h1 class="page-title">להזמין / לשלם</h1>
      {pending.length === 0 && <p class="empty">הכל טופל 🎉</p>}
      {pending.map((r) => (
        <ReminderRow r={r} />
      ))}
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
  const { pending } = useApp();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (dismissed || pending.length === 0) return null;
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
          <h2 id="reminders-title">🔔 לטיפול ({pending.length})</h2>
          <button class="icon-btn" onClick={close} aria-label="סגור">
            ✕
          </button>
        </div>
        <div class="modal__body">
          {pending.map((r) => (
            <ReminderRow r={r} />
          ))}
        </div>
        <button class="btn wide" onClick={close}>
          סגור
        </button>
      </div>
    </div>
  );
}
