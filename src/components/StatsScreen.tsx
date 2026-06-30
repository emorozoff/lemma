import { FC, useEffect, useState, useRef } from 'react';
import { getAllProgress, getActivity, countCards, getArchivedCount, getAllFlagged, deleteFlagged, getKnownCount } from '../db';
import type { FlaggedCard } from '../types';
import type { DayActivity } from '../types';

interface Props {
  onClose: () => void;
}

const LEVEL_COLORS = [
  'var(--text-dim)',
  'color-mix(in srgb, var(--accent) 40%, var(--text-dim))',
  'color-mix(in srgb, var(--accent) 65%, var(--text-dim))',
  'color-mix(in srgb, var(--accent) 85%, var(--text-dim))',
  'var(--accent)',
];
const LEVEL_NAMES  = ['Новые', 'Lvl 1', 'Lvl 2', 'Lvl 3', 'Lvl 4 ★'];
const DISMISS_THRESHOLD = 100;

const StatsScreen: FC<Props> = ({ onClose }) => {
  const [known, setKnown] = useState(0);
  const [total, setTotal] = useState(0);
  const [archived, setArchived] = useState(0);
  const [flaggedCards, setFlaggedCards] = useState<FlaggedCard[]>([]);
  const [dist, setDist] = useState<Record<number, number>>({ 0:0,1:0,2:0,3:0,4:0 });
  const [activity, setActivity] = useState<DayActivity[]>([]);

  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const isDragging = useRef(false);

  useEffect(() => {
    const load = async () => {
      const [prog, act, cnt, arc, flagged, kc] = await Promise.all([
        getAllProgress(),
        getActivity(90),
        countCards(),
        getArchivedCount(),
        getAllFlagged(),
        getKnownCount(),
      ]);
      setTotal(cnt);
      setArchived(arc);
      setFlaggedCards(flagged);
      setKnown(kc);
      const d: Record<number, number> = {0:0,1:0,2:0,3:0,4:0};
      for (const p of prog) {
        const lvl = Math.min(p.level, 4);
        d[lvl] = (d[lvl] ?? 0) + 1;
      }
      setDist(d);
      setActivity(act);
    };
    load();
  }, []);

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

  // Build 90-day grid
  const today = new Date();
  const cells: { date: string; count: number }[] = [];
  const actMap = new Map(activity.map(a => [a.date, a.count]));
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0]!;
    cells.push({ date: dateStr, count: actMap.get(dateStr) ?? 0 });
  }

  const maxDist = Math.max(...Object.values(dist), 1);

  return (
    <div className="modal-overlay" onClick={dismiss}>
      <div
        ref={sheetRef}
        className="modal-sheet stats-sheet"
        onClick={e => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="modal-handle" />
        <div className="modal-title">СТАТИСТИКА_</div>

        <div className="stats-cards">
          <div className="stat-card">
            <div className="stat-number" style={{ color: 'var(--accent-green)' }}>{known}</div>
            <div className="stat-label">ЗНАЮ слов</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{total}</div>
            <div className="stat-label">ВСЕГО слов</div>
          </div>
        </div>
        {archived > 0 && (
          <div className="stats-archived-row">знаю слов: {archived}</div>
        )}

        <div className="stats-section-title">РАСПРЕДЕЛЕНИЕ ПО УРОВНЯМ</div>
        <div className="level-dist" style={{ marginBottom: 24 }}>
          {([0,1,2,3,4] as const).map(lvl => (
            <div key={lvl} className="level-dist-row">
              <span className="level-dist-label">{LEVEL_NAMES[lvl]}</span>
              <div className="level-dist-bar-bg">
                <div
                  className="level-dist-bar-fill"
                  style={{
                    width: `${(dist[lvl] ?? 0) / maxDist * 100}%`,
                    background: LEVEL_COLORS[lvl],
                  }}
                />
              </div>
              <span className="level-dist-count">{dist[lvl] ?? 0}</span>
            </div>
          ))}
        </div>

        <div className="stats-section-title">АКТИВНОСТЬ (90 дней)</div>
        <div className="activity-grid">
          {cells.map(cell => {
            let cls = 'activity-cell';
            if (cell.count > 0)  cls += ' active-1';
            if (cell.count > 5)  cls += ' active-2';
            if (cell.count > 15) cls += ' active-3';
            if (cell.count > 30) cls += ' active-4';
            return <div key={cell.date} className={cls} title={`${cell.date}: ${cell.count}`} />;
          })}
        </div>

        {flaggedCards.length > 0 && (
          <>
            <div className="stats-section-title">
              ФЛАГИ_ ({flaggedCards.length})
              <button
                className="flagged-copy-btn"
                onClick={() => {
                  const text = flaggedCards.map(fc => {
                    const ex = fc.example ? fc.example.replace(/\*\*/g, '') : '';
                    const opts = fc.options.map(o => o === fc.correctAnswer ? `[${o}]` : o).join(' / ');
                    return `${fc.english} → ${fc.russian}\n  ${ex}\n  ${opts}`;
                  }).join('\n\n');
                  navigator.clipboard.writeText(text).then(() => alert('Скопировано'));
                }}
              >COPY</button>
            </div>
            <div className="flagged-list">
              {flaggedCards.map(fc => (
                <div key={fc.cardId} className="flagged-item">
                  <div className="flagged-item-header">
                    <span className="flagged-en">{fc.english}</span>
                    <span className="flagged-sep">→</span>
                    <span className="flagged-ru">{fc.russian}</span>
                    <button className="flagged-remove" onClick={async () => {
                      await deleteFlagged(fc.cardId);
                      setFlaggedCards(prev => prev.filter(f => f.cardId !== fc.cardId));
                    }}>✕</button>
                  </div>
                  {fc.example && (
                    <div className="flagged-example">{fc.example.replace(/\*\*/g, '')}</div>
                  )}
                  <div className="flagged-options">
                    {fc.options.map((opt, i) => (
                      <span key={i} className={`flagged-opt${opt === fc.correctAnswer ? ' flagged-opt-correct' : ''}`}>
                        {opt}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="stats-counter-info">
          <div className="stats-section-title">КАК СЧИТАЕТСЯ СЧЁТЧИК</div>
          <p>Не заморачивайся — алгоритм сам всё считает.</p>
          <p>Каждое слово имеет свой вес: чем лучше знаешь, тем больше оно добавляет в счётчик. Новое слово — маленький вклад. Повторил через день, через неделю, через месяц — вклад растёт.</p>
          <p>Просто отвечай на карточки, а цифра будет расти сама.</p>
        </div>
      </div>
    </div>
  );
};

export default StatsScreen;
