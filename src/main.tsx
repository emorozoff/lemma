import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App'
import { ThemeProvider } from './components/ThemeProvider'

const NUKE_VERSION = 1;
const nukeKey = 'lemma_nuke_v';
if (Number(localStorage.getItem(nukeKey)) < NUKE_VERSION) {
  caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))));
  indexedDB.deleteDatabase('wordpunk');
  indexedDB.deleteDatabase('lemma');
  const keys = Object.keys(localStorage).filter(k => k !== nukeKey);
  keys.forEach(k => localStorage.removeItem(k));
  localStorage.setItem(nukeKey, String(NUKE_VERSION));
  location.reload();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
