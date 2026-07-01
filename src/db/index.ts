import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { Card, CardProgress, DayActivity, FlaggedCard } from '../types';

interface LemmaDB extends DBSchema {
  cards: {
    key: string;
    value: Card;
    indexes: { 'by-topic': string };
  };
  progress: {
    key: string;
    value: CardProgress;
    indexes: { 'by-next-review': string; 'by-level': number };
  };
  activity: {
    key: string; // ISO date "2026-04-01"
    value: DayActivity;
  };
  flagged: {
    key: string; // cardId
    value: FlaggedCard;
  };
}

let _db: IDBPDatabase<LemmaDB> | null = null;

async function getDB(): Promise<IDBPDatabase<LemmaDB>> {
  if (_db) return _db;
  _db = await openDB<LemmaDB>('lemma', 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const cardStore = db.createObjectStore('cards', { keyPath: 'id' });
        cardStore.createIndex('by-topic', 'topicId');
        const progressStore = db.createObjectStore('progress', { keyPath: 'cardId' });
        progressStore.createIndex('by-next-review', 'nextReviewDate');
        progressStore.createIndex('by-level', 'level');
        db.createObjectStore('activity', { keyPath: 'date' });
      }
      if (oldVersion < 2) {
        db.createObjectStore('flagged', { keyPath: 'cardId' });
      }
    },
  });
  return _db;
}

// ── Cards ──────────────────────────────────────────────────────────────────

export async function getAllCards(): Promise<Card[]> {
  const db = await getDB();
  return db.getAll('cards');
}

export async function getCardsByTopic(topicId: string): Promise<Card[]> {
  const db = await getDB();
  return db.getAllFromIndex('cards', 'by-topic', topicId);
}

export async function putCard(card: Card): Promise<void> {
  const db = await getDB();
  await db.put('cards', card);
}

export async function putCards(cards: Card[]): Promise<void> {
  const db = await getDB();
  const BATCH = 500;
  for (let i = 0; i < cards.length; i += BATCH) {
    const batch = cards.slice(i, i + BATCH);
    const tx = db.transaction('cards', 'readwrite');
    await Promise.all([...batch.map(c => tx.store.put(c)), tx.done]);
  }
}

export async function deleteCard(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('cards', id);
}

export async function countCards(): Promise<number> {
  const db = await getDB();
  return db.count('cards');
}

// ── Progress ───────────────────────────────────────────────────────────────

export async function getAllProgress(): Promise<CardProgress[]> {
  const db = await getDB();
  return db.getAll('progress');
}

export async function getProgress(cardId: string): Promise<CardProgress | undefined> {
  const db = await getDB();
  return db.get('progress', cardId);
}

export async function putProgress(progress: CardProgress): Promise<void> {
  const db = await getDB();
  await db.put('progress', progress);
}

export async function getDueCards(today: string): Promise<CardProgress[]> {
  const db = await getDB();
  const all = await db.getAll('progress');
  return all.filter(p => p.nextReviewDate <= today);
}

// Дробный счётчик: level × 0.2 для lvl 1–4, архив = 1.0. Сумма округляется.
// Множество id карточек, реально существующих в текущей базе (cards-стор
// синхронизируется с WORDS при загрузке — см. self-heal reseed в MainScreen).
// Прогресс удалённых при ревизии карточек остаётся «висячим» в IndexedDB —
// его НЕ учитываем в счётчиках, иначе шапка «знаю слов» завышена относительно
// суммы по темам (TopicModal считает только по существующим карточкам).
async function getValidCardIds(db: IDBPDatabase<LemmaDB>): Promise<Set<string>> {
  const keys = await db.getAllKeys('cards');
  return new Set(keys as string[]);
}

export async function getKnownCount(): Promise<number> {
  const db = await getDB();
  const [all, valid] = await Promise.all([db.getAll('progress'), getValidCardIds(db)]);
  let sum = 0;
  for (const p of all) {
    if (!valid.has(p.cardId)) continue; // орфан удалённой карточки
    if (p.archived) { sum += 1; continue; }
    if (p.level <= 0) continue;
    sum += Math.min(p.level, 4) * 0.2;
  }
  return Math.round(sum);
}

export async function getArchivedCount(): Promise<number> {
  const db = await getDB();
  const [all, valid] = await Promise.all([db.getAll('progress'), getValidCardIds(db)]);
  return all.filter(p => !!p.archived && valid.has(p.cardId)).length;
}

export async function getLevelDistribution(): Promise<Record<number, number>> {
  const db = await getDB();
  const [all, valid] = await Promise.all([db.getAll('progress'), getValidCardIds(db)]);
  const dist: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const p of all) {
    if (!valid.has(p.cardId)) continue; // орфан удалённой карточки
    const lvl = Math.min(p.level, 4);
    dist[lvl] = (dist[lvl] ?? 0) + 1;
  }
  return dist;
}

// ── Activity ───────────────────────────────────────────────────────────────

export async function recordActivity(date: string): Promise<void> {
  const db = await getDB();
  const existing = await db.get('activity', date);
  await db.put('activity', {
    date,
    count: (existing?.count ?? 0) + 1,
  });
}

export async function getActivity(days = 90): Promise<DayActivity[]> {
  const db = await getDB();
  const all = await db.getAll('activity');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0]!;
  return all.filter(a => a.date >= cutoffStr).sort((a, b) => a.date.localeCompare(b.date));
}

export async function clearAllProgress(): Promise<void> {
  const db = await getDB();
  await db.clear('progress');
  await db.clear('activity');
}

// ── Backup / restore ─────────────────────────────────────────────────────────

export interface BackupData {
  progress: CardProgress[];
  activity: DayActivity[];
  flagged: FlaggedCard[];
}

export async function exportData(): Promise<BackupData> {
  const db = await getDB();
  const [progress, activity, flagged] = await Promise.all([
    db.getAll('progress'),
    db.getAll('activity'),
    db.getAll('flagged'),
  ]);
  return { progress, activity, flagged };
}

// Полностью заменяет прогресс/активность/флаги данными из бэкапа.
export async function importData(data: Partial<BackupData>): Promise<void> {
  const db = await getDB();
  {
    const tx = db.transaction('progress', 'readwrite');
    await tx.store.clear();
    if (Array.isArray(data.progress)) for (const p of data.progress) await tx.store.put(p);
    await tx.done;
  }
  {
    const tx = db.transaction('activity', 'readwrite');
    await tx.store.clear();
    if (Array.isArray(data.activity)) for (const a of data.activity) await tx.store.put(a);
    await tx.done;
  }
  {
    const tx = db.transaction('flagged', 'readwrite');
    await tx.store.clear();
    if (Array.isArray(data.flagged)) for (const f of data.flagged) await tx.store.put(f);
    await tx.done;
  }
}

// ── Flagged cards ──────────────────────────────────────────────────────────

export async function putFlagged(card: FlaggedCard): Promise<void> {
  const db = await getDB();
  await db.put('flagged', card);
}

export async function getAllFlagged(): Promise<FlaggedCard[]> {
  const db = await getDB();
  const all = await db.getAll('flagged');
  return all.sort((a, b) => b.timestamp - a.timestamp);
}

export async function deleteFlagged(cardId: string): Promise<void> {
  const db = await getDB();
  await db.delete('flagged', cardId);
}

export async function getFlaggedCount(): Promise<number> {
  const db = await getDB();
  return db.count('flagged');
}

// ── Seed check ─────────────────────────────────────────────────────────────

export async function isSeeded(): Promise<boolean> {
  const count = await countCards();
  return count > 0;
}
