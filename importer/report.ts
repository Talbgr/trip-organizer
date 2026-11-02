import type { Trip } from '../shared/types.ts';
import { CATEGORY_LABELS } from '../shared/labels.ts';

/** Human-readable summary of what was imported and what needs a human look. */
export function renderReport(trip: Trip, notes: string[]): string {
  const lines: string[] = [];
  lines.push('# Data report', '');
  lines.push(`Generated from \`${trip.source.file}\` (sha256 \`${trip.source.sha256.slice(0, 12)}…\`) by \`npm run import\`.`, '');
  lines.push('## Cities and neighborhoods', '');
  for (const c of trip.cities) {
    lines.push(`### ${c.name}`, '');
    lines.push('| Neighborhood | Part | Color | Categories (items) |', '|---|---|---|---|');
    for (const n of c.neighborhoods) {
      const cats = n.sections.map((s) => `${CATEGORY_LABELS[s.category]}${s.subtitle ? ` "${s.subtitle}"` : ''} (${s.items.length})`).join(', ');
      lines.push(`| ${n.title} | ${n.part ?? ''} | ${n.color ?? ''} | ${cats} |`);
    }
    lines.push('');
  }
  lines.push('## To book / To pay (red cells)', '');
  for (const r of trip.reminders)
    lines.push(`- **${r.name}** — ${r.places.map((p) => `${p.city} / ${p.neighborhood}${p.note ? `: ${p.note}` : ''}`).join(' · ')}`);
  lines.push('');
  lines.push('## Notes for review', '');
  if (!notes.length) lines.push('Nothing unusual.');
  for (const n of notes) lines.push(`- ${n}`);
  lines.push('');
  return lines.join('\n');
}
