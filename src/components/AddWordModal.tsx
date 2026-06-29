import { FC, useState, useRef } from 'react';
import { TOPICS } from '../data/topics';
import { putCard } from '../db';
import type { Card } from '../types';

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

const DISMISS_THRESHOLD = 100;

const AddWordModal: FC<Props> = ({ onClose, onAdded }) => {
  const [english, setEnglish] = useState('');
  const [russian, setRussian] = useState('');
  const [synonyms, setSynonyms] = useState('');
  const [example, setExample] = useState('');
  const [topicId, setTopicId] = useState('custom');

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

  const handleSubmit = async () => {
    if (!english.trim() || !russian.trim()) return;
    const card: Card = {
      id: `custom_${Date.now()}`,
      english: english.trim(),
      russian: russian.trim(),
      synonyms: synonyms.split(',').map(s => s.trim()).filter(Boolean),
      example: example.trim() || undefined,
      topicId,
      topicIds: [topicId],
      isCustom: true,
    };
    await putCard(card);
    onAdded();
    dismiss();
  };

  return (
    <div className="modal-overlay" onClick={dismiss}>
      <div
        ref={sheetRef}
        className="modal-sheet"
        onClick={e => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="modal-handle" />
        <div className="modal-title">ДОБАВИТЬ_</div>
        <div className="add-form">
          <div className="form-group">
            <label className="form-label">По-английски</label>
            <input className="form-input" value={english} onChange={e => setEnglish(e.target.value)} placeholder="apple" />
          </div>
          <div className="form-group">
            <label className="form-label">По-русски</label>
            <input className="form-input" value={russian} onChange={e => setRussian(e.target.value)} placeholder="яблоко" />
          </div>
          <div className="form-group">
            <label className="form-label">Синонимы (через запятую)</label>
            <input className="form-input" value={synonyms} onChange={e => setSynonyms(e.target.value)} placeholder="fruit, pip fruit" />
          </div>
          <div className="form-group">
            <label className="form-label">Пример предложения</label>
            <input className="form-input" value={example} onChange={e => setExample(e.target.value)} placeholder="I eat an apple every day." />
          </div>
          <div className="form-group">
            <label className="form-label">Тема</label>
            <select className="form-input" value={topicId} onChange={e => setTopicId(e.target.value)}>
              {TOPICS.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <button className="submit-btn" onClick={handleSubmit}>добавить слово +</button>
        </div>
      </div>
    </div>
  );
};

export default AddWordModal;
