'use client';
import { useEffect, useRef, useState } from 'react';
import { drawProject, loadBackground, type LayerBounds, type RenderResources } from '@/lib/renderer';
import { clamp, type MediaAsset, type Project } from '@/lib/model';
import { manualTextLayout } from '@/lib/text-layout';
import { ensureFont, getLayerFont } from '@/lib/fonts';

type Props = { project: Project; assets: MediaAsset[]; time: number; selected: string | null; select: (id: string | null) => void; change: (p: Project, history?: boolean) => void; checkpoint: () => void; safeZones: boolean; onError: (message: string) => void };
export default function Canvas({ project, assets, time, selected, select, change, checkpoint, safeZones, onError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bounds = useRef<LayerBounds[]>([]);
  const resources = useRef<RenderResources>({});
  const [revision, setRevision] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ id: string; x: number; y: number; original: Project; resize: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let loaded: RenderResources | undefined;
    loadBackground(project, assets).then(result => {
      loaded = result;
      if (cancelled) { result.video?.pause(); return; }
      resources.current = result;
      setRevision(v => v + 1);
    }).catch(error => { if (!cancelled) onError(error.message); });
    return () => { cancelled = true; loaded?.video?.pause(); };
  // Reload only when the media source changes, not for positioning or dimming edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.background.source, project.background.type, assets, onError]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => { bounds.current = drawProject(canvas, project, time, resources.current); };
    const video = resources.current.video;
    if (video && Number.isFinite(video.duration)) {
      video.onseeked = render;
      const target = Math.min(time % video.duration, video.duration - .04);
      if (Math.abs(video.currentTime - target) > .015) video.currentTime = target;
    }
    render();
    return () => { if (video) video.onseeked = null; };
  }, [project, time, revision]);
  const fontKey = [...new Set(project.layers.map(getLayerFont))].join('|');
  useEffect(() => {
    let cancelled = false;
    const families = [...new Set(project.layers.map(getLayerFont))];
    Promise.all(families.map(ensureFont)).then(() => { if (!cancelled) setRevision(v => v + 1); }).catch(error => { if (!cancelled) onError(error.message); });
    return () => { cancelled = true; };
    // The key captures every font family; positioning edits do not reload fonts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontKey, onError]);
  const selectedBounds = bounds.current.find(b => b.id === selected);
  const selectedLayer = project.layers.find(l => l.id === selected);
  const position = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * project.width, y: (event.clientY - rect.top) / rect.height * project.height };
  };
  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const point = position(event);
    const resize = (event.target as HTMLElement).dataset.resize === 'true';
    const hit = resize ? bounds.current.find(b => b.id === selected) : [...bounds.current].reverse().find(b => point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height);
    select(hit?.id ?? 'background');
    if (hit) {
      checkpoint(); event.currentTarget.setPointerCapture(event.pointerId);
      const verseText = project.layers.some(layer => layer.id === hit.id && (layer.kind === 'arabic' || layer.kind === 'translation'));
      const original = project.autoFitText && verseText && canvasRef.current
        ? manualTextLayout(canvasRef.current.getContext('2d')!, project, time) : project;
      gesture.current = { id: hit.id, ...point, original, resize }; setDragging(true);
    }
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current; if (!g) return;
    const point = position(event);
    const layer = g.original.layers.find(l => l.id === g.id)!;
    const dx = (point.x - g.x) / project.width * 100;
    const dy = (point.y - g.y) / project.height * 100;
    let x = clamp(layer.x + dx, layer.width / 2, 100 - layer.width / 2);
    let y = clamp(layer.y + dy, 3, 97);
    if (Math.abs(x - 50) < 1.1) x = 50;
    if (Math.abs(y - 50) < 1.1) y = 50;
    change({ ...g.original, layers: g.original.layers.map(l => l.id !== g.id ? l : g.resize ? { ...l, width: clamp(layer.width + dx * 2, 10, 100), fontSize: clamp(layer.fontSize + dx, 8, 180) } : { ...l, x, y }) }, false);
  };
  const end = () => { gesture.current = null; setDragging(false); };
  return <div className={`video-canvas ${dragging ? 'is-dragging' : ''}`} style={{ aspectRatio: `${project.width}/${project.height}` }} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
    <canvas ref={canvasRef} width={project.width} height={project.height} aria-label="Video preview. Select a text layer to move or resize it." />
    {safeZones && <div className="safe-zone"><span>Safe area</span></div>}
    {selectedBounds && selectedLayer?.visible && <div className="selection-box" style={{ left: `${selectedBounds.x / project.width * 100}%`, top: `${selectedBounds.y / project.height * 100}%`, width: `${selectedBounds.width / project.width * 100}%`, height: `${selectedBounds.height / project.height * 100}%` }}>
      <span className="selection-label">{selectedLayer?.name}</span>
      <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" data-resize="true" />
    </div>}
    {dragging && selectedLayer?.x === 50 && <div className="canvas-guide" />}
  </div>;
}
