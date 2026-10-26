'use client';
import BrandMark from './brand-mark';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowDownToLine, ArrowLeft, AudioLines, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Download, ExternalLink, FileUp, Film, FolderOpen, ImageIcon, LayoutTemplate, LoaderCircle, Maximize, Monitor, MoreHorizontal, PanelLeftClose, Pause, Play, Plus, Redo2, ShieldCheck, SlidersHorizontal, Sparkle, Type, Undo2, Upload, X } from 'lucide-react';
import Canvas from './canvas';
import Timeline from './timeline';
import Library, { type LibraryTab } from './library';
import Inspector from './inspector';
import MobileSheet from './mobile-sheet';
import InstallApp from './install-app';
import type { ExportCapabilities } from '@/lib/export-capabilities';
import { exportDimensions, type ExportSize } from '@/lib/export-settings';
import { createProject, SAMPLE_AUDIO } from '@/lib/sample';
import { clamp, formatTime, splitAudio, uid, validateProject, withEditableReference, type MediaAsset, type Project, type VerseClip } from '@/lib/model';
import { decodeAsset, getPeaks, scheduleClip } from '@/lib/audio';
import { download, loadAssets, loadProject, saveProject, savePreparedProject, storeAsset } from '@/lib/storage';
import { applyTimedRecitation } from '@/lib/recitations';
import { mergeVerseParts, splitVerse } from '@/lib/verse-split';
import { applyVideoTemplate, getVideoTemplate, type TemplateId } from '@/lib/templates';

const AudioExtractor = dynamic(() => import('./audio-extractor'), { ssr: false });
const VerseSplitter = dynamic(() => import('./verse-splitter'), { ssr: false });
const SharedProject = dynamic(() => import('./shared-project'), { ssr: false });
const RecipeProject = dynamic(() => import('./recipe-project'), { ssr: false });
const SavedProjects = dynamic(() => import('./shared-project').then(module => module.SavedProjects), { ssr: false });
const MediaCredits = dynamic(() => import('./shared-project').then(module => module.MediaCredits), { ssr: false });

