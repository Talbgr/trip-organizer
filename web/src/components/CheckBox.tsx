import { useApp } from '../state.tsx';
import { formatWhen } from '../ui.ts';

const LABEL = { none: 'לא סומן', done: 'בוצע', missed: 'פספסנו' } as const;
const ICON = { none: '', done: '✓', missed: '✕' } as const;

/** Tap cycles ☐ → ✅ done → ❌ missed → ☐. Shared between both phones. */
export function CheckBox({ checkKey, name }: { checkKey: string; name: string }) {
  const { checks, cycleCheck, online, person } = useApp();
  const entry = checks[checkKey];
  const state = entry?.state ?? 'none';
  const who = entry ? ` · ${entry.by} · ${formatWhen(entry.at)}` : '';
  return (
    <button
      class={`check check--${state}`}
      disabled={!online || !person}
      onClick={() => void cycleCheck(checkKey)}
      aria-label={`${name}: ${LABEL[state]}${who}. לחיצה לשינוי`}
      title={`${LABEL[state]}${who}`}
    >
      {ICON[state]}
    </button>
  );
}

/** CSS class for a row whose check is done / missed (dimmed). */
export function checkClass(state: string | undefined): string {
  return state ? `is-${state}` : '';
}
