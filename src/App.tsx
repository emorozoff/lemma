import { useState, useCallback, useEffect } from 'react';
import MainScreen from './components/MainScreen';
import TopicModal from './components/TopicModal';
import StatsScreen from './components/StatsScreen';
import SettingsScreen from './components/SettingsScreen';
import AddWordModal from './components/AddWordModal';
import SwearingBlast from './components/SwearingBlast';
import { applyStatusBarTheme, hideSplash } from './lib/native';

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showTopics, setShowTopics] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showAddWord, setShowAddWord] = useState(false);
  const [prefsVersion, setPrefsVersion] = useState(0);
  const [blastActive, setBlastActive] = useState(false);

  useEffect(() => {
    applyStatusBarTheme('dark');
    const t = setTimeout(() => { hideSplash(); }, 200);
    return () => clearTimeout(t);
  }, []);

  // На iOS экранная клавиатура НЕ сжимает layout-viewport (100dvh остаётся
  // полным), поэтому низ экрана с полем ввода уезжает под клавиатуру. Через
  // visualViewport ловим реальную видимую высоту: пока клавиатура открыта,
  // сжимаем .app до неё (var --app-h) — карточка и буквы остаются над
  // клавиатурой; когда закрыта — откатываемся на 100dvh.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let raf = 0;
    const apply = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const kb = Math.max(0, window.innerHeight - vv.height - Math.max(0, vv.offsetTop));
        if (kb > 120) {
          root.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
          root.style.setProperty('--kb-inset', `${Math.round(kb)}px`);
        } else {
          root.style.removeProperty('--app-h');
          root.style.removeProperty('--kb-inset');
        }
      });
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    // iOS отдаёт устаревшую высоту сразу после закрытия клавиатуры — пере-синк.
    const onFocusOut = () => setTimeout(apply, 350);
    window.addEventListener('focusout', onFocusOut);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      window.removeEventListener('focusout', onFocusOut);
      cancelAnimationFrame(raf);
    };
  }, []);

  const handleTopicsClose = useCallback(() => {
    setShowTopics(false);
    setPrefsVersion(v => v + 1);
  }, []);

  const handleAddWordAdded = useCallback(() => {
    setPrefsVersion(v => v + 1);
  }, []);

  const handleProgressReset = useCallback(() => {
    setPrefsVersion(v => v + 1);
  }, []);

  const handleBlastDone = useCallback(() => setBlastActive(false), []);
  const handleSwearingActivated = useCallback(() => setBlastActive(b => b ? b : true), []);

  return (
    <div className={`app${blastActive ? ' swearing-blast' : ''}`}>
      <MainScreen
        prefsVersion={prefsVersion}
        onOpenSettings={() => setShowSettings(true)}
        onOpenStats={() => setShowStats(true)}
      />

      {showSettings && (
        <SettingsScreen
          onClose={() => setShowSettings(false)}
          onOpenTopics={() => setShowTopics(true)}
          onOpenAddWord={() => setShowAddWord(true)}
          onProgressReset={handleProgressReset}
        />
      )}

      {showTopics && (
        <TopicModal
          onClose={handleTopicsClose}
          onSwearingActivated={handleSwearingActivated}
        />
      )}

      {showStats && (
        <StatsScreen onClose={() => setShowStats(false)} />
      )}

      {showAddWord && (
        <AddWordModal
          onClose={() => setShowAddWord(false)}
          onAdded={handleAddWordAdded}
        />
      )}

      {blastActive && <SwearingBlast onDone={handleBlastDone} />}
    </div>
  );
}
