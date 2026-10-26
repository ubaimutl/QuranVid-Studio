'use client';
import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Film, GripVertical, Minus, Music2, Plus, Scissors, SkipBack, SkipForward, Type, Volume2, Play, Pause, Magnet, Hand, MoveHorizontal } from 'lucide-react';
import { clamp, formatTime, resizeProject, type MediaAsset, type Project } from '@/lib/model';
import { retimeVerse, verseLabel } from '@/lib/verse-split';

type Props = { compact?: boolean; project: Project; assets: MediaAsset[]; time: number; seek: (t: number) => void; playing: boolean; toggle: () => void; selected: string | null; select: (id: string) => void; change: (p: Project, history?: boolean) => void; checkpoint: () => void; split: () => void; addAudio: () => void };
type Gesture = { id: string; kind: 'verse' | 'audio' | 'project'; mode: 'move' | 'left' | 'right'; x: number; scroll: number; project: Project };
export default function Timeline({ compact = false, project, assets, time, seek, playing, toggle, selected, select, change, checkpoint, split, addAudio }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const resizeGesture = useRef<{ y: number; height: number } | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [maximumHeight, setMaximumHeight] = useState(500);
  useEffect(() => {
    const panel = panelRef.current, workspace = panel?.parentElement;
    if (!panel || !workspace) return;
    const updateLimit = () => {
      // Landscape uses a side-by-side workspace; retain the portrait height.
      if (getComputedStyle(workspace).flexDirection === 'row') return;
      const toolbar = workspace.querySelector<HTMLElement>('.canvas-toolbar');
      const stage = workspace.querySelector<HTMLElement>('.stage-area');
      const minimum = parseFloat(getComputedStyle(workspace).getPropertyValue('--preview-min-height')) || 260;
      const previewMinimum = Math.max(minimum, stage ? parseFloat(getComputedStyle(stage).minHeight) || 0 : 0);
      const limit = Math.max(180, Math.min(workspace.clientHeight * .65, workspace.clientHeight - (toolbar?.offsetHeight ?? 50) - previewMinimum));
      setMaximumHeight(limit);
      setPanelHeight(current => current === null ? panel.offsetHeight > limit ? limit : null : clamp(current, 180, limit));
    };
    const observer = new ResizeObserver(updateLimit);
    observer.observe(workspace);
    const toolbar = workspace.querySelector<HTMLElement>('.canvas-toolbar');
    if (toolbar) observer.observe(toolbar);
    updateLimit();
    return () => observer.disconnect();
  }, []);
  const resizePanel = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = resizeGesture.current;
    if (gesture) setPanelHeight(clamp(gesture.height + gesture.y - event.clientY, 180, maximumHeight));
  };
  const [touchEdit, setTouchEdit] = useState(false);
  const touchTap = useRef<{ id: string; kind: Gesture['kind']; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const gesture = useRef<Gesture | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const px = 16 * zoom;
  const width = Math.max(760, (project.duration + 15) * px);
  const tick = zoom < 1 ? 10 : zoom > 2 ? 2 : 5;
  const ticks = Array.from({ length: Math.ceil(project.duration / tick) + 1 }, (_, i) => i * tick);
  const startDrag = (event: React.PointerEvent, id: string, kind: Gesture['kind'], mode: Gesture['mode']) => {
    event.stopPropagation(); select(id);
    if (compact && event.pointerType === 'touch' && !touchEdit) {
      touchTap.current = { id, kind, x: event.clientX, y: event.clientY }; return;
    }
    checkpoint();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { id, kind, mode, x: event.clientX, scroll: scrollRef.current?.scrollLeft ?? 0, project };
  };
  const drag = (event: React.PointerEvent) => {
    const g = gesture.current; if (!g) return;
    const scroller = scrollRef.current;
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      if (event.clientX > rect.right - 25) scroller.scrollLeft += 12;
      else if (event.clientX < rect.left + 25) scroller.scrollLeft -= 12;
    }
    const delta = (event.clientX - g.x + (scroller?.scrollLeft ?? 0) - g.scroll) / px;
    const quantize = (t: number) => snap && !event.shiftKey ? Math.round(t * 10) / 10 : t;
    if (g.kind === 'project') {
      change(resizeProject(g.project, quantize(g.project.duration + delta), true), false);
    } else if (g.kind === 'verse') {
      const original = g.project.verses.find(v => v.id === g.id)!;
      if (g.mode === 'move' && original.part) {
        const parts = g.project.verses.filter(v => v.part?.groupId === original.part!.groupId);
        const shift = clamp(quantize(original.start + delta) - original.start, -Math.min(...parts.map(v => v.start)), 600 - Math.max(...parts.map(v => v.end)));
        const updated = { ...g.project, verses: g.project.verses.map(v => v.part?.groupId === original.part!.groupId ? { ...v, start: v.start + shift, end: v.end + shift } : v) };
        change(resizeProject(updated, Math.max(g.project.duration, ...updated.verses.map(v => v.end))), false);
        return;
      }
      const duration = original.end - original.start;
      let { start, end } = original;
      if (g.mode === 'move') { start = clamp(quantize(start + delta), 0, 600 - duration); end = start + duration; }
      if (g.mode === 'left') start = clamp(quantize(start + delta), 0, end - .1);
      if (g.mode === 'right') end = clamp(quantize(end + delta), start + .1, 600);
      const updated = g.mode === 'move' ? { ...g.project, verses: g.project.verses.map(v => v.id === g.id ? { ...v, start, end } : v) } : retimeVerse(g.project, g.id, start, end);
      change(resizeProject(updated, Math.max(g.project.duration, end)), false);
    } else {
      const original = g.project.audio.find(a => a.id === g.id)!;
      let { start, duration, offset } = original;
      if (g.mode === 'move') start = clamp(quantize(start + delta), 0, 600 - duration);
      if (g.mode === 'left') {
        const trim = clamp(quantize(start + delta) - start, -Math.min(offset, start), duration - .1);
        start += trim; offset += trim; duration -= trim;
      }
      if (g.mode === 'right') duration = clamp(quantize(duration + delta), .1, Math.min(original.sourceDuration - offset, 600 - start));
      change(resizeProject({ ...g.project, audio: g.project.audio.map(a => a.id === g.id ? { ...a, start, duration, offset } : a) }, Math.max(g.project.duration, start + duration)), false);
    }
  };
  const endDrag = (event: React.PointerEvent) => {
    const tap = touchTap.current;
    if (tap && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 8) {
      const clip = tap.kind === 'verse' ? project.verses.find(verse => verse.id === tap.id) : project.audio.find(audio => audio.id === tap.id);
      if (clip) seek(clip.start);
    }
    gesture.current = null; touchTap.current = null;
  };
  const clipEvents = { onPointerMove: drag, onPointerUp: endDrag, onPointerCancel: () => { gesture.current = null; touchTap.current = null; } };
  const scrub = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('.timeline-clip')) return;
    const rect = event.currentTarget.getBoundingClientRect(); seek(clamp((event.clientX - rect.left) / px, 0, project.duration));
    if (event.pointerType !== 'touch') event.currentTarget.setPointerCapture(event.pointerId);
  };
  return <section ref={panelRef} className="timeline" data-touch-edit={touchEdit} aria-label="Video timeline" style={{ ...(panelHeight === null ? {} : { height: panelHeight }), minHeight: 180, flexShrink: 0 }}>
    <div className="timeline-resize-handle" role="separator" aria-label="Resize timeline height" aria-orientation="horizontal" aria-valuemin={180} aria-valuemax={Math.round(maximumHeight)} aria-valuenow={Math.round(panelHeight ?? panelRef.current?.offsetHeight ?? 265)} tabIndex={0} title="Drag to resize timeline. Double-click to reset." onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      resizeGesture.current = { y: event.clientY, height: panelRef.current!.getBoundingClientRect().height };
    }} onPointerMove={resizePanel} onPointerUp={() => { resizeGesture.current = null; }} onPointerCancel={() => { resizeGesture.current = null; }} onLostPointerCapture={() => { resizeGesture.current = null; }} onDoubleClick={() => setPanelHeight(null)} onKeyDown={event => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const current = panelHeight ?? panelRef.current?.offsetHeight ?? 265;
      setPanelHeight(event.key === 'Home' ? 180 : event.key === 'End' ? maximumHeight : clamp(current + (event.key === 'ArrowUp' ? 20 : -20), 180, maximumHeight));
    }}><span /></div>
    <div className="timeline-toolbar">
      <button className="icon-btn mobile-timeline-mode" aria-label="Move clips" aria-pressed={touchEdit} title={touchEdit ? 'Move clips: drag a clip or its edges' : 'Scroll timeline: swipe to navigate'} onClick={() => setTouchEdit(value => !value)}>{touchEdit ? <MoveHorizontal size={19} /> : <Hand size={19} />}</button>
      <div className="timeline-tools"><button className="icon-btn" title={project.verses.some(v => v.id === selected) ? 'Split selected verse into parts (S)' : 'Split selected audio at playhead (S)'} onClick={split}><Scissors size={16} /></button><span className="toolbar-separator" /><button className={`icon-btn ${snap ? 'active' : ''}`} title="Snap clips to 0.1 seconds" aria-pressed={snap} onClick={() => setSnap(v => !v)}><Magnet size={16} /></button><span className="timeline-hint">Timeline</span></div>
      <div className="transport"><button className="icon-btn" title="Go to start" onClick={() => seek(0)}><SkipBack size={15} /></button><button className="play-button" title={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={toggle}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button><button className="icon-btn" title="Go to end" onClick={() => seek(project.duration)}><SkipForward size={15} /></button><span className="timecode">{formatTime(time, true)} <span>/ {formatTime(project.duration, true)}</span></span></div>
      <div className="timeline-tools"><button className="icon-btn" title="Zoom timeline out" onClick={() => setZoom(z => Math.max(.5, z - .5))}><Minus size={15} /></button><input aria-label="Timeline zoom" type="range" min="0.5" max="5" step="0.5" value={zoom} onChange={e => setZoom(+e.target.value)} /><button className="icon-btn" title="Zoom timeline in" onClick={() => setZoom(z => Math.min(5, z + .5))}><Plus size={15} /></button></div>
    </div>
    <p className="touch-timeline-hint">{touchEdit ? 'Drag clips or edges · Edit for precise timing' : 'Swipe to scroll · Tap a clip, then Edit'}</p>
    <div className="timeline-body">
      <div className="track-headers">
        <div className="ruler-header">Tracks</div>
        <button className={`track-label ${selected === 'background' ? 'chosen' : ''}`} onClick={() => select('background')}><Film size={15} /><span>Background</span></button>
        <div className="track-label"><Type size={15} /><span>Quran verses</span><span className="small-count">{project.verses.length}</span></div>
        {project.layers.filter(l => l.kind === 'text').map(layer => <button key={layer.id} className={`track-label ${selected === layer.id ? 'chosen' : ''}`} onClick={() => select(layer.id)}><Type size={15} /><span>{layer.name}</span><span role="button" tabIndex={0} aria-label={`Toggle ${layer.name}`} onClick={e => { e.stopPropagation(); change({ ...project, layers: project.layers.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l) }); }} onKeyDown={e => { if (e.key === 'Enter') change({ ...project, layers: project.layers.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l) }); }}>{layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}</span></button>)}
        {project.audio.map((audio, i) => <button key={audio.id} className={`track-label ${selected === audio.id ? 'chosen' : ''}`} onClick={() => select(audio.id)}><Volume2 size={15} /><span>{i === 0 ? 'Recitation' : `Audio ${i + 1}`}</span></button>)}
        <button className="track-label add-track" onClick={addAudio}><Plus size={15} /><span>Add audio</span></button>
      </div>
      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-content" style={{ width }}>
          <div className="time-ruler" onPointerDown={scrub} onPointerMove={e => { if (e.buttons === 1 && !gesture.current) scrub(e); }}>{ticks.map(t => <span key={t} style={{ left: t * px }}>{formatTime(t)}</span>)}</div>
          <div className="track-row" onPointerDown={scrub}><button className={`background-clip ${selected === 'background' ? 'selected' : ''}`} style={{ width: project.duration * px }} onClick={() => select('background')}><span className="background-strip" style={project.background.type === 'image' ? { backgroundImage: `url(${assets.find(a => a.id === project.background.source)?.url ?? project.background.source})` } : { background: project.background.type === 'color' ? project.background.source : '#344c45' }} /><span className="clip-name"><Film size={12} />{project.background.name}</span><i className="trim-handle right" title="Drag to change video duration" onPointerDown={e => startDrag(e, 'background', 'project', 'right')} {...clipEvents} /></button></div>
          <div className="track-row" onPointerDown={scrub}>{project.verses.map(verse => <div role="button" tabIndex={0} aria-label={`Verse ${verseLabel(verse)} timeline clip`} key={verse.id} className={`timeline-clip verse-clip ${selected === verse.id ? 'selected' : ''}`} style={{ left: verse.start * px, width: Math.max(4, (verse.end - verse.start) * px) }} onPointerDown={e => startDrag(e, verse.id, 'verse', 'move')} onKeyDown={e => { if (e.key === 'Enter') { select(verse.id); seek(verse.start); } }} {...clipEvents}><i className="trim-handle left" onPointerDown={e => startDrag(e, verse.id, 'verse', 'left')} /><span>{verseLabel(verse)}</span><small dir="rtl">{verse.arabic}</small><i className="trim-handle right" onPointerDown={e => startDrag(e, verse.id, 'verse', 'right')} /></div>)}</div>
          {project.layers.filter(l => l.kind === 'text').map(layer => <div className="track-row" key={layer.id}><button className={`text-clip ${selected === layer.id ? 'selected' : ''}`} style={{ left: layer.start * px, width: (Math.min(layer.end, project.duration) - layer.start) * px }} onClick={() => select(layer.id)}><Type size={13} />{layer.text}</button></div>)}
          {project.audio.map(audio => {
            const asset = assets.find(a => a.id === audio.assetId);
            const peaks = asset?.peaks ?? [];
            return <div className="track-row audio-row" key={audio.id} onPointerDown={scrub}><div role="button" tabIndex={0} aria-label={`${audio.name} audio clip`} className={`timeline-clip audio-clip ${selected === audio.id ? 'selected' : ''}`} style={{ left: audio.start * px, width: audio.duration * px }} onPointerDown={e => startDrag(e, audio.id, 'audio', 'move')} onKeyDown={e => { if (e.key === 'Enter') select(audio.id); }} {...clipEvents}>
              <i className="trim-handle left" onPointerDown={e => startDrag(e, audio.id, 'audio', 'left')} /><span className="audio-clip-label"><Music2 size={11} />{audio.name}</span>
              <div className="waveform">{Array.from({ length: Math.max(4, Math.floor(audio.duration * px / 4)) }, (_, i) => {
                const sourceTime = audio.offset + i * 4 / px;
                const index = Math.floor(sourceTime / (asset?.duration ?? audio.sourceDuration) * peaks.length);
                return <i key={i} style={{ height: `${Math.max(2, (peaks[index] ?? .04) * 100)}%` }} />;
              })}</div><i className="trim-handle right" onPointerDown={e => startDrag(e, audio.id, 'audio', 'right')} />
            </div></div>;
          })}
          <button className="empty-track" style={{ width: project.duration * px }} onClick={addAudio}><Plus size={13} /> Drop in another recording</button>
          <div className="project-end" style={{ left: project.duration * px }}><button className="duration-handle" role="slider" aria-label="Video duration" aria-valuemin={1} aria-valuemax={600} aria-valuenow={Number(project.duration.toFixed(2))} aria-valuetext={formatTime(project.duration, true)} title="Drag to change video duration" onPointerDown={e => startDrag(e, 'background', 'project', 'right')} onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); change(resizeProject(project, project.duration + (e.key === 'ArrowRight' ? 1 : -1), true)); } }} {...clipEvents}><span>End · {formatTime(project.duration)}</span></button></div>
          <div className="playhead" style={{ left: time * px }}><span /></div>
        </div>
      </div>
    </div>
    <div className="timeline-footer"><span><GripVertical size={12} /> Drag to move · Drag edges to trim or extend</span><span>Space to play <i>·</i> S to split <i>·</i> Shift to ignore snapping</span></div>
  </section>;
}
