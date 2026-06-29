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
