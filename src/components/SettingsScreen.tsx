import { FC, useRef, useState } from 'react';
import { clearAllProgress, exportData, importData } from '../db';
import { AudioMode, getAudioMode, setAudioMode, stopSpeech, isManualInputEnabled, setManualInputEnabled, isFastInputEnabled, setFastInputEnabled, preloadAllAudio } from '../lib/audio';
import { useTheme } from './ThemeProvider';
import { THEME_ORDER, THEME_LABELS } from '../lib/theme';
import { WORDS } from '../data/words';

const AUDIO_ORDER: AudioMode[] = ['off', 'word', 'sentence'];
const AUDIO_LABELS: Record<AudioMode, string> = {
  off: '◎ ВЫКЛ',
  word: '◉ СЛОВО',
  sentence: '◉ ФРАЗА',
};

interface Props {
  onClose: () => void;
  onOpenTopics: () => void;
  onOpenAddWord: () => void;
  onProgressReset: () => void;
}

const DISMISS_THRESHOLD = 100;

const SettingsScreen: FC<Props> = ({ onClose, onOpenTopics, onOpenAddWord, onProgressReset }) => {
  const [audioMode, setAudioModeState] = useState<AudioMode>(getAudioMode);
  const [manualOn, setManualOn] = useState(isManualInputEnabled);
  const [confirmReset, setConfirmReset] = useState(false);
  const { mode: themeMode, setMode: setThemeMode } = useTheme();

  const cycleTheme = () => {
    const idx = THEME_ORDER.indexOf(themeMode);
    setThemeMode(THEME_ORDER[(idx + 1) % THEME_ORDER.length]!);
  };

  const [fastOn, setFastOn] = useState(isFastInputEnabled);
  const toggleFast = () => { const n = !fastOn; setFastInputEnabled(n); setFastOn(n); };

  const [dl, setDl] = useState<{ active: boolean; done: number; total: number }>({ active: false, done: 0, total: 0 });
  const stopRef = useRef(false);
  const startDownload = async () => {
    if (dl.active) { stopRef.current = true; return; }
    stopRef.current = false;
    setDl({ active: true, done: 0, total: 0 });
    // Грузим от самых лёгких слов к сложным: сначала по уровню сложности
    // (difficulty 1=A1 … 6=C2), при равенстве — по частотности (freqLevel:
    // меньше = более частотное = легче). Так пользователь раньше всего
    // получает аудио для слов, которые встретит первыми.
    const easyFirst = [...WORDS]
      .sort((a, b) =>
        (a.difficulty ?? 3) - (b.difficulty ?? 3) ||
        (a.freqLevel ?? 5) - (b.freqLevel ?? 5),
      )
      .map(w => w.english);
    await preloadAllAudio(
      easyFirst,
      (done, total) => setDl({ active: true, done, total }),
      () => stopRef.current,
    );
    setDl(prev => ({ ...prev, active: false }));
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const [backupMsg, setBackupMsg] = useState('');

  const handleExport = async () => {
    const data = await exportData();
    const settings: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      settings[k] = localStorage.getItem(k) ?? '';
    }
    const backup = { app: 'lemma', version: 1, exportedAt: new Date().toISOString(), ...data, settings };
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lemma-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupMsg('сохранено ✓');
    setTimeout(() => setBackupMsg(''), 2500);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (backup.app !== 'lemma') { setBackupMsg('это не бэкап Lemma'); return; }
      await importData(backup);
      if (backup.settings && typeof backup.settings === 'object') {
        for (const [k, v] of Object.entries(backup.settings)) {
          if (typeof v === 'string') localStorage.setItem(k, v);
        }
      }
      location.reload();
    } catch {
      setBackupMsg('не удалось прочитать файл');
    }
  };

  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const isDragging = useRef(false);

  const dismiss = () => {
    const sheet = sheetRef.current;
    if (!sheet) { onClose(); return; }
    sheet.style.transition = 'transform 0.25s ease';
    sheet.style.transform = 'translateY(110%)';
    setTimeout(onClose, 250);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0]!.clientY;
    isDragging.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const delta = e.touches[0]!.clientY - dragStartY.current;
    if (delta <= 0) return;
    if (sheet.scrollTop > 0) return;
    isDragging.current = true;
    sheet.style.transition = 'none';
    sheet.style.overflowY = 'hidden';
    sheet.style.transform = `translateY(${delta}px)`;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const delta = e.changedTouches[0]!.clientY - dragStartY.current;
    isDragging.current = false;
    sheet.style.overflowY = '';
    if (delta > DISMISS_THRESHOLD) {
      dismiss();
    } else {
      sheet.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
      sheet.style.transform = 'translateY(0)';
    }
  };

  const cycleAudioMode = () => {
    const idx = AUDIO_ORDER.indexOf(audioMode);
    const next = AUDIO_ORDER[(idx + 1) % AUDIO_ORDER.length]!;
    setAudioMode(next);
    setAudioModeState(next);
    if (next === 'off') stopSpeech();
  };

  const toggleManualInput = () => {
    const next = !manualOn;
    setManualInputEnabled(next);
    setManualOn(next);
  };

  const handleReset = async () => {
    await clearAllProgress();
    onProgressReset();
    setConfirmReset(false);
    dismiss();
  };

  return (
    <div className="modal-overlay" onClick={dismiss}>
      <div
        ref={sheetRef}
        className="modal-sheet settings-sheet"
        onClick={e => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="modal-handle" />
        <div className="modal-title">НАСТРОЙКИ_</div>

        <div className="settings-row" onClick={cycleAudioMode}>
          <span className="settings-label">озвучка</span>
          <span className={`settings-toggle${audioMode !== 'off' ? ' on' : ''}`}>
            {AUDIO_LABELS[audioMode]}
          </span>
        </div>

        <div className="settings-row" onClick={toggleManualInput}>
          <span className="settings-label">ввод на финале</span>
          <span className={`settings-toggle${manualOn ? ' on' : ''}`}>
            {manualOn ? '◉ ВКЛ' : '◎ ВЫКЛ'}
          </span>
        </div>

        <div className="settings-row" onClick={toggleFast}>
          <span className="settings-label">быстрый ввод</span>
          <span className={`settings-toggle${fastOn ? ' on' : ''}`}>
            {fastOn ? '◉ ВКЛ' : '◎ ВЫКЛ'}
          </span>
        </div>

        <div className="settings-row" onClick={cycleTheme}>
          <span className="settings-label">тема</span>
          <span className="settings-toggle on">{THEME_LABELS[themeMode]}</span>
        </div>

        <div className="settings-row" onClick={onOpenTopics}>
          <span className="settings-label">темы</span>
          <span className="settings-arrow">→</span>
        </div>

        <div className="settings-row" onClick={onOpenAddWord}>
          <span className="settings-label">мои слова</span>
          <span className="settings-arrow">→</span>
        </div>

        <div className="settings-row" onClick={startDownload}>
          <span className="settings-label">загрузить все аудио</span>
          <span className={`settings-toggle${dl.active ? ' on' : ''}`}>
            {dl.active
              ? `${dl.done}/${dl.total || '…'} ✕`
              : (dl.done > 0 ? 'готово ✓' : '↓ начать')}
          </span>
        </div>
        {dl.active && dl.total > 0 && (
          <div className="dl-bar">
            <div className="dl-bar-fill" style={{ width: `${Math.round((dl.done / dl.total) * 100)}%` }} />
          </div>
        )}

        <div className="settings-row" onClick={handleExport}>
          <span className="settings-label">сохранить прогресс</span>
          <span className="settings-arrow">↓</span>
        </div>

        <div className="settings-row" onClick={() => fileRef.current?.click()}>
          <span className="settings-label">восстановить прогресс</span>
          <span className="settings-arrow">↑</span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImport}
          style={{ display: 'none' }}
        />
        {backupMsg && <div className="settings-confirm-body">{backupMsg}</div>}

        <div className="settings-section-gap" />

        <button className="settings-danger-btn" onClick={() => setConfirmReset(true)}>
          сбросить прогресс
        </button>
      </div>

      {confirmReset && (
        <div className="modal-overlay settings-confirm-overlay" onClick={() => setConfirmReset(false)}>
          <div className="debug-panel" onClick={e => e.stopPropagation()}>
            <div className="debug-title">// УДАЛИТЬ ВЕСЬ ПРОГРЕСС?</div>
            <div className="settings-confirm-body">
              Это действие нельзя отменить. Все выученные слова вернутся в уровень 0.
            </div>
            <div className="debug-grid">
              <button className="debug-btn" onClick={() => setConfirmReset(false)}>отмена</button>
              <button className="debug-btn danger" onClick={handleReset}>удалить всё</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsScreen;
