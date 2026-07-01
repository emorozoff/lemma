import type { Card, CardProgress, SessionCard } from '../types';
import { getWeight, type TopicPrefs } from './topicPrefs';

// Level 0 = новое слово (2 правильных подряд → level 1)
// Level 1 = +1 день, 2 = +3 дня, 3 = +7 дней, 4 = +14 дней (финал)
// На уровне 4 правильный ввод слова отправит его в архив (ввод вручную будет
// реализован на следующем этапе; пока слово просто остаётся на 4 через 14 дней).
export const SRS_INTERVALS = [0, 1, 3, 7, 14];
export const MAX_LEVEL = 4;

export function getToday(): string {
  return new Date().toISOString().split('T')[0]!;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0]!;
}

export function createInitialProgress(cardId: string): CardProgress {
  return {
    cardId,
    level: 0,
    nextReviewDate: getToday(),
    consecutiveCorrect: 0,
    totalCorrect: 0,
    totalWrong: 0,
  };
}

// Difficulty modifier: лёгкие слова (diff 1-2) получают +2 уровня за правильный
// ответ, остальные (diff 3-5) — +1. Ошибка всегда -1 (минимум уровень 1).
function levelStep(difficulty: number | undefined): number {
  const d = difficulty ?? 3;
  return d <= 2 ? 2 : 1;
}

// Для уровней 1–MAX_LEVEL: правильный → уровень вверх (с учётом difficulty),
// ошибка → -1 уровень (минимум 1, не 0).
export function processAnswer(
  progress: CardProgress,
  correct: boolean,
  difficulty?: number,
): CardProgress {
  const today = getToday();
  if (correct) {
    const newLevel = Math.min(progress.level + levelStep(difficulty), MAX_LEVEL);
    const interval = SRS_INTERVALS[newLevel] ?? SRS_INTERVALS[MAX_LEVEL]!;
    return {
      ...progress,
      level: newLevel,
      consecutiveCorrect: progress.consecutiveCorrect + 1,
      totalCorrect: progress.totalCorrect + 1,
      nextReviewDate: addDays(today, interval),
    };
  } else {
    const newLevel = Math.max(progress.level - 1, 1);
    const interval = SRS_INTERVALS[newLevel] ?? 1;
    return {
      ...progress,
      level: newLevel,
      consecutiveCorrect: 0,
      totalWrong: progress.totalWrong + 1,
      nextReviewDate: addDays(today, interval),
    };
  }
}

// Обработка ответа для слов уровня 0.
// Прогресс сохраняется в DB после каждого ответа.
// Продвижение на уровень 1 происходит при 2 правильных подряд (consecutiveCorrect >= 2),
// независимо от того, были они в одной сессии или в разных.
// Ошибка сбрасывает consecutiveCorrect в 0.
export function processLevel0Answer(
  progress: CardProgress,
  correct: boolean,
): CardProgress {
  const today = getToday();
  if (correct) {
    const newConsecutive = progress.consecutiveCorrect + 1;
    if (newConsecutive >= 2) {
      // 2 правильных подряд → уровень 1, следующий показ завтра
      return {
        ...progress,
        level: 1,
        consecutiveCorrect: newConsecutive,
        totalCorrect: progress.totalCorrect + 1,
        nextReviewDate: addDays(today, SRS_INTERVALS[1]!),
      };
    }
    return {
      ...progress,
      level: 0,
      consecutiveCorrect: newConsecutive,
      totalCorrect: progress.totalCorrect + 1,
      nextReviewDate: today, // доступно сегодня — в следующей сессии покажется снова
    };
  } else {
    return {
      ...progress,
      level: 0,
      consecutiveCorrect: 0,
      totalWrong: progress.totalWrong + 1,
      nextReviewDate: today,
    };
  }
}

// Расстояние Левенштейна для толерантности к опечаткам на ручном вводе.
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[m]![n]!;
}

