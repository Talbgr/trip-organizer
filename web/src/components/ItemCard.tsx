import type { Item } from '../../../shared/types.ts';
import { STATE_LABELS } from '../../../shared/labels.ts';
import { useApp } from '../state.tsx';
import { formatWhen } from '../ui.ts';
import { NavButton } from './NavButton.tsx';

export function ItemCard({ item, cityId }: { item: Item; cityId: string | null }) {
  const { status } = useApp();
  const handled = item.reminderKey ? status[item.reminderKey] : undefined;
  const needsAttention = item.marking === 'attention' && !handled;
  const title = item.name || item.description;
  const description = item.name ? item.description : '';
  const cls = ['item', needsAttention && 'item--attention', (handled || item.marking === 'booked') && 'item--done']
    .filter(Boolean)
    .join(' ');

  return (
    <article class={cls}>
      <div class="item__main">
        <h3 class="item__name" dir="auto">
          {title}
        </h3>
        {description && (
          <p class="item__desc" dir="auto">
            {description}
          </p>
        )}
        {item.info && (
          <p class="item__info" dir="auto">
            {item.info.label && <span class="item__info-label">{item.info.label}: </span>}
            {item.info.value}
          </p>
        )}
        {item.marking === 'booked' && <span class="badge badge--ok">✓ הוזמן</span>}
        {item.reminderKey && <ReminderControls reminderKey={item.reminderKey} compact={!needsAttention && !handled} />}
        {handled && (
          <span class="badge badge--ok">
            ✓ {STATE_LABELS[handled.state]} · {handled.by} · {formatWhen(handled.at)}
          </span>
        )}
      </div>
      <div class="item__links">
        {item.links.map((l) => (
          <a class="icon-btn" href={l} target="_blank" rel="noopener noreferrer" aria-label="קישור" title={l}>
            🔗
          </a>
        ))}
        <NavButton name={item.name} cityId={cityId} />
      </div>
    </article>
  );
}

/** Booked / Paid buttons for a red item, or Undo once it is handled. */
export function ReminderControls({ reminderKey, compact = false }: { reminderKey: string; compact?: boolean }) {
  const { status, mark, undo, busy, online, person } = useApp();
  const entry = status[reminderKey];
  const disabled = busy === reminderKey || !online || !person;
  if (compact && !entry) return null;
  if (entry) {
    return (
      <div class="actions">
        <button class="btn btn--ghost" disabled={disabled} onClick={() => void undo(reminderKey)}>
          ↩︎ ביטול
        </button>
      </div>
    );
  }
  return (
    <div class="actions">
      <span class="badge badge--attention">לטיפול</span>
      <button class="btn" disabled={disabled} onClick={() => void mark(reminderKey, 'booked')}>
        הוזמן
      </button>
      <button class="btn" disabled={disabled} onClick={() => void mark(reminderKey, 'paid')}>
        שולם
      </button>
      {!online && <span class="muted small">אין חיבור</span>}
    </div>
  );
}