const NAV_ITEMS = [
  { id: 'quran', label: 'Quran', icon: BookOpen }, { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'media', label: 'Media', icon: ImageIcon }, { id: 'audio', label: 'Audio', icon: AudioLines }, { id: 'text', label: 'Text', icon: Type },
] as const;
function clearProjectLink() {
  // Fragments are local editor state. Avoid scheduling a framework navigation
  // that could later overwrite a newer fragment opened by the user.
  window.History.prototype.replaceState.call(window.history, window.history.state, '', window.location.pathname + window.location.search);
}
export default function Studio() {
  const [project, setProject] = useState<Project>(createProject);
  const [assets, setAssets] = useState<MediaAsset[]>([SAMPLE_AUDIO]);
  const [tab, setTab] = useState<LibraryTab>('quran');
  const [compact, setCompact] = useState(false);
  const [mobileControls, setMobileControls] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<LibraryTab | 'inspector' | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 850px), (max-height: 500px) and (pointer: coarse)');
    const update = () => { setCompact(media.matches); if (!media.matches) setMobilePanel(null); };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const closeMobilePanel = () => {
    const panel = mobilePanel; setMobilePanel(null);
    if (panel) document.querySelector<HTMLButtonElement>(`[data-mobile-tool="${panel}"]`)?.focus({ preventScroll: true });
  };
  const openMobileTool = (panel: LibraryTab | 'inspector') => {
    if (panel !== 'inspector') setTab(panel);
    setMobilePanel(current => current === panel ? null : panel);
  };
  const selectForEditing = (id: string) => { setSelected(id); if (compact) setMobilePanel('inspector'); };
  const [selected, setSelected] = useState<string | null>('arabic');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState('');
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [audioToolOpen, setAudioToolOpen] = useState(false);
  const [remoteToken, setRemoteToken] = useState<string | null>(null);
  const [recipeToken, setRecipeToken] = useState<string | null>(null);
  const [savedProjectsOpen, setSavedProjectsOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const closeSavedProjects = useCallback(() => setSavedProjectsOpen(false), []);
  const closeCredits = useCallback(() => setCreditsOpen(false), []);
  const closeSharedProject = useCallback(() => { setRemoteToken(null); clearProjectLink(); }, []);
  const closeRecipeProject = useCallback(() => { setRecipeToken(null); clearProjectLink(); }, []);
  const [splitVerseId, setSplitVerseId] = useState<string | null>(null);
  const closeAudioTool = useCallback(() => setAudioToolOpen(false), []);
  const [exportOpen, setExportOpen] = useState(false);
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [exportCapabilities, setExportCapabilities] = useState<ExportCapabilities | null>(null);
  const [exportSize, setExportSize] = useState<ExportSize>('original');
  const exportResolution = exportDimensions(project.width, project.height, exportSize);
  const hasExportAudio = project.audio.length > 0;
  useEffect(() => {
    if (!exportOpen) return;
    let cancelled = false;
    setExportCapabilities(null);
    import('@/lib/export-capabilities').then(({ getExportCapabilities }) => getExportCapabilities({ ...exportDimensions(project.width, project.height, exportSize), hasAudio: hasExportAudio })).then(capabilities => {
      if (cancelled) return;
      setExportCapabilities(capabilities);
      setFormat(current => capabilities[current] ? current : capabilities.mp4 ? 'mp4' : 'webm');
    }).catch(() => { if (!cancelled) setExportError('Could not check export support. Close this dialog and try again.'); });
    return () => { cancelled = true; };
  }, [exportOpen, project.width, project.height, hasExportAudio, exportSize]);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportError, setExportError] = useState('');
  const [exportResult, setExportResult] = useState<Blob | null>(null);
  const [importing, setImporting] = useState(false);
  const [safeZones, setSafeZones] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [historyCount, setHistoryCount] = useState(0);
  const [futureCount, setFutureCount] = useState(0);
  const history = useRef<Project[]>([]); const future = useRef<Project[]>([]);
  const projectRef = useRef(project); projectRef.current = project;
  const timeRef = useRef(time); timeRef.current = time;
  const audioContext = useRef<AudioContext | null>(null);
  const playbackToken = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 6000);
  }, []);
  const stopPlayback = useCallback(() => {
    playbackToken.current++; setPlaying(false);
    if (audioContext.current) { void audioContext.current.close(); audioContext.current = null; }
  }, []);
  const closeVerseSplitter = useCallback(() => { stopPlayback(); setSplitVerseId(null); }, [stopPlayback]);
  const checkpoint = useCallback(() => {
    history.current = [...history.current.slice(-69), projectRef.current];
    future.current = []; setHistoryCount(history.current.length); setFutureCount(0);
  }, []);
  const change = useCallback((next: Project, record = true, pause = true) => {
    if (pause) stopPlayback(); if (record) checkpoint(); setProject(next); projectRef.current = next; setSaved(false);
  }, [checkpoint, stopPlayback]);
  const undo = useCallback(() => {
    const previous = history.current.pop(); if (!previous) return;
    stopPlayback(); future.current.push(projectRef.current); setProject(previous); projectRef.current = previous;
    setHistoryCount(history.current.length); setFutureCount(future.current.length);
  }, [stopPlayback]);
  const redo = useCallback(() => {
    const next = future.current.pop(); if (!next) return;
    stopPlayback(); history.current.push(projectRef.current); setProject(next); projectRef.current = next;
    setHistoryCount(history.current.length); setFutureCount(future.current.length);
  }, [stopPlayback]);
  const seek = useCallback((value: number) => { stopPlayback(); const next = clamp(value, 0, projectRef.current.duration); timeRef.current = next; setTime(next); }, [stopPlayback]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadProject(), loadAssets()]).then(([stored, media]) => {
      if (cancelled) return;
      if (stored && validateProject(stored)) { const next = withEditableReference(stored); setProject(next); projectRef.current = next; }
      setAssets([SAMPLE_AUDIO, ...media]);
    }).catch(() => notify('Browser storage is unavailable. Download your project to keep a copy.')).finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [notify]);
  useEffect(() => {
    if (!ready) return;
    const openLink = () => {
      const fragment = window.location.hash.length > 12000 ? '#create=invalid' : window.location.hash;
      const params = new URLSearchParams(fragment.slice(1));
      if (params.has('recipe') || params.has('create')) { stopPlayback(); setRemoteToken(null); setRecipeToken(fragment); return; }
      setRecipeToken(null);
      const token = params.get('draft');
      if (token && /^[a-zA-Z0-9_-]{43}$/.test(token)) { stopPlayback(); setRemoteToken(token); }
    };
    openLink(); window.addEventListener('hashchange', openLink);
    return () => window.removeEventListener('hashchange', openLink);
  }, [ready, stopPlayback]);
  useEffect(() => {
    if (!ready) return;
    setSaved(false);
    const timer = setTimeout(() => saveProject(project).then(() => setSaved(true)).catch(() => notify('Could not save locally. Download a project backup from the project menu.')), 600);
    return () => clearTimeout(timer);
  }, [project, ready, notify]);
  useEffect(() => {
    if (!ready) return;
    const context = new AudioContext();
    decodeAsset(SAMPLE_AUDIO, context).then(buffer => {
      const peaks = getPeaks(buffer);
      setAssets(current => current.map(a => a.id === SAMPLE_AUDIO.id ? { ...a, peaks, duration: buffer.duration } : a));
    }).catch(() => notify('Sample audio could not load. You can upload your own recording.')).finally(() => context.close());
  }, [ready, notify]);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now(); const from = timeRef.current;
    let frame: number;
    const tick = (now: number) => {
      const next = from + (now - start) / 1000;
      if (next >= projectRef.current.duration) { setTime(projectRef.current.duration); stopPlayback(); return; }
      setTime(next); frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, stopPlayback]);
  useEffect(() => () => { playbackToken.current++; void audioContext.current?.close(); abort.current?.abort(); }, []);
  useEffect(() => {
    if (!exportOpen && !help) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const elements = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? []);
    elements()[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) { setExportOpen(false); setHelp(false); }
      if (event.key !== 'Tab') return;
      const items = elements(); const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); previous?.focus(); };
  }, [exportOpen, help, exporting]);
  const toggle = useCallback(async () => {
    if (playing) { stopPlayback(); return; }
    const token = ++playbackToken.current;
    const from = timeRef.current >= projectRef.current.duration ? 0 : timeRef.current;
    if (from === 0) setTime(0);
    const context = new AudioContext(); audioContext.current = context;
    try {
      await context.resume();
      const clips = await Promise.all(projectRef.current.audio.map(async clip => {
        const asset = assets.find(a => a.id === clip.assetId);
        if (!asset) throw new Error(`Missing recording: ${clip.name}. Re-import its source file.`);
        return { clip, buffer: await decodeAsset(asset, context) };
      }));
      if (token !== playbackToken.current) { if (context.state !== 'closed') await context.close(); return; }
      clips.forEach(({ clip, buffer }) => scheduleClip(context, buffer, clip, from)); setPlaying(true);
    } catch (error) { stopPlayback(); notify(error instanceof Error ? error.message : 'Audio playback failed.'); }
  }, [playing, assets, notify, stopPlayback]);
  const toggleRef = useRef(toggle); toggleRef.current = toggle;
  const previewFrom = (from: number) => {
    seek(from);
    setTimeout(() => { void toggleRef.current(); }, 0);
  };
  const remove = useCallback(() => {
    const p = projectRef.current;
    if (!selected || selected === 'background') return;
    const reference = p.layers.find(l => l.id === selected && l.kind === 'reference');
    change({ ...p, showReference: reference ? false : p.showReference, layers: reference ? p.layers.map(l => l.id === selected ? { ...l, visible: false } : l) : p.layers.filter(l => l.id !== selected), audio: p.audio.filter(a => a.id !== selected), verses: p.verses.filter(v => v.id !== selected) }); setSelected('background');
  }, [selected, change]);
  const split = useCallback(() => {
    const p = projectRef.current;
    const verse = p.verses.find(v => v.id === selected);
    if (verse) {
      if (verse.part) { notify('Merge this verse’s parts before choosing new word breaks.'); return; }
      stopPlayback(); setSplitVerseId(verse.id); return;
    }
    const clip = p.audio.find(a => a.id === selected) ?? p.audio.find(a => timeRef.current > a.start && timeRef.current < a.start + a.duration);
    if (!clip) { notify('Select an audio clip and place the playhead inside it to split.'); return; }
    const parts = splitAudio(clip, timeRef.current);
    if (parts.length === 1) { notify('Place the playhead inside the clip, away from its edges.'); return; }
    change({ ...p, audio: p.audio.flatMap(a => a.id === clip.id ? parts : [a]) }); setSelected(parts[1].id);
  }, [selected, change, notify, stopPlayback]);
  const mergeVerse = () => {
    try {
      const p = projectRef.current;
      const originalId = p.verses.find(v => v.id === selected)?.part?.originalId;
      change(mergeVerseParts(p, selected ?? '')); setSelected(originalId ?? null);
      notify('Parts merged. Original verse text and translation restored.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not merge these parts.'); }
  };
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.defaultPrevented || target.closest('input,textarea,select,[contenteditable="true"]') || exportOpen || help || audioToolOpen || splitVerseId || remoteToken || recipeToken !== null || savedProjectsOpen || creditsOpen) return;
      if (e.code === 'Space' && target.closest('button,a,[role=button],[role=separator]')) return;
      if (e.code === 'Space') { e.preventDefault(); void toggle(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) split();
      if (e.key === 'ArrowRight') { e.preventDefault(); seek(timeRef.current + (e.shiftKey ? 1 : 1 / 30)); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(timeRef.current - (e.shiftKey ? 1 : 1 / 30)); }
      if (e.key === 'Escape') { setMenu(false); setSelected(null); setMobilePanel(null); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [toggle, undo, redo, remove, split, seek, exportOpen, help, audioToolOpen, splitVerseId, remoteToken, recipeToken, savedProjectsOpen, creditsOpen]);
  const upload = (accept: string) => { if (fileRef.current) { fileRef.current.accept = accept; fileRef.current.click(); } };
  const addAudio = (asset: MediaAsset) => {
    const p = projectRef.current; const start = Math.min(timeRef.current, p.duration - .1);
    const duration = Math.min(asset.duration ?? 0, 600 - start);
    if (duration <= 0) { notify('This recording has no playable audio.'); return; }
    const end = Math.max(p.duration, start + duration);
    const id = uid(); change({ ...p, duration: end, layers: p.layers.map(l => l.end === p.duration ? { ...l, end } : l), audio: [...p.audio, { id, assetId: asset.id, name: asset.name, start, duration, offset: 0, sourceDuration: asset.duration!, volume: 1, fadeIn: 0, fadeOut: 0 }] }); setSelected(id);
  };
  const addExtractedAudio = async (asset: MediaAsset) => {
    await storeAsset(asset);
    setAssets(current => [...current.filter(a => a.id !== asset.id), asset]);
    addAudio(asset); setTab('audio');
  };
  const importRecitation = async (asset: MediaAsset, verses: VerseClip[], chapterName: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    await storeAsset(asset);
    signal?.throwIfAborted();
    setAssets(current => [...current.filter(a => a.id !== asset.id), asset]);
    const p = projectRef.current;
    const next = applyTimedRecitation(p, verses, asset.id, asset.name, asset.duration!, 0);
    if (p.verses[0]?.key.split(':')[0] !== verses[0].key.split(':')[0]) {
      next.name = `${chapterName} · A moment of reflection`;
      next.layers = next.layers.map(l => l.id === 'title' ? { ...l, text: chapterName } : l);
    }
    change(next);
    setTime(0); setSelected(verses[0].id); setMobilePanel(null);
    notify('Recitation added with matching verse timings.');
  };
  const importMedia = async (files: FileList | File[]) => {
    setImporting(true);
    try {
      for (const file of Array.from(files)) {
        const type = file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : undefined;
        if (!type) { notify(`Unsupported file: ${file.name}`); continue; }
        const asset: MediaAsset = { id: uid(), name: file.name, type, blob: file, url: URL.createObjectURL(file) };
        try {
          if (type === 'audio') {
            const context = new AudioContext();
            try { const buffer = await decodeAsset(asset, context); asset.duration = buffer.duration; asset.peaks = getPeaks(buffer); }
            finally { await context.close(); }
          } else if (type === 'image') {
            const image = new Image(); image.src = asset.url; await image.decode();
          } else {
            const video = document.createElement('video'); video.preload = 'metadata';
            await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => { asset.duration = video.duration; resolve(); }; video.onerror = () => reject(new Error('This video format is not supported.')); video.src = asset.url; });
            video.removeAttribute('src'); video.load();
          }
          await storeAsset(asset);
          setAssets(current => [...current, asset]);
          if (type === 'audio') { addAudio(asset); setTab('audio'); }
          else { const p = projectRef.current; change({ ...p, background: { ...p.background, type, source: asset.id, name: asset.name } }); setSelected('background'); setTab('media'); }
        } catch (error) { URL.revokeObjectURL(asset.url); throw error; }
      }
    } catch (error) { notify(error instanceof Error ? error.message : 'This media could not be imported.'); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const addText = (text = 'Your title here') => {
    const p = projectRef.current; const id = uid();
    change({ ...p, layers: [...p.layers, { id, kind: 'text', name: text.slice(0, 24), text, x: 50, y: 75, width: 80, fontSize: 38, color: '#ffffff', align: 'center', opacity: 1, visible: true, start: 0, end: p.duration }] }); setSelected(id); if (compact) setMobilePanel('inspector');
  };
  const duplicate = () => {
    const p = projectRef.current; const id = uid(); const layer = p.layers.find(l => l.id === selected); const audio = p.audio.find(a => a.id === selected);
    if (layer) change({ ...p, layers: [...p.layers, { ...layer, id, name: `${layer.name} copy`, y: clamp(layer.y + 5, 0, 95) }] });
    else if (audio) change({ ...p, audio: [...p.audio, { ...audio, id, name: `${audio.name} copy` }] });
    setSelected(id);
  };
  const applyTemplate = (id: TemplateId) => {
    change(applyVideoTemplate(projectRef.current, id));
    setSelected('background'); setMobilePanel(null); notify(`${getVideoTemplate(id).name} style applied. Your verse and audio timings are preserved.`);
  };
  const backup = async () => {
    setMenu(false);
    try {
      const needed = new Set([...project.audio.map(a => a.assetId), project.background.source]);
      const media = await Promise.all(assets.filter(a => a.blob && needed.has(a.id)).map(async a => {
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(a.blob!); });
        return { id: a.id, name: a.name, type: a.type, duration: a.duration, peaks: a.peaks, attribution: a.attribution, data };
      }));
      download(new Blob([JSON.stringify({ project, media })], { type: 'application/json' }), `${project.name}.quranvid.json`);
    } catch { notify('Project download failed. Please try again.'); }
  };
  const restore = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (!validateProject(data.project) || !Array.isArray(data.media)) throw new Error('This is not a valid QuranVid project.');
      const restored: MediaAsset[] = [];
      for (const record of data.media) {
        if (typeof record.id !== 'string' || typeof record.name !== 'string' || !['audio', 'image', 'video'].includes(record.type) || typeof record.data !== 'string' || !record.data.startsWith('data:')) throw new Error('Invalid project media.');
        const blob = await (await fetch(record.data)).blob();
        const asset: MediaAsset = { id: record.id, name: record.name, type: record.type, duration: record.duration, peaks: record.peaks, attribution: record.attribution, blob, url: URL.createObjectURL(blob) };
        await storeAsset(asset); restored.push(asset);
      }
      const complete = [SAMPLE_AUDIO, ...restored];
      const ids = new Set(complete.map(a => a.id));
      if (data.project.audio.some((a: { assetId: string }) => !ids.has(a.assetId))) throw new Error('This project is missing a source audio file.');
      setAssets(current => [...current.filter(asset => !restored.some(incoming => incoming.id === asset.id)), ...restored]); change(withEditableReference(data.project)); setTime(0); setSelected('background'); notify('Project opened, including its uploaded media.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not open project.'); }
    finally { if (importRef.current) importRef.current.value = ''; }
  };
  const runExport = async () => {
    setExportError(''); setExportResult(null); setExporting(true); setProgress(0); stopPlayback();
    const controller = new AbortController(); abort.current = controller;
    try {
      const { exportVideo } = await import('@/lib/export');
      const blob = await exportVideo(project, assets, format, setProgress, controller.signal, exportSize);
      setExportResult(blob); download(blob, `${project.name}.${format}`);
    } catch (error) { if (!controller.signal.aborted) setExportError(error instanceof Error ? error.message : 'Export failed. Please try again.'); }
    finally { setExporting(false); abort.current = null; }
  };
  return <main className={`studio-app${mobileControls ? ' mobile-controls-open' : ''}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length && !exporting && !remoteToken && recipeToken === null && !savedProjectsOpen && !creditsOpen) void importMedia(e.dataTransfer.files); }}>
    <input type="file" hidden multiple ref={fileRef} onChange={e => { if (e.target.files) void importMedia(e.target.files); }} />
    <input type="file" hidden accept=".json" ref={importRef} onChange={e => { if (e.target.files?.[0]) void restore(e.target.files[0]); }} />
    <header className="app-header">
      <a className="brand" href="/" aria-label="QuranVid home"><BrandMark /><span>Quran<span className="brand-light">Vid</span></span></a>
      <span className="header-divider" />
      <div className="project-name"><input aria-label="Project name" value={project.name} maxLength={100} onChange={e => change({ ...project, name: e.target.value })} /><button className="icon-btn" title="Project menu" aria-expanded={menu} onClick={() => setMenu(v => !v)}><ChevronDown size={14} /></button></div>
      <span className="save-status">{saved ? <CheckCheck size={14} /> : <LoaderCircle size={13} className="spin" />}<span>{saved ? 'Saved on this device' : 'Saving…'}</span></span>
      <div className="header-actions"><button className="icon-btn mobile-controls-toggle" aria-label="Editor controls" aria-controls="canvas-controls" aria-expanded={mobileControls} onClick={() => setMobileControls(value => !value)}><SlidersHorizontal size={18} /></button><div className="history-actions"><button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!historyCount || exporting} onClick={undo}><Undo2 size={17} /></button><button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!futureCount || exporting} onClick={redo}><Redo2 size={17} /></button></div><button className="subtle-button preview-header" onClick={() => { setSelected(null); void toggle(); }}>{playing ? <Pause size={14} /> : <Play size={14} />}Preview</button><button className="primary-button" aria-label="Export video" onClick={() => { stopPlayback(); setExportError(''); setExportResult(null); setExportOpen(true); }}><ArrowDownToLine size={16} /><span className="export-label-desktop">Export video</span><span className="export-label-mobile">Export</span></button></div>
    </header>
    <InstallApp menuOpen={menu} closeMenu={() => setMenu(false)} />
    {menu && <><div className="menu-dismiss" onClick={() => setMenu(false)} /><div className="project-menu"><div id="install-menu-slot" /><button onClick={() => { setMenu(false); stopPlayback(); setSavedProjectsOpen(true); }}><FolderOpen size={15} />Saved projects</button><button onClick={() => { setMenu(false); stopPlayback(); setCreditsOpen(true); }}><ExternalLink size={15} />Media credits</button><button onClick={() => { setMenu(false); importRef.current?.click(); }}><FolderOpen size={15} />Open project</button><button onClick={() => void backup()}><Download size={15} />Download project & media</button><button onClick={() => { setMenu(false); stopPlayback(); change(createProject()); setSelected('arabic'); setTime(0); }}><Plus size={15} />New sample project</button></div></>}
    <div className="editor-body">
      <nav className="tool-rail" aria-label="Editor tools"><div className="rail-tools">{NAV_ITEMS.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} aria-label={item.label} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}><item.icon size={21} strokeWidth={1.6} /><span>{item.label}</span></button>)}</div><div className="rail-bottom"><button title="Import media" onClick={() => upload('audio/*,image/*,video/*')}><Upload size={20} /><span>Uploads</span></button><button title="Keyboard shortcuts and help" onClick={() => setHelp(true)}><CircleHelp size={20} /><span>Help</span></button><span className="avatar">U</span></div></nav>
      <MobileSheet open={mobilePanel !== null && mobilePanel !== 'inspector'} compact={compact} label={`${NAV_ITEMS.find(item => item.id === tab)?.label ?? 'Library'} tools`} onClose={closeMobilePanel}>
      <Library tab={tab} project={project} assets={assets} change={change} markTiming={p => change(p, true, false)} select={selectForEditing} seek={seek} upload={upload} addAudio={addAudio} addText={addText} notify={notify} applyTemplate={applyTemplate} time={time} importRecitation={importRecitation} extractAudio={() => { stopPlayback(); setMobilePanel(null); setAudioToolOpen(true); }} />
      </MobileSheet>
      {mobilePanel && <button className="mobile-sheet-backdrop" aria-label="Close editor panel" tabIndex={-1} onClick={closeMobilePanel} />}
      <div className="workspace-column">
        <div id="canvas-controls" className="canvas-toolbar"><div className="mobile-edit-history"><button className="icon-btn" title="Undo" disabled={!historyCount || exporting} onClick={undo}><Undo2 size={18} /></button><button className="icon-btn" title="Redo" disabled={!futureCount || exporting} onClick={redo}><Redo2 size={18} /></button><button className="mobile-selection" onClick={() => setMobilePanel('inspector')}><SlidersHorizontal size={15} /><span>{project.layers.find(layer => layer.id === selected)?.name ?? (project.verses.some(verse => verse.id === selected) ? 'Verse settings' : project.audio.some(audio => audio.id === selected) ? 'Audio settings' : 'Video settings')}</span></button></div><div className="breadcrumb"><span>Studio</span><ChevronRight size={12} /><strong>{project.name.split('·')[0].trim()}</strong></div><div className="canvas-options"><button className="icon-btn" title="Replace background" onClick={() => upload('image/*,video/*')}><ImageIcon size={15} /></button><span className="aspect-pill"><Monitor size={13} />{project.width === project.height ? '1:1' : project.height > project.width ? project.height === 1350 ? '4:5' : '9:16' : '16:9'}</span><button className={`icon-btn ${safeZones ? 'active' : ''}`} title="Toggle safe area guides" aria-pressed={safeZones} onClick={() => setSafeZones(v => !v)}><Maximize size={15} /></button></div></div>
        <div className="stage-area"><div className="stage-top-note"><span className="status-dot" />Your verses. Your vision.</div><div className="canvas-fit" style={{ '--canvas-ratio': project.width / project.height, '--preview-zoom': previewZoom / 100 } as React.CSSProperties}><Canvas project={project} assets={assets} time={time} selected={selected} select={setSelected} change={change} checkpoint={checkpoint} safeZones={safeZones} onError={notify} /></div><div className="stage-bottom"><span>{project.width} × {project.height}<i>·</i>30 fps</span><div><button onClick={() => setPreviewZoom(z => z === 100 ? 75 : 100)}>{previewZoom === 100 ? 'Fit' : '75%'}<ChevronDown size={12} /></button></div></div></div>
        <Timeline compact={compact} project={project} assets={assets} time={time} seek={seek} playing={playing} toggle={() => void toggle()} selected={selected} select={setSelected} change={change} checkpoint={checkpoint} split={split} addAudio={() => upload('audio/*')} />
      </div>
      <MobileSheet open={mobilePanel === 'inspector'} compact={compact} label="Selection settings" onClose={closeMobilePanel}>
      <Inspector project={project} selected={selected} change={change} remove={remove} duplicate={duplicate} select={setSelected} time={time} seek={seek} notify={notify} replaceBackground={() => upload('image/*,video/*')} browseBackgrounds={() => { setTab('media'); if (compact) setMobilePanel('media'); }} previewFrom={previewFrom} splitVerse={split} mergeVerse={mergeVerse} />
      </MobileSheet>
    </div>
    {toast && <div className="toast" role="status"><span>{toast}</span><button className="icon-btn" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
    {importing && <div className="import-status" role="status"><LoaderCircle size={16} className="spin" />Preparing your media…</div>}
    <nav className="mobile-tools" aria-label="Mobile editor tools">{NAV_ITEMS.map(item => <button key={item.id} data-mobile-tool={item.id} aria-label={item.label} aria-pressed={mobilePanel === item.id} onClick={() => openMobileTool(item.id)}><item.icon size={21} strokeWidth={1.6} /><span>{item.label}</span></button>)}<button data-mobile-tool="inspector" aria-label="Edit selection" aria-pressed={mobilePanel === 'inspector'} onClick={() => openMobileTool('inspector')}><SlidersHorizontal size={21} strokeWidth={1.6} /><span>Edit</span></button></nav>
    {exportOpen && <div className="modal-backdrop"><section className="modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title"><div className="modal-heading"><span className="modal-icon"><ArrowDownToLine size={22} /></span><button className="icon-btn" aria-label="Close export dialog" disabled={exporting} onClick={() => setExportOpen(false)}><X size={19} /></button></div><h2 id="export-title">Ready to share your vision?</h2><p>Your video is rendered right here, on your device.</p><div className="export-summary"><Film size={22} /><div><strong>{project.name}</strong><span>{exportResolution.width} × {exportResolution.height} · 30 fps · {formatTime(project.duration)}</span></div></div><label className="form-field">Export resolution<select aria-label="Export resolution" value={exportSize} disabled={exporting} onChange={e => { setExportSize(e.target.value as ExportSize); setExportResult(null); setExportError(''); }}><option value="original">Original · {project.width} × {project.height}</option><option value="720p">720p · Lower resolution, less encoding work</option></select></label><label className="form-field">Video format<select aria-label="Export format" value={format} disabled={exporting || !exportCapabilities} onChange={e => { setFormat(e.target.value as 'mp4' | 'webm'); setExportResult(null); setExportError(''); }}><option value="mp4" disabled={!exportCapabilities?.mp4}>MP4 · {exportCapabilities && !exportCapabilities.mp4 ? 'Unavailable in this browser' : 'H.264 + AAC'}</option><option value="webm" disabled={!exportCapabilities?.webm}>WebM · {exportCapabilities?.webmCodec === 'vp8' ? 'VP8' : 'VP9'} + Opus</option></select></label><p className="field-note">{!exportCapabilities ? 'Checking supported export formats…' : !exportCapabilities.mp4 && exportCapabilities.webm ? 'WebM is selected because this browser cannot encode H.264 video. MP4 requires a browser with H.264 encoding support.' : !exportCapabilities.mp4 && !exportCapabilities.webm ? 'This browser cannot encode video at this project’s settings.' : 'MP4 is recommended for social platforms. WebM offers an alternative for playback and sharing.'}</p>{exporting && <div className="export-progress" role="status"><div><span>Creating your video…</span><strong>{Math.round(progress * 100)}%</strong></div><progress value={progress} max={1} /><span>Keep this tab open until your download is ready.</span></div>}{exportError && <div className="export-error" role="alert">{exportError}</div>}{exportResult && <div className="export-success"><Check size={17} />Your video is ready. {Math.round(exportResult.size / 1024 / 1024 * 10) / 10} MB</div>}<div className="modal-actions">{exporting ? <button className="subtle-button full" onClick={() => abort.current?.abort()}>Cancel export</button> : exportResult ? <><button className="subtle-button" onClick={() => setExportOpen(false)}>Back to editing</button><button className="primary-button" onClick={() => download(exportResult, `${project.name}.${format}`)}><Download size={15} />Download again</button></> : <button className="primary-button full" disabled={!exportCapabilities?.[format]} onClick={() => void runExport()}><ArrowDownToLine size={16} />Export {format.toUpperCase()}</button>}</div><div className="export-privacy"><ShieldCheck size={14} />No uploads. No watermark.</div></section></div>}
    {remoteToken && <SharedProject token={remoteToken} onClose={closeSharedProject} onOpen={async (draft, incoming) => {
      await saveProject(projectRef.current);
      for (const asset of incoming) await storeAsset(asset);
      setAssets(current => [...current.filter(asset => !incoming.some(next => next.id === asset.id)), ...incoming]);
      change(withEditableReference(draft)); setTime(0); timeRef.current = 0; setSelected('background'); closeSharedProject();
      notify('Project opened as an editable copy. Your previous project is in Saved projects.');
    }} />}
    {recipeToken !== null && <RecipeProject key={recipeToken} token={recipeToken} onClose={closeRecipeProject} onOpen={async (draft, incoming) => {
      await savePreparedProject(projectRef.current, draft, incoming);
      setAssets(current => [...current, ...incoming]);
      change(draft); setTime(0); timeRef.current = 0; setSelected('background'); closeRecipeProject();
      notify('Your video is ready to preview and edit. Use Export to download it.');
    }} />}
    {savedProjectsOpen && <SavedProjects onClose={closeSavedProjects} onOpen={draft => { stopPlayback(); change(withEditableReference(draft)); setTime(0); timeRef.current = 0; setSelected('background'); closeSavedProjects(); }} />}
    {creditsOpen && <MediaCredits assets={assets.filter(asset => project.audio.some(clip => clip.assetId === asset.id) || project.background.source === asset.id)} onClose={closeCredits} />}
    {audioToolOpen && <AudioExtractor onClose={closeAudioTool} onAdd={addExtractedAudio} />}
    {splitVerseId && project.verses.find(v => v.id === splitVerseId) && <VerseSplitter verse={project.verses.find(v => v.id === splitVerseId)!} time={time} playing={playing} seek={seek} previewFrom={previewFrom} stop={stopPlayback} onClose={closeVerseSplitter} onApply={(breaks, times, translations) => {
      const next = splitVerse(projectRef.current, splitVerseId, breaks, times, translations);
      change(next); setSelected(splitVerseId); seek(next.verses.find(v => v.id === splitVerseId)!.start); setSplitVerseId(null);
      notify('Verse split into parts. Adjust joined edges on the timeline to refine the timing.');
    }} />}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}><div className="panel-heading"><h2 id="help-title">A little room to create.</h2><button className="icon-btn" aria-label="Close help" onClick={() => setHelp(false)}><X size={18} /></button></div><p>Select a text layer on the canvas to move it. Drag its bottom-right handle to resize. Use the panel on the right for precise adjustments. Click a section heading to collapse or expand it.</p><p>Drag the divider above the timeline to show more tracks; double-click it to reset the height. Drag timeline clips to move them. Drag a verse edge past the end to extend the video, or use the end handle in the ruler. Audio edges trim the source recording. For custom recitation, mark verse starts using tap-to-sync in the Quran panel.</p><div className="shortcut-list">{[['Play / pause','Space'],['Undo','Ctrl / ⌘ + Z'],['Redo','Ctrl / ⌘ + Shift + Z'],['Split audio','S'],['Delete selection','Delete'],['Move one frame','← / →']].map(([action,key]) => <div key={action}><span>{action}</span><kbd>{key}</kbd></div>)}</div><p className="field-note">Projects save in this browser. Use the project menu to download a portable backup including your uploaded media. Clearing browser data removes locally saved projects.</p><button className="primary-button full" onClick={() => setHelp(false)}>Back to the studio</button></section></div>}
  </main>;
}
