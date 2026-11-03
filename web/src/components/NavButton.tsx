import { directionsUrl, navQuery, openDirections } from '../nav.ts';

/** 🧭 — directions to this place in the Google Maps app. */
export function NavButton({ name, cityId, location }: { name: string; cityId?: string | null; location?: string | null }) {
  if (!name.trim()) return null;
  const query = navQuery(name, { cityId, location });
  return (
    <a
      class="icon-btn"
      href={directionsUrl(query)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`ניווט אל ${name}`}
      title="ניווט ב-Google Maps"
      onClick={(e) => {
        e.preventDefault();
        openDirections(query);
      }}
    >
      🧭
    </a>
  );
}
