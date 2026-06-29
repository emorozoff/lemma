import React, { FC, useState, useEffect, useRef, useCallback } from 'react';
import type { Card, SessionCard } from '../types';
import {
  getAllCards, getAllProgress, getProgress,
  putProgress, putCards, deleteCard, getDueCards, getKnownCount,
  recordActivity, clearAllProgress, putFlagged,
} from '../db';

import { WORDS } from '../data/words';
import {
  buildQueue, generateOptions, processAnswer, processLevel0Answer, processFinaleAnswer,
  createInitialProgress, getCurrentLevel, getLevelProgress, checkManualAnswer,
  getToday, MAX_LEVEL,
} from '../lib/srs';
import { playCorrect, playWrong, playLevelUp, speakWord, speakSentence, stopSpeech, getAudioMode, isManualInputEnabled } from '../lib/audio';
import { hapticLight, hapticWarning, hapticSuccess } from '../lib/native';
import { getTopicById } from '../data/topics';
import { loadTopicPrefs, getWeight } from '../lib/topicPrefs';
import LevelUpPopup from './LevelUpPopup';
import LevelsModal from './LevelsModal';
import DebugPanel from './DebugPanel';

interface Props {
  prefsVersion: number;
  onOpenSettings: () => void;
  onOpenStats: () => void;
}

function renderExample(example: string, englishWord: string): React.ReactNode {
  // Sentence-first cards use **word** markers (markdown bold) for the target word.
  // Legacy cards without markers fall back to regex matching on the english word.
  if (example.includes('**')) {
    const parts = example.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <span key={i} className="example-highlight">{part.slice(2, -2)}</span>;
      }
      return part;
    });
  }
  const escaped = englishWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = example.split(regex);
  return parts.map((part, i) =>
    part.toLowerCase() === englishWord.toLowerCase()
      ? <span key={i} className="example-highlight">{part}</span>
      : part
  );
}

// На финале (lvl 4) целевое слово в предложении заменяется на ___ — пользователь должен вспомнить его и ввести вручную.
function renderExampleBlanked(example: string): React.ReactNode {
  if (example.includes('**')) {
    const parts = example.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <span key={i} className="example-blank">_____</span>;
      }
      return part;
    });
  }
  return example;
}

function getWordSizeClass(word: string): string {
  const len = word.length;
  if (len <= 6)  return 'size-xs';
  if (len <= 9)  return 'size-sm';
  if (len <= 12) return 'size-md';
  if (len <= 16) return 'size-lg';
  return 'size-xl';
}

const TYPING_SPEED_MS = 40;

