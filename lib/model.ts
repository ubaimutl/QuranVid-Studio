import { isFontFamily, type FontFamily } from './fonts';
import { BACKGROUND_MOTIONS, validTransition, type BackgroundMotion, type TransitionSettings } from './transitions';
import { validTextAnimation, type TextAnimation } from './text-animation';

export type Verse = { key: string; arabic: string; translation: string };
export type Chapter = { id: number; name: string; arabic: string; count: number };
export type VisualLayer = {
  id: string; kind: 'arabic' | 'translation' | 'text' | 'reference'; name: string;
  x: number; y: number; width: number; fontSize: number; color: string;
  align: 'left' | 'center' | 'right'; opacity: number; visible: boolean;
  start: number; end: number; text?: string; lineHeight?: number;
  fontFamily?: FontFamily; transition?: TransitionSettings;
  animation?: TextAnimation; referenceFormat?: 'full' | 'key' | 'number';
};
export type VersePart = {
  groupId: string; originalId: string; arabic: string; translation: string;
  index: number; count: number;
};
export type VerseClip = Verse & { id: string; start: number; end: number; part?: VersePart };
export type AudioClip = {
  id: string; assetId: string; name: string; start: number; offset: number;
  duration: number; sourceDuration: number; volume: number; fadeIn: number; fadeOut: number;
  recitation?: boolean;
};
export type Background = {
  type: 'image' | 'video' | 'color'; source: string; name: string;
  dim: number; blur: number; scale: number; positionX: number; positionY: number;
  transition?: TransitionSettings; motion?: BackgroundMotion;
  motionStrength?: number; motionDuration?: number; motionRepeat?: boolean;
};
export type Project = {
  version: 1; id: string; name: string; width: number; height: number;
  duration: number; background: Background; layers: VisualLayer[];
  verses: VerseClip[]; audio: AudioClip[]; showReference: boolean; autoFitText?: boolean;
};
export type MediaAsset = {
  id: string; name: string; type: 'audio' | 'image' | 'video'; url: string;
  blob?: Blob; duration?: number; peaks?: number[];
  attribution?: MediaAttribution;
};
export type SourceAttribution = { title: string; creator?: string; sourceUrl: string; license?: string; licenseUrl?: string; provider?: string };
export type MediaAttribution = SourceAttribution & { timing?: SourceAttribution };
export const BACKGROUNDS = [
  { name: 'Alpine stillness', source: '/backgrounds/mountains.jpg' },
  { name: 'Forest light', source: '/backgrounds/forest.jpg' },
  { name: 'By the sea', source: '/backgrounds/coast.jpg' },
];
export const uid = () => crypto.randomUUID();
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const getLineHeight = (layer: VisualLayer) => layer.lineHeight ?? (layer.kind === 'arabic' ? 185 : 155);

export function withEditableReference(project: Project): Project {
  if (project.layers.some(layer => layer.kind === 'reference')) return project;
  const id = project.layers.some(layer => layer.id === 'verse-reference') ? uid() : 'verse-reference';
  return { ...project, layers: [...project.layers, { id, kind: 'reference', name: 'Verse number',
    x: 50, y: 87, width: 80, fontSize: 25, color: '#ffffff', opacity: .65,
    align: 'center', visible: project.showReference, start: 0, end: project.duration, lineHeight: 100 }] };
}

