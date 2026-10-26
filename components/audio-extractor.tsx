'use client';
import { useEffect, useRef, useState } from 'react';
import { Download, FileAudio, LoaderCircle, Pause, Play, Plus, Upload, X } from 'lucide-react';
import { clamp, formatTime, uid, type MediaAsset } from '@/lib/model';
import { getPeaks } from '@/lib/audio';
import { download } from '@/lib/storage';
import { encodeMp3, encodeWav, openAudioSource, parseTimecode, readAudioRange, sourcePeaks, type AudioSourceInfo } from '@/lib/media-audio';

type Props = { onClose: () => void; onAdd: (asset: MediaAsset) => Promise<void> };
export default function AudioExtractor({ onClose, onAdd }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<AudioSourceInfo | null>(null);
  const [url, setUrl] = useState('');
  const [peaks, setPeaks] = useState<number[]>([]);
  const [from, setFrom] = useState('00:00'); const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false); const [cursor, setCursor] = useState(0);
  const [error, setError] = useState(''); const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null); const audioRef = useRef<HTMLAudioElement>(null);
  const request = useRef<AbortController | null>(null); const task = useRef<AbortController | null>(null);
  const sourceRef = useRef<AudioSourceInfo | null>(null); const urlRef = useRef('');
  const modalRef = useRef<HTMLElement>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const selectionPlayback = useRef(false);
  const start = parseTimecode(from); const end = parseTimecode(to);
  const valid = source && start !== null && end !== null && end > start && start >= 0 && end <= source.duration + .001 && end - start <= 600;
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const update = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const stopAt = selectionPlayback.current && end !== null ? end : source?.duration;
      if (stopAt !== undefined && audio.currentTime >= stopAt) {
        selectionPlayback.current = false; audio.pause(); audio.currentTime = stopAt; setCursor(stopAt); setPlaying(false); return;
      }
      setCursor(audio.currentTime);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing, end, source?.duration]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    modalRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const focusable = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? []).filter(el => el.getClientRects().length);
        if (e.shiftKey && document.activeElement === focusable[0]) { e.preventDefault(); focusable.at(-1)?.focus(); }
        else if (!e.shiftKey && document.activeElement === focusable.at(-1)) { e.preventDefault(); focusable[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); previous?.focus(); };
  }, [onClose]);
  useEffect(() => () => { stopDrag.current?.(); request.current?.abort(); task.current?.abort(); sourceRef.current?.input.dispose(); if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  const choose = async (next: File) => {
    request.current?.abort(); sourceRef.current?.input.dispose();
    audioRef.current?.pause(); if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const abort = new AbortController(); request.current = abort;
    setFile(next); setSource(null); setPeaks([]); setError(''); setLoading(true); setPlaying(false); setCursor(0);
    selectionPlayback.current = false;
    const objectUrl = URL.createObjectURL(next); urlRef.current = objectUrl; setUrl(objectUrl);
    try {
      const opened = await openAudioSource(next);
      if (abort.signal.aborted) { opened.input.dispose(); return; }
      sourceRef.current = opened; setSource(opened); setFrom('00:00'); setTo(formatTime(Math.min(600, opened.duration), true));
      setPeaks(await sourcePeaks(opened, abort.signal));
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'This file could not be opened.'); }
    finally { if (!abort.signal.aborted) setLoading(false); }
  };
  const pause = () => { selectionPlayback.current = false; audioRef.current?.pause(); setPlaying(false); };
  const seekPreview = (value: number) => {
    const audio = audioRef.current; if (!audio || !source || busy || loading) return;
    selectionPlayback.current = false;
    const position = clamp(value, 0, source.duration);
    audio.currentTime = position; setCursor(position);
  };
  const play = async (selection = false) => {
    const audio = audioRef.current; if (!audio || !source || (selection && !valid)) return;
    if (selection && start !== null) { selectionPlayback.current = true; audio.currentTime = start; setCursor(start); }
    else {
      selectionPlayback.current = false;
      if (audio.currentTime >= source.duration - .01) { audio.currentTime = 0; setCursor(0); }
    }
    try { await audio.play(); } catch { setError('Preview playback is unavailable for this file in your browser.'); }
  };
  const togglePlayback = () => {
    if (playing) { pause(); return; }
    void play();
  };
  const adjust = (which: 'start' | 'end', value: number) => {
    if (!source) return; pause();
    if (which === 'start') setFrom(formatTime(clamp(value, 0, (end ?? source.duration) - .1), true));
    else setTo(formatTime(clamp(value, (start ?? 0) + .1, source.duration), true));
  };
  const drag = (event: React.PointerEvent<HTMLButtonElement>, which: 'start' | 'end') => {
    event.preventDefault(); event.stopPropagation(); stopDrag.current?.();
    const track = event.currentTarget.parentElement!.getBoundingClientRect();
    const move = (e: PointerEvent) => adjust(which, (e.clientX - track.left) / track.width * (source?.duration ?? 0));
    move(event.nativeEvent);
    const endDrag = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', endDrag); window.removeEventListener('pointercancel', endDrag); };
    stopDrag.current = endDrag;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', endDrag, { once: true }); window.addEventListener('pointercancel', endDrag, { once: true });
  };
  const extract = async (action: 'add' | 'download') => {
    if (!source || !valid || start === null || end === null || !file) return;
    pause(); setBusy(true); setError(''); setProgress(0);
    const abort = new AbortController(); task.current = abort;
    try {
      const buffer = await readAudioRange(source, start, end, abort.signal, p => setProgress(p * .8));
      const name = `${file.name.replace(/\.[^.]+$/, '')} · ${formatTime(start)}–${formatTime(end)}`;
      if (action === 'download') { const blob = await encodeMp3(buffer, abort.signal); download(blob, `${name.replaceAll(':', '-')}.mp3`); setProgress(1); }
      else {
        const blob = encodeWav(buffer), objectUrl = URL.createObjectURL(blob);
        try { await onAdd({ id: uid(), name, type: 'audio', blob, url: objectUrl, duration: buffer.duration, peaks: getPeaks(buffer) }); }
        catch (error) { URL.revokeObjectURL(objectUrl); throw error; }
        onClose();
      }
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Audio extraction failed.'); }
    finally { setBusy(false); task.current = null; }
  };
  const duration = source?.duration ?? 1;
  return <div className="modal-backdrop"><section ref={modalRef} className="modal audio-extractor" role="dialog" aria-modal="true" aria-labelledby="extract-title">
    <div className="modal-heading"><span className="modal-icon"><FileAudio size={22} /></span><button className="icon-btn" aria-label="Close audio extractor" onClick={onClose}><X size={19} /></button></div>
    <h2 id="extract-title">Just the part you need.</h2><p>Extract audio from a recording or video. Everything happens on your device.</p>
    <input ref={inputRef} type="file" hidden accept="audio/*,video/*" onChange={e => { if (e.target.files?.[0]) void choose(e.target.files[0]); }} />
    <button className="extract-file" disabled={busy || loading} onClick={() => inputRef.current?.click()}><Upload size={19} /><span><strong>{file?.name ?? 'Choose audio or video'}</strong><small>{file ? `${source ? formatTime(source.duration) + ' · ' : ''}Click to choose another file` : 'MP3, WAV, M4A, MP4, WebM and more'}</small></span></button>
    {loading && <div className="extract-loading" role="status"><LoaderCircle size={15} className="spin" />Reading the audio waveform…</div>}
    {source && <>
      <div className="extract-waveform" aria-label="Audio waveform selection" onPointerDown={e => {
        if (busy || loading || e.button !== 0 || (e.target as HTMLElement).closest('.range-boundary')) return;
        e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
        const rect = e.currentTarget.getBoundingClientRect(); seekPreview((e.clientX - rect.left) / rect.width * duration);
      }} onPointerMove={e => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const rect = e.currentTarget.getBoundingClientRect(); seekPreview((e.clientX - rect.left) / rect.width * duration);
      }} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}><div className="waveform-bars">{peaks.map((peak, i) => <i key={i} style={{ height: `${Math.max(3, peak * 100)}%` }} />)}</div><div className="range-shade left" style={{ width: `${(start ?? 0) / duration * 100}%` }} /><div className="range-shade right" style={{ width: `${(1 - (end ?? duration) / duration) * 100}%` }} />
        {(['start', 'end'] as const).map(which => <button key={which} className="range-boundary" role="slider" aria-label={`Selection ${which}`} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={(which === 'start' ? start : end) ?? 0} style={{ left: `${((which === 'start' ? start : end) ?? 0) / duration * 100}%` }} disabled={busy || loading} onPointerDown={e => drag(e, which)} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); adjust(which, ((which === 'start' ? start : end) ?? 0) + (e.key === 'ArrowRight' ? .1 : -.1)); } }} />)}
        <div className="extract-playhead" style={{ left: `${cursor / duration * 100}%` }} />
      </div>
      <div className="extract-transport"><div className="extract-playback-buttons"><button className="subtle-button" aria-label={playing ? 'Pause preview' : 'Play preview'} disabled={busy || loading} onClick={togglePlayback}>{playing ? <Pause size={13} /> : <Play size={13} />}{playing ? 'Pause' : 'Play'}</button><button className="text-button play-selection" disabled={!valid || busy || loading} onClick={() => void play(true)}>Play selection</button></div><span>{formatTime(cursor, true)} / {formatTime(duration, true)}</span></div>
      <input className="extract-seek" aria-label="Playback position" aria-valuetext={formatTime(cursor, true)} type="range" min={0} max={duration} step={.01} value={clamp(cursor, 0, duration)} disabled={busy || loading} onChange={e => seekPreview(+e.target.value)} style={{ '--range-progress': `${cursor / duration * 100}%` } as React.CSSProperties} />
      <p className="extract-seek-hint">Click or drag the waveform to listen from any point.</p>
      <div className="field-pair extract-fields"><label className="form-field">Start time<input aria-label="Extraction start time" value={from} disabled={busy} onChange={e => { pause(); setFrom(e.target.value); }} placeholder="04:02" /><button className="text-button set-boundary" type="button" disabled={busy || loading || end === null || cursor >= end} onClick={() => adjust('start', cursor)}>Set to playhead</button></label><label className="form-field">End time<input aria-label="Extraction end time" value={to} disabled={busy} onChange={e => { pause(); setTo(e.target.value); }} placeholder="05:34" /><button className="text-button set-boundary" type="button" disabled={busy || loading || start === null || cursor <= start} onClick={() => adjust('end', cursor)}>Set to playhead</button></label></div>
      <p className="field-note">{valid ? `${formatTime(end! - start!, true)} selected` : 'Enter a valid start and end within the recording, up to 10 minutes apart.'} · Use mm:ss or hh:mm:ss.</p>
    </>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {busy && <div className="export-progress" role="status"><div><span>Preparing your audio…</span><strong>{Math.round(progress * 100)}%</strong></div><progress max={1} value={progress} /><button className="text-button" onClick={() => task.current?.abort()}>Cancel</button></div>}
    <div className="modal-actions"><button className="subtle-button" disabled={!valid || busy || loading} onClick={() => void extract('download')}><Download size={14} />Download MP3</button><button className="primary-button" disabled={!valid || busy || loading} onClick={() => void extract('add')}><Plus size={15} />Add to timeline</button></div>
    <audio ref={audioRef} src={url || undefined} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={e => { const audio = e.currentTarget; if (selectionPlayback.current && end !== null && audio.currentTime >= end) { selectionPlayback.current = false; audio.pause(); audio.currentTime = end; setCursor(end); } else setCursor(audio.currentTime); }} onEnded={() => setPlaying(false)} />
  </section></div>;
}
