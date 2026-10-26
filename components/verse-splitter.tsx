'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Scissors, X } from 'lucide-react';
import { formatTime, type VerseClip } from '@/lib/model';
import { estimatePartTimes, suggestVerseBreaks, verseSections, verseWords } from '@/lib/verse-split';

type Props = {
  verse: VerseClip; time: number; playing: boolean; seek: (time: number) => void;
  previewFrom: (time: number) => void; stop: () => void; onClose: () => void;
  onApply: (breaks: number[], times: number[], translations?: string[]) => void;
};

export default function VerseSplitter({ verse, time, playing, seek, previewFrom, stop, onClose, onApply }: Props) {
  const [breaks, setBreaks] = useState<number[]>([]);
  const [times, setTimes] = useState<string[]>([]);
  const [customTranslation, setCustomTranslation] = useState(false);
  const [translations, setTranslations] = useState<string[]>([]);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const words = useMemo(() => verseWords(verse.arabic), [verse.arabic]);
  const sections = useMemo(() => verseSections(verse.arabic, breaks), [verse.arabic, breaks]);
  const maximum = Math.min(16, words.length, Math.floor((verse.end - verse.start + 1e-8) / .1));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const elements = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea,select') ?? []);
    elements()[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key !== 'Tab') return;
      const items = elements(), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); previous?.focus(); };
  }, [onClose]);
  useEffect(() => { if (playing && time >= verse.end) seek(verse.end); }, [playing, time, verse.end, seek]);
  const updateBreaks = (next: number[]) => {
    const estimates = estimatePartTimes(verse, next);
    const rounded = estimates.map(t => Number(t.toFixed(3)));
    const edges = [verse.start, ...rounded, verse.end];
    setBreaks(next); setTimes(edges.some((t, i) => i > 0 && t - edges[i - 1] < .1 - 1e-8) ? estimates.map(String) : rounded.map(String));
    setTranslations(Array(next.length + 1).fill('')); setError('');
  };
  const toggleBreak = (word: number) => updateBreaks(breaks.includes(word) ? breaks.filter(b => b !== word) : [...breaks, word].sort((a, b) => a - b));
  const updateTime = (index: number, value: string) => { setTimes(current => current.map((t, i) => i === index ? value : t)); setError(''); };
  const apply = () => {
    try { onApply(breaks, times.map(t => t.trim() ? Number(t) : NaN), customTranslation ? translations : undefined); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Check your split points and timings.'); }
  };
  return <div className="modal-backdrop"><section ref={dialog} className="modal verse-splitter" role="dialog" aria-modal="true" aria-labelledby="verse-split-title">
    <div className="split-heading"><div><h2 id="verse-split-title">Split verse {verse.key}</h2><p>Show a long verse in smaller parts.</p></div><button className="icon-btn" aria-label="Close verse splitter" onClick={onClose}><X size={19} /></button></div>
    <p className="field-note">Choose breaks between words. The recitation keeps playing continuously, and you can merge the parts later.</p>
    <div className="split-suggestions"><span>Suggest balanced parts</span>{[2, 3, 4].map(count => <button key={count} className="subtle-button" disabled={count > maximum} onClick={() => updateBreaks(suggestVerseBreaks(verse, count))}>{count} parts</button>)}<button className="text-button" disabled={!breaks.length} onClick={() => updateBreaks([])}>Clear</button></div>
    <div className="split-words" dir="rtl" aria-label="Choose Arabic word breaks">{words.map((word, index) => <span className="split-word" key={index}><span>{word.text}</span>{index < words.length - 1 && <button className={`word-break ${breaks.includes(index + 1) ? 'chosen' : ''}`} aria-label={`Break after word ${index + 1}`} aria-pressed={breaks.includes(index + 1)} disabled={!breaks.includes(index + 1) && breaks.length >= maximum - 1} onClick={() => toggleBreak(index + 1)} title={`Break after word ${index + 1}`}><span /></button>}</span>)}</div>
    <div className="split-playback"><button className="subtle-button" onClick={() => playing ? stop() : previewFrom(time >= verse.start && time < verse.end ? time : verse.start)}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? 'Pause recitation' : 'Listen to verse'}</button><input type="range" aria-label="Verse playback position" min={verse.start} max={verse.end} step={.01} value={Math.max(verse.start, Math.min(time, verse.end))} onChange={e => seek(+e.target.value)} /><span>{formatTime(time, true)}</span></div>
    {breaks.length > 0 && <>
      <p className="field-note">Times are estimated from word counts. Listen, then mark each part’s end or enter its time in seconds. Changing word breaks resets these estimates and any part translations.</p>
      <label className="form-field">Translation display<select aria-label="Translation display" value={customTranslation ? 'custom' : 'full'} onChange={e => setCustomTranslation(e.target.value === 'custom')}><option value="full">Keep full translation on every part</option><option value="custom">Enter a translation for each part</option></select></label>
      {customTranslation && <div className="split-original-translation"><strong>Original translation</strong><p>{verse.translation}</p><span>Divide it at the corresponding meaning. Arabic breaks do not divide the translation automatically.</span></div>}
      <div className="split-parts">{sections.map((arabic, i) => <article className="split-part" key={i} aria-label={`Part ${i + 1}`}><div className="split-part-heading"><strong>Part {i + 1} of {sections.length}</strong><button className="text-button" onClick={() => previewFrom(i === 0 ? verse.start : Number(times[i - 1]) || verse.start)}>Listen from here</button></div><p dir="rtl">{arabic}</p><div className="split-part-timing"><span>Start {formatTime(i === 0 ? verse.start : Number(times[i - 1]) || verse.start, true)}</span>{i < breaks.length ? <><label className="form-field">End time (s)<input aria-label={`Part ${i + 1} end time`} type="number" step="0.01" min={verse.start + .1} max={verse.end - .1} value={times[i]} onChange={e => updateTime(i, e.target.value)} /></label><button className="subtle-button" aria-label={`Mark part ${i + 1} end at playhead`} onClick={() => updateTime(i, time.toFixed(3))} disabled={time < verse.start + .1 || time > verse.end - .1}>Mark end now</button></> : <span>End {formatTime(verse.end, true)}</span>}</div>{customTranslation && <label className="form-field">Part translation<textarea aria-label={`Part ${i + 1} translation`} value={translations[i] ?? ''} onChange={e => setTranslations(current => sections.map((_, index) => index === i ? e.target.value : current[index] ?? ''))} /></label>}</article>)}</div>
    </>}
    {error && <div className="export-error" role="alert">{error}</div>}
    <div className="modal-actions"><button className="subtle-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!breaks.length} onClick={apply}><Scissors size={15} />Create {breaks.length + 1} parts</button></div>
  </section></div>;
}
