import { describe, it, expect } from 'vitest';
import {
  processAnswer, processLevel0Answer, processFinaleAnswer, checkManualAnswer,
  progressScore, getCurrentLevel, getLevelProgress, addDays,
  generateOptions, MAX_LEVEL,
} from './srs';
import type { Card, CardProgress } from '../types';

const p = (over: Partial<CardProgress> = {}): CardProgress => ({
  cardId: 'x', level: 0, nextReviewDate: '2026-01-01',
  consecutiveCorrect: 0, totalCorrect: 0, totalWrong: 0, ...over,
});

describe('addDays', () => {
  it('crosses month boundary', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
  });
});

describe('processLevel0Answer', () => {
  it('two correct in a row → level 1', () => {
    expect(processLevel0Answer(p({ consecutiveCorrect: 1 }), true).level).toBe(1);
  });
  it('first correct stays at level 0', () => {
    const a = processLevel0Answer(p({ consecutiveCorrect: 0 }), true);
    expect(a.level).toBe(0);
    expect(a.consecutiveCorrect).toBe(1);
  });
  it('wrong resets the streak', () => {
    const a = processLevel0Answer(p({ consecutiveCorrect: 1 }), false);
    expect(a.consecutiveCorrect).toBe(0);
    expect(a.level).toBe(0);
  });
});

describe('processAnswer', () => {
  it('hard word correct → +1 level', () => {
    expect(processAnswer(p({ level: 1 }), true, 4).level).toBe(2);
  });
  it('easy word (diff ≤2) correct → +2 levels', () => {
    expect(processAnswer(p({ level: 1 }), true, 1).level).toBe(3);
  });
  it('caps at MAX_LEVEL', () => {
    expect(processAnswer(p({ level: MAX_LEVEL }), true, 1).level).toBe(MAX_LEVEL);
  });
  it('wrong → -1 but never below 1', () => {
    expect(processAnswer(p({ level: 3 }), false).level).toBe(2);
    expect(processAnswer(p({ level: 1 }), false).level).toBe(1);
  });
});

describe('processFinaleAnswer', () => {
  it('correct archives the card', () => {
    expect(processFinaleAnswer(p({ level: MAX_LEVEL }), true).archived).toBe(true);
  });
  it('wrong does not archive', () => {
    expect(processFinaleAnswer(p({ level: MAX_LEVEL }), false).archived).toBeFalsy();
  });
});

describe('checkManualAnswer', () => {
  it('exact match, case- and space-insensitive', () => {
    expect(checkManualAnswer('  Apple ', 'apple')).toBe(true);
  });
  it('tolerates one typo in long words', () => {
    expect(checkManualAnswer('aple', 'apple')).toBe(true);
  });
  it('rejects two+ typos', () => {
    expect(checkManualAnswer('aplee', 'apple')).toBe(false);
  });
  it('short words (≤3) require exact match', () => {
    expect(checkManualAnswer('bat', 'cat')).toBe(false);
    expect(checkManualAnswer('cat', 'cat')).toBe(true);
  });
  it('empty input is wrong', () => {
    expect(checkManualAnswer('', 'apple')).toBe(false);
  });
});

describe('progressScore', () => {
  it('archived = 1.0', () => expect(progressScore(p({ archived: true }))).toBe(1));
  it('level 0 = 0', () => expect(progressScore(p({ level: 0 }))).toBe(0));
  it('level 2 = 0.4', () => expect(progressScore(p({ level: 2 }))).toBeCloseTo(0.4));
  it('level 4 = 0.8', () => expect(progressScore(p({ level: 4 }))).toBeCloseTo(0.8));
});

describe('levels', () => {
  it('0 known → Чистый лист', () => {
    expect(getCurrentLevel(0).title).toBe('Чистый лист');
  });
  it('beyond the cap stays at the top level (7800)', () => {
    expect(getCurrentLevel(9000).min).toBe(7800);
  });
  it('progress is 0% at a level boundary, grows toward next', () => {
    expect(getLevelProgress(0)).toBe(0);
    expect(getLevelProgress(40)).toBeGreaterThan(0);
    expect(getLevelProgress(40)).toBeLessThan(100);
  });
});

describe('generateOptions', () => {
  const mk = (id: string, en: string, ru: string): Card => ({
    id, english: en, russian: ru, synonyms: [], topicId: 'basic', topicIds: ['basic'], isCustom: false,
  });
  const all: Card[] = [
    mk('1', 'apple', 'яблоко'), mk('2', 'dog', 'собака'), mk('3', 'house', 'дом'),
    mk('4', 'car', 'машина'), mk('5', 'book', 'книга'), mk('6', 'tree', 'дерево'),
  ];
  it('returns exactly 4 unique options including the correct answer', () => {
    const opts = generateOptions(all[0]!, 'en-ru', all);
    expect(opts.length).toBe(4);
    expect(opts).toContain('яблоко');
    expect(new Set(opts).size).toBe(4);
  });
});