// Only layers anchored to the old project end follow a duration change.
// The final verse follows only when explicitly resizing the whole project.
export function resizeProject(project: Project, requested: number, followLastVerse = false): Project {
  const last = project.verses.reduce<Project['verses'][number] | undefined>((latest, verse) => !latest || verse.end > latest.end ? verse : latest, undefined);
  const follows = followLastVerse && last && Math.abs(last.end - project.duration) < .001;
  const minimum = Math.max(1,
    ...project.audio.map(a => a.start + a.duration),
    ...project.verses.map(v => follows && v.id === last.id ? v.start + .1 : v.end),
    ...project.layers.filter(l => Math.abs(l.end - project.duration) >= .001).map(l => l.end));
  const duration = clamp(requested, minimum, 600);
  return { ...project, duration,
    layers: project.layers.map(l => Math.abs(l.end - project.duration) < .001 ? { ...l, end: duration } : l),
    verses: follows ? project.verses.map(v => v.id === last.id ? { ...v, end: duration } : v) : project.verses,
  };
}
export function formatTime(seconds: number, precise = false) {
  const n = Math.max(0, seconds);
  const minutes = Math.floor(n / 60).toString().padStart(2, '0');
  const secs = Math.floor(n % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}${precise ? `.${Math.floor((n % 1) * 100).toString().padStart(2, '0')}` : ''}`;
}
export function activeVerse(project: Project, time: number) {
  return project.verses.find(v => time >= v.start && time < v.end);
}
export function audioGain(clip: AudioClip, localTime: number) {
  if (localTime < 0 || localTime >= clip.duration) return 0;
  const incoming = clip.fadeIn > 0 ? Math.min(1, localTime / clip.fadeIn) : 1;
  const outgoing = clip.fadeOut > 0 ? Math.min(1, (clip.duration - localTime) / clip.fadeOut) : 1;
  return clip.volume * Math.min(incoming, outgoing);
}
export function splitAudio(clip: AudioClip, time: number): AudioClip[] {
  const cut = time - clip.start;
  if (cut <= .05 || cut >= clip.duration - .05) return [clip];
  return [
    { ...clip, duration: cut, fadeOut: 0 },
    { ...clip, id: uid(), start: time, offset: clip.offset + cut, duration: clip.duration - cut, fadeIn: 0 },
  ];
}
export function validateProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const p = value as Project;
  const number = (n: unknown, min = 0, max = 1e5) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  const string = (s: unknown) => typeof s === 'string' && s.length < 100000;
  return p.version === 1 && string(p.id) && string(p.name) && number(p.duration, .1, 600)
    && number(p.width, 100, 3840) && number(p.height, 100, 3840)
    && typeof p.showReference === 'boolean' && (p.autoFitText === undefined || typeof p.autoFitText === 'boolean') && !!p.background
    && ['image', 'video', 'color'].includes(p.background.type) && string(p.background.source)
    && number(p.background.dim, 0, 1) && number(p.background.blur, 0, 30)
    && number(p.background.scale, 1, 3) && number(p.background.positionX, 0, 100) && number(p.background.positionY, 0, 100)
    && (p.background.transition === undefined || validTransition(p.background.transition))
    && (p.background.motion === undefined || BACKGROUND_MOTIONS.some(m => m.value === p.background.motion))
    && (p.background.motionStrength === undefined || number(p.background.motionStrength, 0, 40))
    && (p.background.motionDuration === undefined || number(p.background.motionDuration, .1, 600))
    && (p.background.motionRepeat === undefined || typeof p.background.motionRepeat === 'boolean')
    && Array.isArray(p.layers) && p.layers.length <= 101 && p.layers.every(l =>
      string(l.id) && string(l.name) && ['arabic', 'translation', 'text', 'reference'].includes(l.kind)
      && number(l.x, 0, 100) && number(l.y, 0, 100) && number(l.width, 5, 100)
      && number(l.fontSize, 8, 200) && string(l.color) && number(l.opacity, 0, 1)
      && (l.lineHeight === undefined || number(l.lineHeight, 80, 300))
      && (l.fontFamily === undefined || isFontFamily(l.fontFamily))
      && (l.transition === undefined || validTransition(l.transition))
      && (l.animation === undefined || validTextAnimation(l.animation))
      && (l.referenceFormat === undefined || ['full', 'key', 'number'].includes(l.referenceFormat))
      && ['left', 'center', 'right'].includes(l.align) && typeof l.visible === 'boolean'
      && number(l.start) && number(l.end) && l.end > l.start && (l.text === undefined || string(l.text)))
    && Array.isArray(p.verses) && p.verses.length <= 1000 && p.verses.every(v =>
      string(v.id) && string(v.key) && string(v.arabic) && string(v.translation) && number(v.start) && number(v.end) && v.end > v.start
      && (v.part === undefined || (!!v.part && string(v.part.groupId) && string(v.part.originalId)
        && string(v.part.arabic) && string(v.part.translation) && Number.isInteger(v.part.index) && Number.isInteger(v.part.count)
        && number(v.part.count, 2, 16) && number(v.part.index, 1, v.part.count))))
    && Array.isArray(p.audio) && p.audio.length <= 100 && p.audio.every(a =>
      string(a.id) && string(a.assetId) && string(a.name) && number(a.start) && number(a.offset)
      && number(a.duration, .05, 600) && number(a.sourceDuration, .05, 1e5)
      && a.offset + a.duration <= a.sourceDuration + .1
      && number(a.volume, 0, 2) && number(a.fadeIn, 0, 30) && number(a.fadeOut, 0, 30));
}
