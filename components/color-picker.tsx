'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clamp } from '@/lib/model';
import { hexToHsv, hsvToHex, normalizeHex, type HSV } from '@/lib/color';

export default function ColorPicker({ value, onChange, label = 'Text color' }: { value: string; onChange: (value: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [draft, setDraft] = useState(value);
  const anchor = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const restoreFocus = useRef(true);
  useEffect(() => {
    const next = hexToHsv(value);
    setHsv(current => ({ ...next, h: next.s ? next.h : current.h })); setDraft(value);
  }, [value]);
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    const update = () => {
      const target = anchor.current?.getBoundingClientRect(), popup = panel.current?.getBoundingClientRect();
      if (!target || !popup) return;
      const top = target.bottom + 8 + popup.height <= innerHeight - 12 ? target.bottom + 8 : target.top - popup.height - 8;
      setPosition({ left: clamp(target.right - popup.width, 12, Math.max(12, innerWidth - popup.width - 12)), top: clamp(top, 12, Math.max(12, innerHeight - popup.height - 12)) });
    };
    update(); window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    const observer = new ResizeObserver(update); if (panel.current) observer.observe(panel.current);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); observer.disconnect(); };
  }, [open]);
  useEffect(() => {
    if (!open) { if (wasOpen.current && restoreFocus.current) anchor.current?.focus({ preventScroll: true }); wasOpen.current = false; return; }
    wasOpen.current = true;
    restoreFocus.current = true;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) { restoreFocus.current = false; setOpen(false); } };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      // Keep editor shortcuts from acting through this popover.
      if (panel.current?.contains(event.target as Node)) event.stopPropagation();
      if (event.key !== 'Tab') return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button,input,[tabindex="0"]') ?? []);
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keys); };
  }, [open]);
  const update = (next: HSV) => { setHsv(next); onChange(hsvToHex(next)); };
  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    update({ ...hsv, s: clamp((event.clientX - rect.left) / rect.width, 0, 1), v: 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1) });
  };
  return <div className="color-control"><span>{label}</span><button ref={anchor} className="color-trigger" type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(current => !current)}><i style={{ background: value }} /><span>{value}</span></button>{open && createPortal(<div ref={panel} className="color-popover" role="dialog" aria-label={`${label} picker`} style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>
    <div className="color-popover-heading"><strong>{label}</strong><button className="icon-btn" aria-label="Close color picker" onClick={() => setOpen(false)}><X size={16} /></button></div>
    <div className="color-spectrum" role="slider" tabIndex={0} aria-label="Saturation and brightness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.s * 100)} aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`} style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }} onPointerDown={e => { e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); pick(e); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e); }} onKeyDown={e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); update({ ...hsv, s: clamp(hsv.s + (e.key === 'ArrowRight' ? .01 : e.key === 'ArrowLeft' ? -.01 : 0), 0, 1), v: clamp(hsv.v + (e.key === 'ArrowUp' ? .01 : e.key === 'ArrowDown' ? -.01 : 0), 0, 1) });
    }}><i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} /></div>
    <label className="color-hue-label">Hue<input className="color-hue" aria-label="Color hue" type="range" min={0} max={359} value={Math.round(hsv.h)} onChange={e => update({ ...hsv, h: +e.target.value })} /></label>
    <label className="form-field">Hex color<input aria-label="Hex color" value={draft} maxLength={7} spellCheck={false} onChange={e => { setDraft(e.target.value); if (/^#?[\da-f]{6}$/i.test(e.target.value)) onChange(normalizeHex(e.target.value)!); }} onBlur={() => { const color = normalizeHex(draft); if (color) onChange(color); else setDraft(value); }} onKeyDown={e => { if (e.key === 'Enter') { const color = normalizeHex(draft); if (color) { onChange(color); setDraft(color); } } }} /></label>
    <div className="color-presets">{['#ffffff', '#f2ede3', '#c0d5a7', '#e6c98f', '#a9cce3', '#d5a6b8', '#252a26', '#000000'].map(color => <button key={color} aria-label={`Set ${label.toLowerCase()} ${color}`} style={{ background: color }} onClick={() => onChange(color)} />)}</div>
  </div>, document.body)}</div>;
}
