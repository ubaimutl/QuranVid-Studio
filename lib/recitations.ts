import { uid, type MediaAttribution, type Project, type Verse, type VerseClip } from './model';
export type Reciter = { id: number; name: string; style: string; chapters: number[]; source?: MediaAttribution };
export type RecitationCatalog = { version: 1; generatedAt: string; environment: string; reciters: Reciter[] };
export type VerseTiming = { key: string; start: number; end: number };
export type TimedRecitation = { version: 1; reciterId: number; chapter: number; audioUrl: string; timings: VerseTiming[] };
export function recitationAttribution(reciter: Reciter, title: string): MediaAttribution {
  return { sourceUrl: 'https://quran.com', provider: 'Quran Foundation', ...reciter.source, title, creator: reciter.name };
}
export function selectRecitationRange(recording: TimedRecitation, verses: Verse[], chapter: number, from: number, to: number) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to - from >= 100 || recording.chapter !== chapter) throw new Error('Choose between 1 and 100 verses from the selected surah.');
  const selected = Array.from({ length: to - from + 1 }, (_, i) => {
    const key = `${chapter}:${from + i}`;
    const timing = recording.timings.find(t => t.key === key);
    const verse = verses.find(v => v.key === key);
    if (!timing || !verse || !Number.isFinite(timing.start) || !Number.isFinite(timing.end) || timing.start < 0 || timing.end <= timing.start) throw new Error(`Verified timing is unavailable for verse ${key}.`);
    return { verse, timing };
  });
  const start = selected[0].timing.start, end = selected.at(-1)!.timing.end;
  if (end - start > 600 || selected.some((item, i) => i > 0 && item.timing.start < selected[i - 1].timing.start)) throw new Error('Choose a shorter range with valid consecutive timings, up to 10 minutes.');
  const clips: VerseClip[] = selected.map(({ verse, timing }) => ({ ...verse, id: uid(), start: timing.start - start, end: timing.end - start }));
  return { start, end, clips };
}
export function applyTimedRecitation(project: Project, verses: VerseClip[], assetId: string, name: string, duration: number, start: number): Project {
  const end = start + duration;
  const audio = project.audio.filter(a => a.recitation !== true && a.assetId !== 'sample-alafasy');
  const contentEnd = Math.max(end, ...audio.map(a => a.start + a.duration));
  const projectDuration = Math.max(1, contentEnd, ...project.layers.filter(l => l.end !== project.duration).map(l => l.end));
  return { ...project, duration: projectDuration,
    verses: verses.map(v => ({ ...v, start: v.start + start, end: v.end + start })),
    layers: project.layers.map(l => l.end === project.duration ? { ...l, end: projectDuration } : l),
    audio: [...audio, { id: uid(), assetId, name, start, offset: 0, duration, sourceDuration: duration, volume: 1, fadeIn: 0, fadeOut: 0, recitation: true }],
  };
}
