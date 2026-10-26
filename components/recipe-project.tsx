'use client';
import { useEffect, useRef, useState } from 'react';
import { Film, LoaderCircle, X } from 'lucide-react';
import { buildRecipeProject, decodeRecipeFragment, recipeSelection, type RecipeLibrary, type VideoRecipe } from '@/lib/video-recipe';
import { formatTime, uid, type MediaAsset, type Project } from '@/lib/model';
import { recitationAttribution, type TimedRecitation } from '@/lib/recitations';
import { getPeaks } from '@/lib/audio';
import { useDialogFocus } from './shared-project';
import { getVideoTemplate, SOLID_BACKGROUNDS } from '@/lib/templates';

type PreparedRecipe = { recipe: VideoRecipe; library: RecipeLibrary; recording: TimedRecitation };
export default function RecipeProject({ token, onClose, onOpen }: { token: string; onClose: () => void; onOpen: (project: Project, assets: MediaAsset[]) => Promise<void> }) {
  const [prepared, setPrepared] = useState<PreparedRecipe | null>(null);
  const [error, setError] = useState(''), [progress, setProgress] = useState('');
  const [opening, setOpening] = useState(false), [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null), locking = useRef(false);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const close = useRef(() => { if (!locking.current) { controller.current?.abort(); closeRef.current(); } }).current;
  const dialog = useDialogFocus(close);
  useEffect(() => {
    const abort = new AbortController();
    const json = async (url: string) => {
      const response = await fetch(url, { signal: abort.signal, credentials: 'omit' });
      if (!response.ok) throw new Error('The recipe library could not load. Check your connection and reopen the link.');
      return response.json();
    };
    void (async () => {
      const recipe = decodeRecipeFragment(token);
      const [chapters, verses, recitations] = await Promise.all(['/data/chapters.json', '/data/quran.json', '/data/recitations/catalog.json'].map(json));
      const library: RecipeLibrary = { chapters, verses, recitations };
      recipeSelection(recipe, library);
      // The recording URL comes exclusively from bundled metadata, never the link.
      const recording: TimedRecitation = await json(`/data/recitations/${recipe.reciterId}/${recipe.chapter}.json`);
      recipeSelection(recipe, library, recording);
      if (!abort.signal.aborted) setPrepared({ recipe, library, recording });
    })().catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'This video recipe could not be opened.'); });
    return () => { abort.abort(); controller.current?.abort(); };
  }, [token]);
  const prepare = async () => {
    if (!prepared || controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    setOpening(true); setError(''); setProgress('Opening recitation…');
    let dispose: (() => void) | undefined, url: string | undefined;
    try {
      const { recipe, library, recording } = prepared;
      const { range, reciter, chapter } = recipeSelection(recipe, library, recording);
      const { openAudioSource, readAudioRange, encodeWav } = await import('@/lib/media-audio');
      abort.signal.throwIfAborted();
      const source = await openAudioSource(recording.audioUrl);
      dispose = () => source.input.dispose();
      abort.signal.addEventListener('abort', dispose, { once: true });
      abort.signal.throwIfAborted();
      const buffer = await readAudioRange(source, range!.start, range!.end, abort.signal, value => setProgress(`Preparing recitation · ${Math.round(value * 100)}%`));
      const blob = encodeWav(buffer); url = URL.createObjectURL(blob);
      const asset: MediaAsset = { id: uid(), name: `${reciter.name} · ${recipe.chapter}:${recipe.from}–${recipe.to}`, type: 'audio',
        blob, url, duration: range!.end - range!.start, peaks: getPeaks(buffer),
        attribution: recitationAttribution(reciter, `${chapter.name} ${recipe.from}–${recipe.to}`) };
      const project = buildRecipeProject(recipe, library, recording, asset.id);
      abort.signal.throwIfAborted();
      locking.current = true; setSaving(true); setProgress('Saving your editable video on this device…');
      await onOpen(project, [asset]); url = undefined;
    } catch (reason) {
      if (!abort.signal.aborted) setError(reason instanceof Error && !/fetch|network/i.test(reason.message) ? reason.message : 'The recitation could not be prepared. Check your connection and try again.');
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (dispose) { abort.signal.removeEventListener('abort', dispose); dispose(); }
      if (controller.current === abort) controller.current = null;
      locking.current = false;
      if (!abort.signal.aborted) { setOpening(false); setSaving(false); setProgress(''); }
    }
  };
  const selection = prepared && recipeSelection(prepared.recipe, prepared.library, prepared.recording);
  const backgroundName = prepared && (prepared.recipe.backgroundColor ?? SOLID_BACKGROUNDS.find(color => color.id === prepared.recipe.background)?.name ?? prepared.recipe.background);
  return <div className="modal-backdrop"><section className="modal shared-project-modal" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="recipe-project-title">
    <div className="panel-heading"><h2 id="recipe-project-title">Open video recipe</h2><button className="icon-btn" aria-label="Close video recipe" disabled={saving} onClick={close}><X size={18} /></button></div>
    {!prepared && !error && <p role="status">Loading recipe…</p>}
    {prepared && selection && <><h3>{prepared.recipe.name ?? `${selection.chapter.name} ${prepared.recipe.chapter}:${prepared.recipe.from}–${prepared.recipe.to}`}</h3>
      <div className="shared-media-list">
        <div><strong>{selection.chapter.name} · verses {prepared.recipe.from}–{prepared.recipe.to}</strong><span>{selection.reciter.name} · {formatTime(selection.range!.end - selection.range!.start)} · {prepared.recipe.format}</span></div>
        <div><strong>{backgroundName} background · {prepared.recipe.template ? getVideoTemplate(prepared.recipe.template).name : prepared.recipe.style} style</strong><span>{prepared.recipe.arabicFont}{prepared.recipe.showTranslation ? ` · ${prepared.recipe.translationFont} translation` : ' · Translation hidden'}</span></div>
      </div>
      <p>Prepare an editable video on this device. Recitation downloads directly from the audio library. Your current project stays in Saved projects.</p>
      <p className="field-note">Preview and adjust the video, then click Export to download it. Nothing is rendered or saved on the server.</p></>}
    {error && <p className="export-error" role="alert">{error}</p>}
    {opening && <p role="status">{progress}</p>}
    <div className="modal-actions"><button className="subtle-button" disabled={saving} onClick={close}>{opening ? 'Cancel preparation' : 'Cancel'}</button><button className="primary-button" disabled={!prepared || opening} onClick={() => void prepare()}>{opening ? <LoaderCircle size={15} className="spin" /> : <Film size={15} />}Prepare video</button></div>
  </section></div>;
}