// Проверка ручного ввода. Игнорирует регистр и окружающие пробелы.
// По умолчанию СТРОГАЯ — нужно точное совпадение. При lenient=true длинные
// слова (>3 символов) допускают 1 опечатку (levenshtein ≤ 1).
export function checkManualAnswer(input: string, correct: string, lenient = false): boolean {
  const a = input.trim().toLowerCase();
  const b = correct.trim().toLowerCase();
  if (!a) return false;
  if (a === b) return true;
  if (!lenient) return false;
  if (b.length <= 3) return false;
  return levenshtein(a, b) <= 1;
}

// Обработка ответа для уровня MAX_LEVEL (финал).
// Правильно → архив, ошибка → −1 уровень (как в processAnswer).
export function processFinaleAnswer(progress: CardProgress, correct: boolean): CardProgress {
  const today = getToday();
  if (correct) {
    return {
      ...progress,
      level: MAX_LEVEL,
      consecutiveCorrect: progress.consecutiveCorrect + 1,
      totalCorrect: progress.totalCorrect + 1,
      nextReviewDate: addDays(today, SRS_INTERVALS[MAX_LEVEL]!),
      archived: true,
    };
  }
  const newLevel = Math.max(MAX_LEVEL - 1, 1);
  return {
    ...progress,
    level: newLevel,
    consecutiveCorrect: 0,
    totalWrong: progress.totalWrong + 1,
    nextReviewDate: addDays(today, SRS_INTERVALS[newLevel] ?? 1),
  };
}

// Дробные баллы «знаю слов» по уровню:
//   0 → 0, 1 → 0.2, 2 → 0.4, 3 → 0.6, 4 → 0.8, архив → 1.0
// Сумма округляется до целого в UI.
export function progressScore(p: CardProgress): number {
  if (p.archived) return 1;
  if (p.level <= 0) return 0;
  if (p.level >= MAX_LEVEL) return 0.8;
  return p.level * 0.2;
}

// Build the session queue.
// Sentence-first cards (example contains **word** markers) always use en-ru:
// the user sees the English sentence with the target word highlighted and picks
// the Russian translation. Legacy/custom cards without markers use the requested direction.
function pickDirection(card: Card, requested: 'mixed' | 'en-ru' | 'ru-en'): 'en-ru' | 'ru-en' {
  if (card.example && card.example.includes('**')) return 'en-ru';
  if (requested === 'mixed') return Math.random() < 0.5 ? 'en-ru' : 'ru-en';
  return requested;
}

export function buildQueue(
  dueProgress: CardProgress[],
  newCards: Card[],
  allCards: Card[],
  direction: 'mixed' | 'en-ru' | 'ru-en' = 'mixed',
  practiceAhead: Card[] = [],
): SessionCard[] {
  const queue: SessionCard[] = [];

  // Map cardId -> Card for lookup
  const cardMap = new Map(allCards.map(c => [c.id, c]));

  // 1. Due cards (review)
  for (const p of dueProgress) {
    const card = cardMap.get(p.cardId);
    if (!card) continue;
    queue.push({ card, direction: pickDirection(card, direction), isRetry: false });
  }

  // 2. New cards
  for (const card of newCards) {
    queue.push({ card, direction: pickDirection(card, direction), isRetry: false });
  }

  // Shuffle (только тиры 1–2: повторения и новые)
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j]!, queue[i]!];
  }

  // 3. Практика наперёд (тир 3) — добавляем ПОСЛЕ перемешанных due+new,
  // СОХРАНЯЯ заданный порядок (он уже отсортирован по приоритету: ближайшая
  // дата → низкий уровень). Так игрок доходит до них, только когда тиры 1–2
  // пройдены — «ожидание по времени» исчезает, стена «НЕТ СЛОВ» появляется
  // лишь когда всё в архиве.
  for (const card of practiceAhead) {
    queue.push({ card, direction: pickDirection(card, direction), isRetry: false });
  }

  return queue;
}

