export interface Card {
  id: string;
  english: string;
  russian: string;
  synonyms: string[];
  example?: string; // Sentence; target word may be wrapped in **bold** markers
  topicId: string;  // Primary topic (= CSV filename). Kept for backward compat and ID generation.
  topicIds: string[]; // All topics this card belongs to (always includes topicId as first element).
  isCustom: boolean;
  difficulty?: number; // 1–6, соответствует A1–C2 (субъективная оценка агентом при генерации)
  freqLevel?: number; // 1–10, рассчитывается из SUBTLEX-частотности (внутренняя сортировка)
  senseKey?: string; // Слой 2: группа значения (синонимы мама/мать). Карточки с одним senseKey
                     // не показываются дистракторами друг для друга (см. generateOptions).
}

export interface CardProgress {
  cardId: string;
  level: number;           // 0–5
  nextReviewDate: string;  // ISO "2026-04-01"
  consecutiveCorrect: number;
  totalCorrect: number;
  totalWrong: number;
  archived?: boolean;      // true = excluded from queue forever, counts as known
}

export interface Topic {
  id: string;
  name: string;
  icon: string; // Lucide icon name, e.g. 'Zap'
  isAdult?: boolean;
}

export interface SessionCard {
  card: Card;
  direction: 'en-ru' | 'ru-en';
  isRetry: boolean;
}

export type AppScreen = 'main' | 'topics' | 'add-word' | 'stats';

export interface DayActivity {
  date: string;
  count: number;
}

export interface FlaggedCard {
  cardId: string;
  english: string;
  russian: string;
  example?: string;
  options: string[];       // the 4 options shown at the time of flagging
  correctAnswer: string;
  timestamp: number;
}
