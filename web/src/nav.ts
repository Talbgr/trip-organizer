// Directions in the Google Maps app.
//
// The destination is a search query (place name + city), because the workbook has names,
// not addresses or coordinates. Nothing here is shown to the user as data.
//
// iPhone: the `comgooglemaps://` scheme opens the Google Maps app straight into directions.
// If the app is not installed nothing happens, so after a short wait we fall back to the
// web link (which itself opens the app when iOS can, or maps in the browser).
// Elsewhere (Android, desktop) the https link is opened directly; Android hands it to the app.
// No travel mode is set, so the app uses whatever mode you used last.

const CITY_QUERY: Record<string, string> = {
  tokyo: 'Tokyo',
  fuji: 'Fujikawaguchiko',
  kyoto: 'Kyoto',
  osaka: 'Osaka',
};

/** Itinerary locations as written in the workbook → a place name Google understands. */
const LOCATION_QUERY: Record<string, string> = {
  טוקיו: 'Tokyo',
  'קוואגוצ׳יקו': 'Fujikawaguchiko',
  קיוטו: 'Kyoto',
  אוסקה: 'Osaka',
  'בנגקוק+קראבי': 'Thailand',
  בנגקוק: 'Bangkok',
  קראבי: 'Krabi',
  קופיפי: 'Koh Phi Phi',
  'קו לאנטה': 'Koh Lanta',
};

/** Workbook hotel cells end with "שולם" (paid); that word is not part of the hotel's name. */
export function cleanPlaceName(name: string): string {
  return name
    .replace(/\s*שולם\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function navQuery(name: string, where: { cityId?: string | null; location?: string | null }): string {
  const area = (where.cityId && CITY_QUERY[where.cityId]) || (where.location && LOCATION_QUERY[where.location.trim()]) || 'Japan';
  return `${cleanPlaceName(name)} ${area}`;
}

export function directionsUrl(query: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

export function iosAppUrl(query: string): string {
  return `comgooglemaps://?daddr=${encodeURIComponent(query)}`;
}

export function isIos(nav: { userAgent: string; platform?: string; maxTouchPoints?: number } = navigator): boolean {
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
}

/** Opens directions to `query`, preferring the Google Maps app. */
export function openDirections(query: string): void {
  const web = directionsUrl(query);
  if (!isIos()) {
    window.open(web, '_blank', 'noopener');
    return;
  }
  let left = false;
  const onHide = () => {
    if (document.visibilityState === 'hidden') left = true;
  };
  document.addEventListener('visibilitychange', onHide);
  window.location.href = iosAppUrl(query);
  setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide);
    // Still here: Google Maps is not installed (or the jump was blocked) — use the web link.
    if (!left && document.visibilityState === 'visible') window.open(web, '_blank', 'noopener');
  }, 1500);
}