// Generate 4 options: 1 correct + 3 random
function distractorScore(
  correctAnswer: string,
  candidate: string,
  sameTopic: boolean
): number {
  let score = 0;
  const ca = correctAnswer.toLowerCase();
  const cb = candidate.toLowerCase();

  // Same topic = semantically close
  if (sameTopic) score += 5;

  // Same first letter
  if (ca[0] === cb[0]) score += 2;

  // Similar string length (±3 chars)
  const lenDiff = Math.abs(ca.length - cb.length);
  if (lenDiff <= 2) score += 2;
  else if (lenDiff <= 5) score += 1;

  // Common prefix
  let prefix = 0;
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    if (ca[i] === cb[i]) prefix++;
    else break;
  }
  if (prefix >= 3) score += 3;
  else if (prefix >= 2) score += 1;

  return score;
}

// Normalize a translation for duplicate detection: lowercase + collapse whitespace.
// Used to make sure no distractor is also a valid answer to the prompt.
function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Same-lemma detection: morphologically related forms of the same word
// (e.g. получает / получать, gets / getting) are too easy to confuse with
// the correct answer — the user knows the word but taps the wrong form.
// We exclude any candidate that looks like a different inflection of the
// correct answer.
// ── Русская «одна лемма» (Слой 1 отсечения дистракторов-словоформ) ──────────
// Только СЛОВОИЗМЕНИТЕЛЬНЫЕ окончания (падеж/число/спряжение), без
// словообразовательных (-ость/-ник/-ица) — чтобы не схлопывать разные слова.
const RU_MULTI_ENDINGS = new Set([
  'ть', 'ться', 'тся', 'чь',
  'ла', 'ло', 'ли', 'ал', 'ял', 'ил', 'ел', 'ол', 'ул', 'ыл', 'ала', 'яла', 'ила', 'ела', 'ало', 'ило', 'али', 'или', 'ели',
  'ешь', 'ишь', 'ет', 'ем', 'ете', 'ют', 'ут', 'ит', 'им', 'ите', 'ят', 'ат', 'аю', 'яю', 'ую', 'ает', 'ают', 'еет', 'еют',
  'ать', 'ять', 'ить', 'еть', 'уть', 'оть', 'ыть',
  'ах', 'ях', 'ам', 'ям', 'ом', 'ем', 'ой', 'ей', 'ов', 'ев', 'ми', 'ью', 'ия', 'ья', 'ями', 'ами', 'иях', 'иям', 'иями', 'ией', 'ием',
  'ый', 'ий', 'ое', 'ее', 'ые', 'ие', 'ая', 'яя', 'ым', 'им', 'ых', 'их', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'юю', 'ою', 'ею',
]);
// Допустимый одиночный «хвост»: гласные + й/ь + л (прош. время м.р., стоя-л).
const RU_SINGLE_TAIL = 'аеёиоуыэюяйьл';

function normRu(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, 'е');
}
function ruEndingOk(tail: string): boolean {
  if (tail === '') return true;
  if (tail.length === 1) return RU_SINGLE_TAIL.includes(tail);
  return RU_MULTI_ENDINGS.has(tail);
}
// Одна ли лемма у двух русских переводов (дом/дома, стоять/стоял/стоит,
// рука/руки). Эвристика: общий стем ≥3 символов, а различающиеся «хвосты» с
// обеих сторон — флективные окончания. Намеренно склонна СХЛОПЫВАТЬ (лишний
// дистрактор убрать безопаснее, чем показать две формы одного слова). НЕ её
// зона: нерегулярные (мать/матери, друг/друзья) и разнокоренные синонимы
// (мама/мать) — это Слой 2 (группы значения).
export function isSameLemmaRu(a: string, b: string): boolean {
  const x = normRu(a), y = normRu(b);
  if (x === y) return true;
  const min = Math.min(x.length, y.length);
  let p = 0;
  while (p < min && x[p] === y[p]) p++;
  if (p < 3) return false;
  return ruEndingOk(x.slice(p)) && ruEndingOk(y.slice(p));
}

