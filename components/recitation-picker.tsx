'use client';
import { useEffect, useRef, useState } from 'react';
import { AudioLines, LoaderCircle } from 'lucide-react';
import { getPeaks } from '@/lib/audio';
import { recitationAttribution, selectRecitationRange, type RecitationCatalog, type TimedRecitation } from '@/lib/recitations';
import type { MediaAsset, Verse, VerseClip } from '@/lib/model';

type Props = { chapter: number; chapterName: string; from: number; to: number; verses: Verse[]; verseTrack: VerseClip[]; assets: MediaAsset[]; onImport: (asset: MediaAsset, clips: VerseClip[], chapterName: string, signal?: AbortSignal) => Promise<void> };
export default function RecitationPicker({ chapter, chapterName, from, to, verses, verseTrack, assets, onImport }: Props) {
  const [catalog, setCatalog] = useState<RecitationCatalog | null>(null);
  const [reciter, setReciter] = useState(7);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [catalogError, setCatalogError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/data/recitations/catalog.json', { signal: abort.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(setCatalog).catch(() => { if (!abort.signal.aborted) setCatalogError(true); });
    return () => { abort.abort(); controller.current?.abort(); };
  }, []);
  useEffect(() => {
    setBusy(false); setProgress(0); setError('');
    // A pending download must not restore verses the user has replaced or edited.
    return () => { controller.current?.abort(); controller.current = null; };
  }, [chapter, from, to, verseTrack]);
  const available = catalog?.reciters.filter(r => r.chapters.includes(chapter)) ?? [];
  const unavailable = catalog?.reciters.filter(r => !r.chapters.includes(chapter)) ?? [];
  const chosen = available.find(r => r.id === reciter) ?? available[0];
  const importRange = async () => {
    if (!chosen || controller.current) return;
    setError(''); setBusy(true); setProgress(0);
    const abort = new AbortController(); controller.current = abort;
    let dispose: (() => void) | undefined;
    let createdUrl: string | undefined;
    try {
      const response = await fetch(`/data/recitations/${chosen.id}/${chapter}.json`, { signal: abort.signal });
      if (!response.ok) throw new Error('This recording’s timing data could not load. Please try again.');
      const recording: TimedRecitation = await response.json();
      const range = selectRecitationRange(recording, verses, chapter, from, to);
      const id = `recitation-${chosen.id}-${chapter}-${from}-${to}`;
      const cached = assets.find(a => a.id === id && a.blob);
      let asset: MediaAsset;
      if (cached) asset = cached;
      else {
        const { openAudioSource, readAudioRange, encodeWav } = await import('@/lib/media-audio');
        abort.signal.throwIfAborted();
        const source = await openAudioSource(recording.audioUrl);
        dispose = () => source.input.dispose();
        abort.signal.addEventListener('abort', dispose, { once: true });
        abort.signal.throwIfAborted();
        const buffer = await readAudioRange(source, range.start, range.end, abort.signal, setProgress);
        const blob = encodeWav(buffer); createdUrl = URL.createObjectURL(blob);
        asset = { id, name: `${chosen.name} · ${chapter}:${from}${to !== from ? `–${to}` : ''}`, type: 'audio', blob, url: createdUrl, duration: range.end - range.start, peaks: getPeaks(buffer),
          attribution: recitationAttribution(chosen, `${chapterName} ${from}–${to}`) };
      }
      abort.signal.throwIfAborted();
      await onImport(asset, range.clips, chapterName, abort.signal);
      createdUrl = undefined;
    } catch (error) {
      if (!abort.signal.aborted) setError(error instanceof Error && !/fetch|network/i.test(error.message) ? error.message : 'The recording could not be downloaded. Check your connection and try again.');
    } finally {
      if (createdUrl) URL.revokeObjectURL(createdUrl);
      if (dispose) { abort.signal.removeEventListener('abort', dispose); dispose(); }
      if (controller.current === abort) {
        if (!abort.signal.aborted) setBusy(false);
        controller.current = null;
      }
    }
  };
  return <div className="recitation-picker">
    <div className="library-section-title"><h3><AudioLines size={13} />Import with recitation</h3></div>
    {chosen ? <>
      <label className="form-field">Reciter<select aria-label="Reciter" value={chosen.id} disabled={busy} onChange={e => { setReciter(+e.target.value); setError(''); }}>
        {available.map(r => <option key={r.id} value={r.id}>{r.name}{r.style ? ` · ${r.style}` : ''}</option>)}
        {unavailable.map(r => <option key={r.id} value={r.id} disabled>{r.name}{r.style ? ` · ${r.style}` : ''} — no timings for this surah</option>)}
      </select></label>
      <p className="field-note">{available.length} {available.length === 1 ? 'reciter' : 'reciters'} available for {chapterName}.{unavailable.length > 0 && ' Other reciters need matched verse timings for this surah.'}</p>
      <button className="subtle-button full" disabled={busy || !verses.length || to < from || to - from >= 100} onClick={() => void importRange()}>{busy ? <LoaderCircle size={14} className="spin" /> : <AudioLines size={14} />}{busy ? `Preparing audio${progress ? ` · ${Math.round(progress * 100)}%` : '…'}` : 'Add verses & recitation'}</button>
      <p className="field-note">Matched verse timings included. Updates your verse track and recitation; other audio stays in place.</p>
      {busy && <button className="text-button" onClick={() => { controller.current?.abort(); controller.current = null; setBusy(false); }}>Cancel import</button>}
    </> : <p className="field-note">{catalogError ? 'The recitation library could not load. Refresh to try again.' : catalog ? 'No timed recordings are available for this surah yet. Choose another surah or upload your own recording.' : 'Loading reciters…'}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
