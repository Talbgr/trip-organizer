import { useEffect, useState } from 'preact/hooks';

// Hash routes so the app works as a static bundle and offline:
//   #/city/<cityId>            neighborhoods of a city
//   #/n/<neighborhoodId>/<cat> one neighborhood, one category
//   #/todo   #/plan   #/general

export type Route =
  | { name: 'city'; cityId: string | null }
  | { name: 'neighborhood'; id: string; category: string | null }
  | { name: 'todo' }
  | { name: 'plan' }
  | { name: 'general' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  switch (parts[0]) {
    case 'n':
      return { name: 'neighborhood', id: parts[1] ?? '', category: parts[2] || null };
    case 'todo':
      return { name: 'todo' };
    case 'plan':
      return { name: 'plan' };
    case 'general':
      return { name: 'general' };
    case 'city':
      return { name: 'city', cityId: parts[1] || null };
    default:
      return { name: 'city', cityId: null };
  }
}

export const href = {
  city: (id: string) => `#/city/${encodeURIComponent(id)}`,
  neighborhood: (id: string, category?: string) => `#/n/${encodeURIComponent(id)}${category ? `/${category}` : ''}`,
  todo: () => '#/todo',
  plan: () => '#/plan',
  general: () => '#/general',
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseRoute(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