function isSameLemma(correct: string, candidate: string, direction: 'en-ru' | 'ru-en'): boolean {
  const a = correct.trim().toLowerCase();
  const b = candidate.trim().toLowerCase();
  if (a === b) return true;

  // Русские варианты (en-ru): стем + флективный хвост (см. isSameLemmaRu).
  if (direction === 'en-ru') return isSameLemmaRu(a, b);

  // English options: prefix-based morphology (gets/getting/get/play/played).
  // For short words (<4 chars) require the shorter to be a complete prefix
  // of the longer. For longer words require 4+ char prefix and small length diff.
  let prefix = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  const minLen = Math.min(a.length, b.length);
  const lenDiff = Math.abs(a.length - b.length);
  if (minLen < 4) return prefix === minLen && lenDiff <= 4;
  return prefix >= 4 && lenDiff <= 5;
}

export function generateOptions(
  correctCard: Card,
  direction: 'en-ru' | 'ru-en',
  allCards: Card[],
  prefs?: TopicPrefs,
): string[] {
  const correctAnswer = direction === 'en-ru' ? correctCard.russian : correctCard.english;
  const correctNorm = normalizeText(correctAnswer);
  const correctWordCount = correctAnswer.trim().split(/\s+/).length;

  // Distractor pool must respect topic prefs: words from disabled topics (weight=0)
  // must not appear as wrong-answer options, even if the correct card itself is
  // a legacy review from a previously enabled topic.
  // The correct card is always allowed through regardless of its topic weight.
  const pool = prefs
    ? allCards.filter(c => c.id === correctCard.id || c.topicIds.some(t => getWeight(prefs, t) > 0))
    : allCards;

  const scored = pool
    .filter(c => c.id !== correctCard.id)
    .map(c => {
      const text = direction === 'en-ru' ? c.russian : c.english;
      const wordCount = text.trim().split(/\s+/).length;
      let score = distractorScore(correctAnswer, text, c.topicIds.some(t => correctCard.topicIds.includes(t)));
      // Same word count is a hard preference
      if (wordCount === correctWordCount) score += 10;
      return { text, norm: normalizeText(text), score, senseKey: c.senseKey };
    })
    // Hard rule 1: a distractor that equals the correct answer (case/whitespace
    // insensitive) would be a *second* correct option — drop it. This catches
    // synonyms/duplicates across the DB (e.g. multiple cards translated "удар").
    .filter(d => d.norm !== correctNorm)
    // Hard rule 2: a distractor that's a different inflection of the same word
    // (получает/получать, gets/getting) is too easy to confuse — drop it.
    .filter(d => !isSameLemma(correctAnswer, d.text, direction))
    // Hard rule 3 (Слой 2): a distractor that's a разнокоренной синоним of the
    // correct answer (мама/мать, mom/mother) — same senseKey group — is an unfair
    // wrong option. Морфологию ловит isSameLemma; синонимы ловит senseKey.
    .filter(d => !(correctCard.senseKey && d.senseKey === correctCard.senseKey));

  // Sort by score desc, take top bucket and shuffle to add variety
  scored.sort((a, b) => b.score - a.score);
  const topBucket = scored.slice(0, Math.min(15, scored.length));
  const shuffled = topBucket.sort(() => Math.random() - 0.5);

  // Pick up to 3 distractors, deduping by normalized text so no two options
  // share the same answer string either.
  const distractors: string[] = [];
  const seen = new Set<string>([correctNorm]);
  for (const d of shuffled) {
    if (distractors.length >= 3) break;
    if (seen.has(d.norm)) continue;
    seen.add(d.norm);
    distractors.push(d.text);
  }

  // Fallback: walk the rest of the scored list if the top bucket didn't yield enough
  if (distractors.length < 3) {
    for (const d of scored) {
      if (distractors.length >= 3) break;
      if (seen.has(d.norm)) continue;
      seen.add(d.norm);
      distractors.push(d.text);
    }
  }

  const options = [correctAnswer, ...distractors];
  return options.sort(() => Math.random() - 0.5);
}

// Language level system
export interface Level {
  min: number;
  title: string;
  description: string;
}

