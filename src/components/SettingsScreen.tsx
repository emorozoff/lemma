import { FC, useRef, useState, useEffect } from 'react';
import { clearAllProgress, exportData, importData } from '../db';
import { AudioMode, getAudioMode, setAudioMode, stopSpeech, isLenientInputEnabled, setLenientInputEnabled, isFastInputEnabled, setFastInputEnabled, preloadAllAudio } from '../lib/audio';
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
  const [lenientOn, setLenientOn] = useState(isLenientInputEnabled);
  const [holdPct, setHoldPct] = useState(0);
  const [showResetWarn, setShowResetWarn] = useState(false);
  const [showResetFinal, setShowResetFinal] = useState(false);
  const holdTimerRef = useRef<number | null>(null);
  const holdStartRef = useRef(0);
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

  const toggleLenient = () => {
    const next = !lenientOn;
    setLenientInputEnabled(next);
    setLenientOn(next);
  };

  const RESET_HOLD_MS = 10000;
  const startHold = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    holdStartRef.current = Date.now();
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    holdTimerRef.current = window.setInterval(() => {
      const pct = Math.min(100, ((Date.now() - holdStartRef.current) / RESET_HOLD_MS) * 100);
      setHoldPct(pct);
      if (pct >= 100) { cancelHold(); setShowResetWarn(true); }
    }, 50);
  };
  const cancelHold = () => {
    if (holdTimerRef.current) { clearInterval(holdTimerRef.current); holdTimerRef.current = null; }
    setHoldPct(0);
  };
  useEffect(() => () => { if (holdTimerRef.current) clearInterval(holdTimerRef.current); }, []);

  const handleReset = async () => {
    await clearAllProgress();
    onProgressReset();
    setShowResetFinal(false);
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

        <div className="settings-row" onClick={toggleLenient}>
          <span className="settings-label">нестрогий ввод</span>
          <span className={`settings-toggle${lenientOn ? ' on' : ''}`}>
            {lenientOn ? '◉ ВКЛ' : '◎ ВЫКЛ'}
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

        <button
          className="settings-danger-btn reset-hold-btn"
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerCancel={cancelHold}
          onContextMenu={e => e.preventDefault()}
        >
          <span className="reset-hold-fill" style={{ width: `${holdPct}%` }} />
          <span className="reset-hold-label">
            {holdPct > 0 ? `держи… ${Math.ceil((100 - holdPct) / 10)}` : 'сбросить прогресс'}
          </span>
        </button>
      </div>

      {showResetWarn && (
        <div className="modal-overlay settings-confirm-overlay" onClick={() => setShowResetWarn(false)}>
          <div className="debug-panel" onClick={e => e.stopPropagation()}>
            <div className="debug-title">// СБРОС ПРОГРЕССА</div>
            <div className="settings-confirm-body">
              Это полностью обнулит прогресс и НЕ может быть отменено:
              <br />• все выученные слова вернутся на уровень 0;
              <br />• счётчик «знаю слов» станет 0;
              <br />• архив выученных слов очистится;
              <br />• история активности (дни, серия) сотрётся.
              <br /><br />Слова с флажком останутся. Хочешь сохранить — сначала «сохранить прогресс».
            </div>
            <div className="debug-grid">
              <button className="debug-btn" onClick={() => setShowResetWarn(false)}>отмена</button>
              <button className="debug-btn danger" onClick={() => { setShowResetWarn(false); setShowResetFinal(true); }}>сбросить</button>
            </div>
          </div>
        </div>
      )}

      {showResetFinal && (
        <div className="modal-overlay settings-confirm-overlay" onClick={() => setShowResetFinal(false)}>
          <div className="debug-panel" onClick={e => e.stopPropagation()}>
            <div className="debug-title">// ТОЧНО СБРОСИТЬ?</div>
            <div className="settings-confirm-body">
              Последнее предупреждение. Весь прогресс будет удалён безвозвратно.
            </div>
            <div className="debug-grid">
              <button className="debug-btn" onClick={() => setShowResetFinal(false)}>отмена</button>
              <button className="debug-btn danger" onClick={handleReset}>да, сбросить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsScreen;
