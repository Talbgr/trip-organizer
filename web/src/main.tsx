import { render } from 'preact';
import { App } from './App.tsx';
import { loadTrip } from './api.ts';
import { AppProvider } from './state.tsx';
import './styles.css';

const root = document.getElementById('app')!;

async function start() {
  try {
    const trip = await loadTrip();
    document.title = trip.title;
    render(
      <AppProvider trip={trip}>
        <App />
      </AppProvider>,
      root,
    );
  } catch {
    root.innerHTML = '<p class="empty">לא הצלחנו לטעון את הטיול. בדקו חיבור לאינטרנט ונסו שוב.</p>';
  }
}

void start();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
