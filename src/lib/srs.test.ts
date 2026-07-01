import { describe, it, expect } from 'vitest';
import {
  processAnswer, processLevel0Answer, processFinaleAnswer, checkManualAnswer,
  progressScore, getCurrentLevel, getLevelProgress, addDays,
  generateOptions, buildQueue, isSameLemmaRu, MAX_LEVEL,
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
  it('strict by default: one typo is rejected', () => {
    expect(checkManualAnswer('aple', 'apple')).toBe(false);
  });
  it('lenient: tolerates one typo in long words', () => {
    expect(checkManualAnswer('aple', 'apple', true)).toBe(true);
  });
  it('lenient: rejects two+ typos', () => {
    expect(checkManualAnswer('aplee', 'apple', true)).toBe(false);
  });
  it('lenient: short words (≤3) still require exact match', () => {
    expect(checkManualAnswer('bat', 'cat', true)).toBe(false);
    expect(checkManualAnswer('cat', 'cat', true)).toBe(true);
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
  it('beyond the cap stays at the top level (5072 = весь словарь Lemma)', () => {
    expect(getCurrentLevel(9000).min).toBe(5072);
    expect(getCurrentLevel(5072).title).toBe('Весь словарь Lemma');
  });
  it('progress is 0% at a level boundary, grows toward next', () => {
    expect(getLevelProgress(0)).toBe(0);
    expect(getLevelProgress(40)).toBeGreaterThan(0);
    expect(getLevelProgress(40)).toBeLessThan(100);
  });
});

describe('isSameLemmaRu (Layer 1 distractor filter)', () => {
  it('merges word-forms of the same lemma', () => {
    expect(isSameLemmaRu('дом', 'дома')).toBe(true);
    expect(isSameLemmaRu('рука', 'руки')).toBe(true);
    expect(isSameLemmaRu('дело', 'дела')).toBe(true);
    expect(isSameLemmaRu('стоять', 'стоит')).toBe(true);
    expect(isSameLemmaRu('стоять', 'стоял')).toBe(true);
    expect(isSameLemmaRu('получать', 'получает')).toBe(true);
  });
  it('keeps different words apart (incl. synonyms = Layer 2)', () => {
    expect(isSameLemmaRu('мама', 'мать')).toBe(false);
    expect(isSameLemmaRu('карман', 'картинки')).toBe(false);
    expect(isSameLemmaRu('стол', 'столица')).toBe(false);
    expect(isSameLemmaRu('дом', 'дело')).toBe(false);
    expect(isSameLemmaRu('кот', 'кит')).toBe(false);
  });
});

describe('buildQueue practice-ahead (tier 3)', () => {
  const mk = (id: string, en: string, ru: string): Card => ({
    id, english: en, russian: ru, synonyms: [], topicId: 'basic', topicIds: ['basic'], isCustom: false,
  });
  const all: Card[] = [mk('1', 'a', 'а'), mk('2', 'b', 'б'), mk('3', 'c', 'ц'), mk('4', 'd', 'д')];

  it('appends practice-ahead cards after due+new, preserving their order', () => {
    const due = [p({ cardId: '1', level: 2 })];
    const newCards = [all[1]!];
    const practiceAhead = [all[2]!, all[3]!];
    const q = buildQueue(due, newCards, all, 'en-ru', practiceAhead);
    expect(q.length).toBe(4);
    // tier 3 stays last and in given order
    expect(q[2]!.card.id).toBe('3');
    expect(q[3]!.card.id).toBe('4');
    // tiers 1–2 come first (shuffled, order-independent)
    expect(new Set([q[0]!.card.id, q[1]!.card.id])).toEqual(new Set(['1', '2']));
  });

  it('without practice-ahead behaves as before (3-arg call valid)', () => {
    const q = buildQueue([], [all[0]!], all);
    expect(q.length).toBe(1);
    expect(q[0]!.card.id).toBe('1');
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
  it('never offers a same-lemma word-form as a distractor (дом vs дома)', () => {
    const ru: Card[] = [
      mk('1', 'house', 'дом'), mk('2', 'houses', 'дома'), mk('3', 'pocket', 'карман'),
      mk('4', 'window', 'окно'), mk('5', 'door', 'дверь'), mk('6', 'table', 'стол'),
    ];
    for (let i = 0; i < 25; i++) {
      const opts = generateOptions(ru[0]!, 'en-ru', ru);
      expect(opts.length).toBe(4);
      expect(opts).toContain('дом');
      expect(opts).not.toContain('дома');
    }
  });

  it('never offers a same-senseKey синоним as a distractor (Layer 2: мама vs мать)', () => {
    const mkS = (id: string, en: string, ru: string, senseKey?: string): Card => ({
      id, english: en, russian: ru, synonyms: [], topicId: 'family', topicIds: ['family'], isCustom: false, senseKey,
    });
    const cards: Card[] = [
      mkS('1', 'mom', 'мама', 'family__mother'),
      mkS('2', 'mother', 'мать', 'family__mother'),
      mkS('3', 'mommy', 'мамочка', 'family__mother'),
      mkS('4', 'dad', 'папа', 'family__father'),
      mkS('5', 'sister', 'сестра'),
      mkS('6', 'brother', 'брат'),
    ];
    for (let i = 0; i < 30; i++) {
      // en-ru: correct = мама, must not offer мать/мамочка (same sense)
      const opts = generateOptions(cards[0]!, 'en-ru', cards);
      expect(opts).toContain('мама');
      expect(opts).not.toContain('мать');
      expect(opts).not.toContain('мамочка');
      // ru-en: correct = mom, must not offer mother/mommy (same sense)
      const optsEn = generateOptions(cards[0]!, 'ru-en', cards);
      expect(optsEn).toContain('mom');
      expect(optsEn).not.toContain('mother');
      expect(optsEn).not.toContain('mommy');
    }
  });
});