const MainScreen: FC<Props> = ({ prefsVersion, onOpenSettings, onOpenStats }) => {
  const [queue, setQueue]           = useState<SessionCard[]>([]);
  const [queueIdx, setQueueIdx]     = useState(0);
  const [options, setOptions]       = useState<string[]>([]);
  const [answered, setAnswered]     = useState<null | { chosen: string; correct: string; wasCorrect: boolean }>(null);
  const [displayWord, setDisplayWord] = useState('');
  const [isTyping, setIsTyping]     = useState(false);
  const [knownCount, setKnownCount] = useState(0);
  const [levelUp, setLevelUp] = useState<{ title: string; description: string } | null>(null);
  const [xpToastKey, setXpToastKey] = useState(0); // каждый инкремент — новая анимация
  const [showXpToast, setShowXpToast] = useState(false);
  const xpToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debugOpen, setDebugOpen]       = useState(false);
  const [allCards, setAllCards]     = useState<Card[]>([]);
  const [loading, setLoading]       = useState(true);
  const [isGlitching, setIsGlitching] = useState(false);
  const [showLevels, setShowLevels] = useState(false);
  const [prevExample, setPrevExample] = useState<{ text: string; word: string; animKey: number } | null>(null);
  const pendingExampleRef = useRef<{ text: string; word: string } | null>(null);
  const prevLevelRef = useRef<string>('');
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevKnownRef = useRef<number>(0);
  const swipeTouchStartX = useRef(0);
  const swipeTouchStartY = useRef(0);
  const swipeEdge = useRef(false);


  // Flag feature
  const [flagged, setFlagged] = useState(false);

  // Archive feature — long-press switches card to inline manual input
  const [archiveChallenge, setArchiveChallenge] = useState(false);
  const archiveChallengeAtRef = useRef(0);
  const [archiveInput, setArchiveInput] = useState('');
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const [lpOpt, setLpOpt] = useState<string | null>(null);
  const lpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpPressedOptRef = useRef<string | null>(null);
  const lpFiredRef = useRef(false);

  // Level 4 manual input
  const [currentLevel, setCurrentLevel] = useState(0);
  const [manualInput, setManualInput] = useState('');
  const [showFirstLetter, setShowFirstLetter] = useState(false);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const manualSubmittedRef = useRef(false);
  const isFinale = currentLevel === MAX_LEVEL && isManualInputEnabled();

  // Mini-history: last 5 answered words
  const [history, setHistory] = useState<{ english: string; wasCorrect: boolean; typed?: string }[]>([]);

  // Отслеживаем показы слов уровня 0 внутри текущей сессии (в памяти, не в DB)
  const sessionDataRef = useRef<Map<string, { shows: number; correctCount: number; wrongCount: number }>>(new Map());

  // Seed DB on first load (re-seed if built-in word count changed)
  useEffect(() => {
    const init = async () => {
      try {
        const allExisting = await getAllCards();
        const builtInCards = allExisting.filter(c => !c.isCustom);
        const builtInCount = builtInCards.length;
        // Self-heal: reseed if count mismatch OR if cards lack topicIds (pre-v0.59 format)
        const needsReseed = builtInCount !== WORDS.length
          || (builtInCount > 0 && builtInCards.some(c => !c.topicIds || c.topicIds.length === 0));
        if (needsReseed) {
          // Put new cards first (safe upsert), then remove stale built-in cards.
          // This order ensures data is never lost if putCards fails mid-way.
          await putCards(WORDS);
          const newIds = new Set(WORDS.map(w => w.id));
          for (const c of builtInCards.filter(cc => !newIds.has(cc.id))) {
            await deleteCard(c.id);
          }
        }
        const cards = await getAllCards();
        setAllCards(cards);
        await loadQueue(cards);
        const kc = await getKnownCount();
        setKnownCount(kc);
        const lvl = getCurrentLevel(kc);
        prevLevelRef.current = lvl.title;
      } catch (e) {
        console.error('init failed:', e);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // Reload queue and knownCount when topic prefs or progress change
  useEffect(() => {
    if (!loading && allCards.length > 0) {
      (async () => {
        await loadQueue(allCards);
        const kc = await getKnownCount();
        setKnownCount(kc);
        prevLevelRef.current = getCurrentLevel(kc).title;
        sessionDataRef.current.clear();
      })();
    }
  }, [prefsVersion]);

  // Load level for current card & reset manual input state
  useEffect(() => {
    const sc = queue[queueIdx];
    if (!sc) { setCurrentLevel(0); return; }
    setManualInput('');
    setShowFirstLetter(false);
    manualSubmittedRef.current = false;
    (async () => {
      const p = await getProgress(sc.card.id);
      setCurrentLevel(p?.level ?? 0);
    })();
  }, [queue, queueIdx]);

  // Auto-check on level 4 when typed length matches target
  useEffect(() => {
    if (!isFinale || answered || manualSubmittedRef.current) return;
    const sc = queue[queueIdx];
    if (!sc) return;
    if (manualInput.length >= sc.card.english.length && manualInput.trim().length > 0) {
      handleManualSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualInput]);

  // First-letter hint on level 4 after 5s of inactivity
  useEffect(() => {
    if (!isFinale || answered) return;
    setShowFirstLetter(false);
    const t = setTimeout(() => setShowFirstLetter(true), 5000);
    return () => clearTimeout(t);
  }, [currentLevel, answered, queueIdx]);

  // Glitch animation when knownCount increases
  useEffect(() => {
    if (knownCount > prevKnownRef.current && prevKnownRef.current !== 0) {
      if (glitchTimerRef.current) clearTimeout(glitchTimerRef.current);
      setIsGlitching(true);
      glitchTimerRef.current = setTimeout(() => setIsGlitching(false), 650);
    }
    prevKnownRef.current = knownCount;
  }, [knownCount]);

  const loadQueue = async (cards: Card[]) => {
    const today = getToday();
    const dueProgress = await getDueCards(today);
    const prefs = loadTopicPrefs();

    const allProgress = await getAllProgress();
    const progressMap = new Map(allProgress.map(p => [p.cardId, p]));

    // Due cards (SRS reviews) — show all regardless of prefs, exclude archived
    const filteredDue = dueProgress.filter(p => {
      const c = cards.find(cc => cc.id === p.cardId);
      return c && c.topicId !== 'custom' && !p.archived;
    });

    // New cards — sorted by (difficulty, freqLevel), weighted by topic prefs
    const eligibleNew = cards.filter(c =>
      c.topicId !== 'custom' && !progressMap.has(c.id) && c.topicIds.some(t => getWeight(prefs, t) > 0)
    ).sort((a, b) => {
      const diffCmp = (a.difficulty ?? 6) - (b.difficulty ?? 6);
      if (diffCmp !== 0) return diffCmp;
      return (a.freqLevel ?? 10) - (b.freqLevel ?? 10);
    });

    // Group by (difficulty, freqLevel); within each bucket, weighted shuffle by topic prefs
    const byBucket = new Map<string, Card[]>();
    for (const card of eligibleNew) {
      const d = card.difficulty ?? 6;
      const f = card.freqLevel ?? 10;
      const key = `${d}-${f}`;
      if (!byBucket.has(key)) byBucket.set(key, []);
      byBucket.get(key)!.push(card);
    }
    const pool: Card[] = [];
    const bucketKeys = [...byBucket.keys()].sort((a, b) => {
      const [da, fa] = a.split('-').map(Number) as [number, number];
      const [db, fb] = b.split('-').map(Number) as [number, number];
      return da - db || fa - fb;
    });
    for (const key of bucketKeys) {
      const group = byBucket.get(key)!;
      const weighted: Card[] = [];
      for (const card of group) {
        const w = Math.max(...card.topicIds.map(t => getWeight(prefs, t)));
        for (let i = 0; i < w; i++) weighted.push(card);
      }
      for (let i = weighted.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [weighted[i], weighted[j]] = [weighted[j]!, weighted[i]!];
      }
      pool.push(...weighted);
    }
    // Unique first 20
    const seen = new Set<string>();
    const newCards: Card[] = [];
    for (const card of pool) {
      if (!seen.has(card.id)) {
        seen.add(card.id);
        newCards.push(card);
        if (newCards.length >= 20) break;
      }
    }

    const q = buildQueue(filteredDue, newCards, cards);

    setQueue(q);
    setQueueIdx(0);
    setAnswered(null);
    if (q.length > 0) {
      setupCard(q[0]!, cards);
    }
  };

  const setupCard = useCallback((sc: SessionCard, cards: Card[]) => {
    const prefs = loadTopicPrefs();
    setOptions(generateOptions(sc.card, sc.direction, cards, prefs));
    setAnswered(null);
    if (sc.direction === 'ru-en') {
      typeWord(sc.card.russian);
    } else {
      // en-ru: показываем предложение напрямую, без typing-анимации
      setDisplayWord('');
      setIsTyping(false);
    }
  }, []);

  const typeWord = (word: string) => {
    setDisplayWord('');
    setIsTyping(true);
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayWord(word.slice(0, i));
      if (i >= word.length) {
        clearInterval(interval);
        setIsTyping(false);
      }
    }, TYPING_SPEED_MS);
  };

  const showXp = () => {
    if (xpToastTimer.current) clearTimeout(xpToastTimer.current);
    setXpToastKey(k => k + 1);
    setShowXpToast(true);
    xpToastTimer.current = setTimeout(() => setShowXpToast(false), 1400);
  };

  // Проигрывает озвучку при правильном ответе в соответствии с выбранным режимом.
  // По окончании вызывает advance() для авто-перехода к следующей карточке.
  const playCorrectAnswerAudio = (english: string, example?: string) => {
    const mode = getAudioMode();
    if (mode === 'off') {
      autoAdvanceRef.current = setTimeout(() => advance(), 1600);
    } else if (mode === 'sentence' && example) {
      speakSentence(example, () => advance());
    } else {
      speakWord(english, () => advance());
    }
  };

  // Тап по карточке/слову/фразе — озвучка по выбранному режиму.
  const playByMode = (english: string, example?: string) => {
    const mode = getAudioMode();
    if (mode === 'off') return;
    if (mode === 'sentence' && example) {
      speakSentence(example, () => {});
    } else {
      speakWord(english, () => {});
    }
  };

  const playWordTap = (word: string) => {
    if (getAudioMode() === 'off') return;
    speakWord(word, () => {});
  };

  const handleAnswer = async (chosen: string) => {
    if (answered || queue.length === 0) return;
    setPrevExample(null); // убираем предыдущий пример при новом ответе
    const sc = queue[queueIdx];
    if (!sc) return;

    const correctAnswer = sc.direction === 'en-ru' ? sc.card.russian : sc.card.english;
    const allSynonyms = [correctAnswer, ...(sc.card.synonyms || [])];
    const isCorrect = allSynonyms.some(s => s.toLowerCase() === chosen.toLowerCase());

    setAnswered({ chosen, correct: correctAnswer, wasCorrect: isCorrect });
    setHistory(h => [{ english: sc.card.english, wasCorrect: isCorrect }, ...h].slice(0, 5));

    // Виброотдача (нативно на iOS, no-op в браузере)
    if (isCorrect) hapticLight();
    else hapticWarning();

    // Звук
    if (isCorrect) playCorrect();
    else playWrong();

    // TTS + авто-переход — до первого await (для iOS Safari)
    if (isCorrect) {
      if (sc.card.example && sc.direction === 'ru-en') {
        pendingExampleRef.current = { text: sc.card.example, word: sc.card.english };
      }
      playCorrectAnswerAudio(sc.card.english, sc.card.example);
    }

    // Активность — записываем каждый ответ
    await recordActivity(getToday());

    // Прогресс из DB (или создаём начальный для новых слов)
    const progressFromDB = await getProgress(sc.card.id) ?? createInitialProgress(sc.card.id);
    const isLevel0 = progressFromDB.level === 0;

    if (isLevel0) {
      // Уровень 0: прогресс сохраняется в DB после каждого ответа.
      // 2 правильных подряд (consecutiveCorrect >= 2) → уровень 1, независимо от сессии.
      // Ошибка сбрасывает consecutiveCorrect.
      const existing = sessionDataRef.current.get(sc.card.id) ?? { shows: 0, correctCount: 0, wrongCount: 0 };
      const newShows = existing.shows + 1;
      sessionDataRef.current.set(sc.card.id, {
        shows: newShows,
        correctCount: existing.correctCount + (isCorrect ? 1 : 0),
        wrongCount: existing.wrongCount + (isCorrect ? 0 : 1),
      });

      const newProgress = processLevel0Answer(progressFromDB, isCorrect);
      await putProgress(newProgress);

      if (isCorrect) showXp();

      const newKnown = await getKnownCount();
      setKnownCount(newKnown);
      const newLvl = getCurrentLevel(newKnown);
      if (newLvl.title !== prevLevelRef.current) {
        prevLevelRef.current = newLvl.title;
        setTimeout(() => { playLevelUp(); setLevelUp({ title: newLvl.title, description: newLvl.description }); }, 800);
      }

      // Вставляем обратно в очередь (не более 3 показов за сессию)
      if (newShows < 3) {
        const offset = newShows === 1
          ? 10 + Math.floor(Math.random() * 6)   // 10–15 карточек
          : 20 + Math.floor(Math.random() * 11);  // 20–30 карточек
        setQueue(prev => {
          const insertIdx = Math.min(queueIdx + 1 + offset, prev.length);
          const newQueue = [...prev];
          newQueue.splice(insertIdx, 0, { ...sc, isRetry: true });
          return newQueue;
        });
      }
    } else {
      // Уровень 1–4: стандартный SRS v2.
      // Правильно → +1 уровень (или +2 для diff 1–2), ошибка → -1 (минимум 1).
      if (isCorrect) showXp();
      const progress = processAnswer(progressFromDB, isCorrect, sc.card.difficulty);
      await putProgress(progress);
      const newKnown = await getKnownCount();
      setKnownCount(newKnown);
      const newLvl = getCurrentLevel(newKnown);
      if (newLvl.title !== prevLevelRef.current) {
        prevLevelRef.current = newLvl.title;
        setTimeout(() => { playLevelUp(); setLevelUp({ title: newLvl.title, description: newLvl.description }); }, 800);
      }
    }

  };

  const advance = useCallback(() => {
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    stopSpeech();
    if (pendingExampleRef.current) {
      setPrevExample({ ...pendingExampleRef.current, animKey: Date.now() });
      pendingExampleRef.current = null;
    }
    setQueueIdx(prev => {
      const next = prev + 1;
      setQueue(q => {
        if (next < q.length) {
          setupCard(q[next]!, allCards);
        } else {
          setAnswered(null);
          setDisplayWord('');
        }
        return q;
      });
      return next;
    });
  }, [allCards, setupCard]);

  const handleFlag = useCallback(async () => {
    const sc = queue[queueIdx];
    if (!sc) return;
    const correctAnswer = sc.direction === 'en-ru' ? sc.card.russian : sc.card.english;
    await putFlagged({
      cardId: sc.card.id,
      english: sc.card.english,
      russian: sc.card.russian,
      example: sc.card.example,
      options,
      correctAnswer,
      timestamp: Date.now(),
    });
    setFlagged(true);
    setTimeout(() => setFlagged(false), 900);
  }, [queue, queueIdx, options]);

  const handleArchive = useCallback(async () => {
    const sc = queue[queueIdx];
    if (!sc) { setArchiveChallenge(false); return; }

    const progressFromDB = await getProgress(sc.card.id) ?? createInitialProgress(sc.card.id);
    await putProgress({ ...progressFromDB, archived: true });

    const newKnown = await getKnownCount();
    setKnownCount(newKnown);

    setArchiveChallenge(false);
    setArchiveInput('');

    const archivedId = sc.card.id;
    const filtered = queue.filter(item => item.card.id !== archivedId);
    setQueue(filtered);
    const nextCard = filtered[queueIdx];
    if (nextCard) {
      setupCard(nextCard, allCards);
    } else {
      setAnswered(null);
      setDisplayWord('');
    }
  }, [queue, queueIdx, allCards, setupCard]);

  const handleManualSubmit = async () => {
    if (manualSubmittedRef.current || answered) return;
    const sc = queue[queueIdx];
    if (!sc) return;
    const correctEnglish = sc.card.english;
    if (!manualInput.trim()) return;
    manualSubmittedRef.current = true;

    const isCorrect = checkManualAnswer(manualInput, correctEnglish);
    setAnswered({ chosen: manualInput, correct: correctEnglish, wasCorrect: isCorrect });
    setHistory(h => [{ english: correctEnglish, wasCorrect: isCorrect, typed: manualInput }, ...h].slice(0, 5));

    if (isCorrect) hapticSuccess();
    else hapticWarning();

    if (isCorrect) playCorrect();
    else playWrong();

    if (isCorrect) {
      if (sc.card.example && sc.direction === 'ru-en') {
        pendingExampleRef.current = { text: sc.card.example, word: sc.card.english };
      }
      playCorrectAnswerAudio(correctEnglish, sc.card.example);
    }

    await recordActivity(getToday());
    const progressFromDB = await getProgress(sc.card.id) ?? createInitialProgress(sc.card.id);
    const next = processFinaleAnswer(progressFromDB, isCorrect);
    await putProgress(next);
    if (isCorrect) showXp();
    const newKnown = await getKnownCount();
    setKnownCount(newKnown);
    const newLvl = getCurrentLevel(newKnown);
    if (newLvl.title !== prevLevelRef.current) {
      prevLevelRef.current = newLvl.title;
      setTimeout(() => { playLevelUp(); setLevelUp({ title: newLvl.title, description: newLvl.description }); }, 800);
    }
  };

  const handleDebugReset = async () => {
    await clearAllProgress();
    sessionDataRef.current.clear();
    setKnownCount(0);
    prevLevelRef.current = getCurrentLevel(0).title;
    await loadQueue(allCards);
    setDebugOpen(false);
  };

  const handleDebugPromoteCurrent = async () => {
    const sc = queue[queueIdx];
    if (!sc) { setDebugOpen(false); return; }
    const existing = await getProgress(sc.card.id) ?? createInitialProgress(sc.card.id);
    await putProgress({
      ...existing,
      level: MAX_LEVEL,
      nextReviewDate: getToday(),
      archived: false,
    });
    setCurrentLevel(MAX_LEVEL);
    setAnswered(null);
    setManualInput('');
    setShowFirstLetter(false);
    manualSubmittedRef.current = false;
    setDebugOpen(false);
  };

  const handleMainZoneTap = useCallback(() => {
    if (answered?.wasCorrect) advance();
  }, [answered, advance]);

  const onSwipeTouchStart = (e: React.TouchEvent) => {
    swipeTouchStartX.current = e.touches[0]!.clientX;
    swipeTouchStartY.current = e.touches[0]!.clientY;
    swipeEdge.current = e.touches[0]!.clientX >= window.innerWidth - 30;
  };

  const onSwipeTouchEnd = (e: React.TouchEvent) => {
    if (!swipeEdge.current) return;
    const dx = e.changedTouches[0]!.clientX - swipeTouchStartX.current;
    const dy = Math.abs(e.changedTouches[0]!.clientY - swipeTouchStartY.current);
    if (dx < -80 && dy < 80) onOpenStats();
  };

  const currentCard = queue[queueIdx];
  const isFinished = !loading && queueIdx >= queue.length;
  const topic = currentCard ? getTopicById(currentCard.card.topicId) : null;
  const displayQuestion = currentCard
    ? (currentCard.direction === 'en-ru' ? currentCard.card.english : currentCard.card.russian)
    : '';
  const sizeClass = getWordSizeClass(displayQuestion);
  const knownLevel = getCurrentLevel(knownCount);
  const levelPct = getLevelProgress(knownCount);
  const wordsUntil = knownLevel.nextMin - knownCount;

  return (
    <div
      style={{ display: 'contents' }}
      onTouchStart={onSwipeTouchStart}
      onTouchEnd={onSwipeTouchEnd}
    >
      {/* Header */}
      <div className="header">
        <div className="header-logo" onClick={() => setDebugOpen(true)} style={{ cursor: 'pointer' }}>
          lemma_

          <span className="header-version">v0.94</span>
        </div>
        <div className="header-known" onClick={onOpenStats} style={{ cursor: 'pointer' }}>
          <span className="header-known-label">знаю слов:</span>
          <span className={`header-known-count${isGlitching ? ' glitching' : ''}`}>{knownCount}</span>
        </div>
      </div>

      {/* Level bar */}
      <div className="level-bar" onClick={() => setShowLevels(true)} style={{ cursor: 'pointer' }}>
        <div className="level-bar-top">
          <span className="level-title">{knownLevel.title}</span>
          {wordsUntil > 0 && (
            <span className="level-until">до уровня: {wordsUntil}</span>
          )}
        </div>
        <div className="level-track">
          <div className="level-fill" style={{ width: `${levelPct}%` }} />
        </div>
      </div>

      {/* Card area */}
      <div className="card-area" onClick={handleMainZoneTap}>
        {loading ? (
          <div className="empty-state">
            <div className="empty-state-title">загрузка_</div>
          </div>
        ) : isFinished ? (
          <div className="empty-state">
            <div className="empty-state-no-words">НЕТ СЛОВ_</div>
            <div className="empty-state-no-words-body">
              <span className="empty-state-no-words-line">либо ты всё выучил</span>
              <span className="empty-state-no-words-sep">//</span>
              <span className="empty-state-no-words-line">либо не выбрал темы</span>
            </div>
          </div>
        ) : currentCard ? (
          <>
            {/* Слот фиксированной высоты для XP — карточка не прыгает */}
            <div className="xp-toast-slot">
              {showXpToast && <div key={xpToastKey} className="xp-toast">▲ ОПЫТ</div>}
            </div>
            <div
              className="word-card"
              style={{ cursor: 'pointer' }}
              onClick={e => {
                e.stopPropagation();
                if (answered?.wasCorrect) { advance(); return; }
                if ((isFinale || archiveChallenge) && !answered) {
                  if (archiveChallenge) archiveInputRef.current?.focus();
                  else manualInputRef.current?.focus();
                  return;
                }
                playByMode(currentCard.card.english, currentCard.card.example);
              }}
            >
              {topic && (
                <div className="card-topic-tag">[ {topic.name.toUpperCase()} ]</div>
              )}
              {currentCard.direction === 'en-ru' && currentCard.card.example ? (
                <div className="card-sentence">
                  {(isFinale || archiveChallenge) && !answered
                    ? renderExampleBlanked(currentCard.card.example)
                    : renderExample(currentCard.card.example, currentCard.card.english)}
                </div>
              ) : (
                <div className={`card-word ${sizeClass} ${isTyping ? 'typing' : ''}`}>
                  {displayWord}
                </div>
              )}
              {answered && !answered.wasCorrect && (
                <div className="wrong-reveal">
                  <div className="wrong-reveal-pair">
                    <span className="wrong-reveal-en">{currentCard.card.english}</span>
                    <span className="wrong-reveal-sep">→</span>
                    <span className="wrong-reveal-ru">{currentCard.card.russian}</span>
                  </div>
                </div>
              )}
            </div>
            {/* Перевод и пример — под карточкой, вне рамки */}
            {answered && answered.wasCorrect && (
              <div className="card-answer-below">
                <div className="card-translation">
                  {currentCard.direction === 'en-ru'
                    ? currentCard.card.russian
                    : currentCard.card.english}
                </div>
                {/* Пример только для ru-en: при en-ru он уже виден на карточке */}
                {currentCard.direction === 'ru-en' && currentCard.card.example && (
                  <div
                    className="card-example"
                    onClick={e => { e.stopPropagation(); playByMode(currentCard.card.english, currentCard.card.example); }}
                  >
                    {renderExample(currentCard.card.example, currentCard.card.english)}
                  </div>
                )}
              </div>
            )}
            {/* Предыдущий пример — остаётся и гаснет */}
            {!answered && prevExample && (
              <div
                key={prevExample.animKey}
                className="prev-example"
                onClick={e => { e.stopPropagation(); playByMode(prevExample.word, prevExample.text); }}
              >
                {renderExample(prevExample.text, prevExample.word)}
              </div>
            )}
          </>
        ) : null}

        {/* Mini-history: last 5 words */}
        {history.length > 0 && (
          <div className="mini-history">
            {history.map((h, i) => (
              <span
                key={i}
                className="mini-history-word"
                onClick={e => { e.stopPropagation(); playWordTap(h.english); }}
              >
                {h.typed
                  ? h.english.split('').map((ch, j) => {
                      const typedCh = h.typed![j];
                      const match = typedCh && typedCh.toLowerCase() === ch.toLowerCase();
                      return <span key={j} className={match ? 'mh-green' : 'mh-red'}>{ch}</span>;
                    })
                  : <span className={h.wasCorrect ? 'mh-green' : 'mh-red'}>{h.english}</span>
                }
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Flag button — visible whenever a card is active */}
      {!isFinished && !loading && currentCard && (
        <div className="flag-row">
          <button className={`flag-btn${flagged ? ' flag-btn-active' : ''}`} onClick={handleFlag} aria-label={flagged ? 'Снять отметку' : 'Отметить карточку'}>
            ⚑
          </button>
        </div>
      )}

      {/* Options / Manual input / Continue */}
      {!isFinished && !loading && currentCard && (
        answered && !answered.wasCorrect ? (
          <div className="continue-area">
            <button className="continue-btn" onClick={advance}>
              ДАЛЕЕ →
            </button>
          </div>
        ) : isFinale || archiveChallenge ? (
          <div className="manual-wrap" onClick={() => !answered && (archiveChallenge ? archiveInputRef.current?.focus() : manualInputRef.current?.focus())}>
            {!answered && (
              <div className="manual-prompt">
                {archiveChallenge ? 'АРХИВ → ' : '→ '}{currentCard.card.russian}
              </div>
            )}
            <div className="letter-boxes">
              {Array.from({ length: currentCard.card.english.length }).map((_, i) => {
                const target = currentCard.card.english;
                const inputVal = archiveChallenge ? archiveInput : manualInput;
                const ch = answered ? target[i] : inputVal[i];
                const isSpace = target[i] === ' ';
                const hintFirst = !answered && !archiveChallenge && showFirstLetter && i === 0 && !inputVal[i];
                let cls = 'letter-box';
                if (isSpace) cls += ' space';
                if (ch && !isSpace) cls += ' filled';
                if (hintFirst) cls += ' hint';
                return (
                  <span key={i} className={cls}>
                    {ch ?? (hintFirst ? target[0] : isSpace ? '\u00B7' : '')}
                  </span>
                );
              })}
            </div>
            {!answered && (
              <>
                <input
                  ref={archiveChallenge ? archiveInputRef : manualInputRef}
                  className="manual-input-hidden"
                  type="text"
                  value={archiveChallenge ? archiveInput : manualInput}
                  autoFocus
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  onChange={e => {
                    const v = e.target.value.toLowerCase().replace(/[^a-z'\s-]/g, '');
                    if (archiveChallenge) {
                      setArchiveInput(v);
                      if (v.length >= currentCard.card.english.length && checkManualAnswer(v, currentCard.card.english)) {
                        playCorrect();
                        handleArchive();
                      }
                    } else {
                      setManualInput(v);
                    }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      if (archiveChallenge) {
                        if (checkManualAnswer(archiveInput, currentCard.card.english)) {
                          playCorrect();
                          handleArchive();
                        }
                      } else {
                        handleManualSubmit();
                      }
                    }
                  }}
                  onFocus={() => {
                    setTimeout(() => {
                      const el = document.querySelector('.letter-boxes');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 350);
                  }}
                />
                {archiveChallenge ? (
                  <button className="manual-submit-btn" onClick={() => { if (Date.now() - archiveChallengeAtRef.current < 500) return; setArchiveChallenge(false); setArchiveInput(''); }}>
                    ОТМЕНА
                  </button>
                ) : (
                  <button className="manual-submit-btn" onClick={handleManualSubmit} disabled={!manualInput.trim()}>
                    ПРОВЕРИТЬ
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="options-grid" onClick={handleMainZoneTap}>
            {options.map((opt, i) => {
              let cls = 'option-btn';
              if (answered) {
                if (opt === answered.correct) cls += ' correct';
                else if (opt === answered.chosen) cls += ' wrong';
                else cls += ' dimmed';
              }
              // ALL buttons animate during a hold — no hint which one is correct
              if (lpOpt !== null && !answered) cls += ' lp-pressing';

              const cancelLp = () => {
                if (lpTimerRef.current) { clearTimeout(lpTimerRef.current); lpTimerRef.current = null; }
                lpPressedOptRef.current = null;
                setLpOpt(null);
              };

              return (
                <button
                  key={i}
                  className={cls}
                  onClick={() => {
                    // Swallow click if timer already fired (iOS fires click after touchend)
                    if (lpFiredRef.current) { lpFiredRef.current = false; return; }
                    handleAnswer(opt);
                  }}
                  onTouchStart={e => {
                    if (answered || !currentCard) return;
                    e.preventDefault(); // prevent ghost click on iOS
                    setLpOpt(opt);      // any non-null value triggers animation on ALL buttons
                    lpPressedOptRef.current = opt;
                    lpFiredRef.current = false;
                    lpTimerRef.current = setTimeout(() => {
                      lpFiredRef.current = true;
                      const pressedOpt = lpPressedOptRef.current ?? '';
                      lpPressedOptRef.current = null;
                      setLpOpt(null);

                      // Check if the held button is the correct answer
                      const correctAnswer = currentCard.direction === 'en-ru'
                        ? currentCard.card.russian
                        : currentCard.card.english;
                      const allSynonyms = [correctAnswer, ...(currentCard.card.synonyms ?? [])];
                      const pressedIsCorrect = allSynonyms.some(
                        s => s.toLowerCase() === pressedOpt.toLowerCase()
                      );

                      if (pressedIsCorrect) {
                        setArchiveInput('');
                        setArchiveChallenge(true);
                        archiveChallengeAtRef.current = Date.now();
                        setTimeout(() => archiveInputRef.current?.focus(), 100);
                      } else {
                        // Wrong button held — count as wrong answer
                        handleAnswer(pressedOpt);
                      }
                    }, 600);
                  }}
                  onTouchEnd={cancelLp}
                  onTouchCancel={cancelLp}
                  onContextMenu={e => e.preventDefault()}
                  disabled={!!answered}
                  style={answered ? { pointerEvents: 'none' } : undefined}
                >
                  <span className="lp-fill-bar" />
                  {opt}
                </button>
              );
            })}
          </div>
        )
      )}

      {/* Bottom nav */}
      <div className="bottom-nav">
        <button className="nav-btn" onClick={onOpenSettings}>НАСТРОЙКИ</button>
        <button className="nav-btn" onClick={onOpenStats}>СТАТИСТИКА</button>
      </div>

      {/* XP toast */}
      {/* Level up popup */}
      {levelUp && (
        <LevelUpPopup
          title={levelUp.title}
          description={levelUp.description}
          onClose={() => setLevelUp(null)}
        />
      )}

      {/* Levels modal */}
      {showLevels && (
        <LevelsModal knownCount={knownCount} onClose={() => setShowLevels(false)} />
      )}

      {/* Debug panel */}
      {debugOpen && (
        <DebugPanel
          onClose={() => setDebugOpen(false)}
          onReset={handleDebugReset}
          onPromoteCurrent={handleDebugPromoteCurrent}
        />
      )}

    </div>
  );
};

export default MainScreen;
