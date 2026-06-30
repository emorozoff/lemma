import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './styles/global.css'
import App from './App'
import { ThemeProvider } from './components/ThemeProvider'

const NUKE_VERSION = 1;
const nukeKey = 'lemma_nuke_v';
let nuking = false;
if (Number(localStorage.getItem(nukeKey)) < NUKE_VERSION) {
  nuking = true;
  caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))));
  indexedDB.deleteDatabase('wordpunk');
  indexedDB.deleteDatabase('lemma');
  const keys = Object.keys(localStorage).filter(k => k !== nukeKey);
  keys.forEach(k => localStorage.removeItem(k));
  localStorage.setItem(nukeKey, String(NUKE_VERSION));
  location.reload();
}

// Автообновление PWA. registerType:'autoUpdate' сам тихо перезагружает экран,
// когда находит новую версию, — но проверку нужно инициировать вручную: на iOS
// иконка с домашнего экрана «замораживается» и сама SW не перепроверяет.
// Поэтому дёргаем registration.update() при каждом возврате в приложение
// (focus / visibilitychange) и раз в час, пока оно открыто.
if (!nuking) {
  const UPDATE_INTERVAL_MS = 60 * 60 * 1000;
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const checkForUpdate = () => { if (navigator.onLine) registration.update(); };
      setInterval(checkForUpdate, UPDATE_INTERVAL_MS);
      window.addEventListener('focus', checkForUpdate);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
