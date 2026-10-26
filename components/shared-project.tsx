'use client';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FolderOpen, LoaderCircle, X } from 'lucide-react';
import { formatTime, validateProject, type MediaAsset, type MediaAttribution, type Project } from '@/lib/model';
import { loadSavedProjects } from '@/lib/storage';

type RemoteMedia = { id: string; name: string; type: MediaAsset['type']; duration?: number; bytes: number; url: string; attribution?: MediaAttribution };
type Draft = { project: Project; media: RemoteMedia[]; expiresAt: string };
export function useDialogFocus(close: () => void) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const items = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,textarea') ?? []);
    items()[0]?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key !== 'Tab') return;
      const list = items(), first = list[0], last = list.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('keydown', keys); previous?.focus(); };
  }, [close]);
  return dialog;
}
export default function SharedProject({ token, onClose, onOpen }: { token: string; onClose: () => void; onOpen: (project: Project, assets: MediaAsset[]) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft | null>(null), [error, setError] = useState(''), [progress, setProgress] = useState('');
  const [opening, setOpening] = useState(false);
  const cancellation = useRef<AbortController | null>(null);
  const busy = useRef(false); busy.current = opening;
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const close = useRef(() => { if (!busy.current) closeRef.current(); }).current;
  const dialog = useDialogFocus(close);
  useEffect(() => {
    const controller = new AbortController(); cancellation.current = controller;
    fetch(`/api/handoffs/${token}`, { signal: controller.signal, credentials: 'omit', cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error(response.status === 410 ? 'This project link expired. Ask for a new link.' : 'This project link could not be opened.');
      const data = await response.json();
      if (!validateProject(data.project) || !Array.isArray(data.media) || data.media.length > 101 || data.media.some((asset: RemoteMedia) =>
        typeof asset.id !== 'string' || typeof asset.name !== 'string' || !['image', 'video', 'audio'].includes(asset.type) || asset.url !== `/api/handoffs/${token}/media/${asset.id}` || !Number.isFinite(asset.bytes) || asset.bytes <= 0)) throw new Error('This link contains an invalid project.');
      setDraft(data);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not open this project.'); });
    return () => controller.abort();
  }, [token]);
  const open = async () => {
    if (!draft || opening) return; setOpening(true); setError('');
    const assets: MediaAsset[] = [];
    try {
      for (const [index, media] of draft.media.entries()) {
        setProgress(`Downloading media ${index + 1} of ${draft.media.length}…`);
        const response = await fetch(media.url, { signal: cancellation.current!.signal, credentials: 'omit', cache: 'no-store' });
        if (!response.ok) throw new Error(`Could not download ${media.name}. The link may have expired.`);
        const blob = await response.blob();
        assets.push({ id: media.id, name: media.name, type: media.type, duration: media.duration, attribution: media.attribution, blob, url: URL.createObjectURL(blob) });
      }
      setProgress('Opening your editable copy…'); await onOpen(draft.project, assets);
    } catch (reason) { assets.forEach(asset => URL.revokeObjectURL(asset.url)); setError(reason instanceof Error ? reason.message : 'Could not import this project.'); }
    finally { setOpening(false); setProgress(''); }
  };
  return <div className="modal-backdrop"><section className="modal shared-project-modal" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="shared-project-title"><div className="panel-heading"><h2 id="shared-project-title">Open shared project</h2><button className="icon-btn" aria-label="Close shared project" disabled={opening} onClick={onClose}><X size={18} /></button></div>
    {!draft && !error && <p role="status"><LoaderCircle className="spin" size={16} />Loading project…</p>}
    {draft && <><h3>{draft.project.name}</h3><p>{draft.project.width} × {draft.project.height} · {formatTime(draft.project.duration)} · {draft.media.length} media files</p><p>This opens an editable copy on this device. Your current project remains available under Saved projects.</p>
      <div className="shared-media-list">{draft.media.map(media => <div key={media.id}><strong>{media.name}</strong><span>{media.type}{media.attribution?.creator ? ` · ${media.attribution.creator}` : ''}{media.attribution?.license ? ` · ${media.attribution.license}` : ''}</span></div>)}</div>
      <p className="field-note">Opening this copy does not change the project on the server.</p></>}
    {error && <div className="export-error" role="alert">{error}</div>}{progress && <p role="status">{progress}</p>}
    <div className="modal-actions"><button className="subtle-button" disabled={opening} onClick={onClose}>Cancel</button><button className="primary-button" disabled={!draft || opening} onClick={() => void open()}>{opening ? <LoaderCircle size={15} className="spin" /> : <FolderOpen size={15} />}Open editable copy</button></div>
  </section></div>;
}
export function SavedProjects({ onClose, onOpen }: { onClose: () => void; onOpen: (project: Project) => void }) {
  const [projects, setProjects] = useState<Project[]>([]), [error, setError] = useState('');
  const dialog = useDialogFocus(onClose);
  useEffect(() => { let cancelled = false; loadSavedProjects().then(records => { if (!cancelled) setProjects(records.filter(validateProject)); }).catch(() => { if (!cancelled) setError('Saved projects could not be loaded.'); }); return () => { cancelled = true; }; }, []);
  return <div className="modal-backdrop"><section className="modal shared-project-modal" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="saved-projects-title"><div className="panel-heading"><h2 id="saved-projects-title">Saved projects</h2><button className="icon-btn" aria-label="Close saved projects" onClick={onClose}><X size={18} /></button></div><p>Projects saved on this device.</p>{error && <p role="alert">{error}</p>}<div className="saved-project-list">{projects.map(project => <button key={project.id} className="subtle-button full" onClick={() => onOpen(project)}><FolderOpen size={16} /><span><strong>{project.name}</strong><small>{formatTime(project.duration)} · {project.width} × {project.height}</small></span></button>)}</div></section></div>;
}
export function MediaCredits({ assets, onClose }: { assets: MediaAsset[]; onClose: () => void }) {
  const dialog = useDialogFocus(onClose);
  return <div className="modal-backdrop"><section className="modal shared-project-modal" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="media-credits-title"><div className="panel-heading"><h2 id="media-credits-title">Media credits</h2><button className="icon-btn" aria-label="Close media credits" onClick={onClose}><X size={18} /></button></div><p>Source information is kept with your project backup.</p><div className="shared-media-list">{assets.filter(asset => asset.attribution).map(asset => {
    const credit = asset.attribution!, timing = credit.timing;
    return <div key={asset.id}><strong>{credit.title || asset.name}</strong><span>{credit.creator}{credit.license ? ` · ${credit.license}` : ''}{credit.provider ? ` · ${credit.provider}` : ''}</span>
      {/^https?:\/\//i.test(credit.sourceUrl) && <a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer">View source<ExternalLink size={12} /></a>}
      {timing && <><span>{timing.title} · {timing.creator}</span>
        {/^https?:\/\//i.test(timing.sourceUrl) && <a href={timing.sourceUrl} target="_blank" rel="noopener noreferrer">View timing source<ExternalLink size={12} /></a>}
        {timing.licenseUrl && /^https?:\/\//i.test(timing.licenseUrl) && <a href={timing.licenseUrl} target="_blank" rel="noopener noreferrer">Timing data: {timing.license}<ExternalLink size={12} /></a>}
      </>}
    </div>;
  })}</div><a href="/backgrounds/SOURCES.md" target="_blank" rel="noopener noreferrer" className="text-button">Bundled background credits<ExternalLink size={12} /></a></section></div>;
}