// Шкала под реальную базу (5072 карточки ≈ 4774 уникальных слова, после ревизии
// v2). Счётчик «знаю слов» = getKnownCount() суммирует прогресс ПО КАРТОЧКАМ
// (архив = 1.0, level×0.2), поэтому его потолок = 5072 (все карточки в архиве =
// 100%). CEFR-привязка по объёму словаря: A1 ≈ 800, A2 ≈ 1500, B1 ≈ 3200,
// B2 ≈ 4700+. Верхний уровень (min 5072) = весь словарь Lemma (≈ B2, подступ к C1).
export const LEVELS: Level[] = [
  {
    min: 0,
    title: 'Чистый лист',
    description: 'Ты только начинаешь — и это уже хорошо. Первые слова появятся быстро: мозг отлично запоминает то, что встречает впервые. Через пару дней ты уже не нуль.',
  },
  {
    min: 75,
    title: 'Первые слова',
    description: 'Знаешь базовые слова и реакции: yes, no, please, sorry, thank you. Можешь назвать себя и понять простые вывески. Уже не ноль.',
  },
  {
    min: 200,
    title: 'Разговор начался',
    description: 'Набираешь обороты. Узнаёшь знакомые слова в речи и тексте, складываешь короткие фразы. Словарь ещё маленький, но он уже работает.',
  },
  {
    min: 450,
    title: 'Турист',
    description: 'Справишься в базовых ситуациях: аэропорт, отель, кафе, магазин. Понимаешь ключевые слова в объявлениях и вывесках, можешь задать простой вопрос.',
  },
  {
    min: 800,
    title: 'A1 — Начальный',
    description: 'Около 800 слов — уверенный A1 по шкале CEFR. Представишься, скажешь откуда ты, закажешь еду, спросишь дорогу. Говоришь медленно и с паузами, но тебя понимают.',
  },
  {
    min: 1500,
    title: 'A2 — Элементарный',
    description: 'Примерно 1500 слов — уровень A2. Обсуждаешь себя, семью, работу, распорядок дня. Понимаешь медленную речь на знакомые темы. Как после пары лет школьной программы.',
  },
  {
    min: 2300,
    title: 'Уверенный A2',
    description: 'Читаешь адаптированные тексты и простые статьи. Переписываешься в мессенджерах без постоянного словаря. Понимаешь основное в несложных видео с субтитрами. Это уже практический английский.',
  },
  {
    min: 3200,
    title: 'B1 — Пороговый',
    description: 'Около 3200 слов — уровень B1, международный стандарт «базовое общение». Объясняешься в большинстве бытовых ситуаций, понимаешь суть разговоров на знакомые темы.',
  },
  {
    min: 4200,
    title: 'Уверенный B1',
    description: 'Смотришь ютуб и подкасты на английском — понимаешь большую часть, если тема знакома. Пишешь сообщения без переводчика, поддерживаешь разговор, хотя иногда теряешь нить.',
  },
  {
    min: 4700,
    title: 'B2 — Продвинутый',
    description: 'Около 4700 слов — уровень B2. Свободно смотришь сериалы с субтитрами, читаешь статьи и несложные книги в оригинале, обсуждаешь абстрактные темы. Полноценный рабочий английский.',
  },
  {
    min: 5072,
    title: 'Весь словарь Lemma',
    description: 'Ты выучил весь словарный запас приложения — около 4800 слов. Это уверенный B2 на подступе к C1: понимаешь фильмы, книги и подкасты в оригинале, свободно общаешься на любые темы. Дальше — только живая практика.',
  },
];

export function getCurrentLevel(knownCount: number): { title: string; description: string; min: number; nextMin: number } {
  let current = LEVELS[0]!;
  for (const lvl of LEVELS) {
    if (knownCount >= lvl.min) current = lvl;
    else break;
  }
  const idx = LEVELS.indexOf(current);
  const next = LEVELS[idx + 1] ?? current;
  return { title: current.title, description: current.description, min: current.min, nextMin: next.min };
}

export function getLevelProgress(knownCount: number): number {
  const { min, nextMin } = getCurrentLevel(knownCount);
  if (nextMin === min) return 100;
  return Math.min(100, ((knownCount - min) / (nextMin - min)) * 100);
}
