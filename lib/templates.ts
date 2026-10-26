import type { Background, Project, VisualLayer } from './model';
import type { FontFamily } from './fonts';
import type { BackgroundMotion } from './transitions';
import type { TextAnimation } from './text-animation';

export const SOLID_BACKGROUNDS = [
  { id: 'dark-gray', name: 'Dark gray', color: '#272727' },
  { id: 'black', name: 'Black', color: '#0e0e0e' },
  { id: 'midnight', name: 'Midnight blue', color: '#111827' },
  { id: 'deep-olive', name: 'Deep olive', color: '#20271f' },
  { id: 'parchment', name: 'Warm parchment', color: '#eee5d5' },
  { id: 'ivory', name: 'Ivory', color: '#f5f1e8' },
  { id: 'slate', name: 'Slate', color: '#303946' },
  { id: 'emerald', name: 'Deep emerald', color: '#163b32' },
  { id: 'warm-brown', name: 'Warm brown', color: '#6a5146' },
] as const;
export const RECIPE_BACKGROUNDS = ['mountains', 'forest', 'coast', 'color', ...SOLID_BACKGROUNDS.map(color => color.id)] as const;
export type BackgroundChoice = typeof RECIPE_BACKGROUNDS[number];
export function solidForeground(color: string) {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  return .299 * r + .587 * g + .114 * b > 160
    ? { arabic: '#252925', translation: '#444c44', secondary: '#5c655c' }
    : { arabic: '#ffffff', translation: '#f2ede3', secondary: '#ffffff' };
}
const PHOTOS = {
  mountains: { name: 'Alpine stillness', source: '/backgrounds/mountains.jpg' },
  forest: { name: 'Forest light', source: '/backgrounds/forest.jpg' },
  coast: { name: 'By the sea', source: '/backgrounds/coast.jpg' },
} as const;
export function backgroundForChoice(choice: BackgroundChoice, duration: number, color?: string): Background {
  if (color !== undefined && !/^#[a-f\d]{6}$/i.test(color)) throw new Error('Choose a six-digit hex background color.');
  const solid = SOLID_BACKGROUNDS.find(item => item.id === choice);
  const base = { dim: 0, blur: 0, scale: 1, positionX: 50, positionY: 50, motion: 'none' as const,
    motionStrength: 0, motionDuration: duration, motionRepeat: false };
  if (solid || choice === 'color' || color !== undefined) return { ...base, type: 'color', source: color ?? solid?.color ?? '#272727', name: color ? 'Custom color' : solid?.name ?? 'Solid color' };
  const photo = PHOTOS[choice as keyof typeof PHOTOS];
  if (!photo) throw new Error('Choose a supported background.');
  return { ...base, ...photo, type: 'image', dim: .43 };
}

export const TEMPLATE_IDS = ['stillness', 'forest', 'coast', 'charcoal', 'midnight', 'olive', 'parchment', 'ivory', 'black-gold', 'slate'] as const;
export type TemplateId = typeof TEMPLATE_IDS[number];
type Slot = 'arabic' | 'translation' | 'title' | 'reference';
type TemplateLayout = Record<Slot, { y: number; width: number; fontSize: number }>;
const CENTERED: TemplateLayout = { arabic: { y: 43, width: 84, fontSize: 74 }, translation: { y: 59, width: 76, fontSize: 33 }, title: { y: 18, width: 80, fontSize: 30 }, reference: { y: 87, width: 80, fontSize: 25 } };
const SPACIOUS: TemplateLayout = { arabic: { y: 42, width: 82, fontSize: 80 }, translation: { y: 62, width: 74, fontSize: 32 }, title: { y: 15, width: 80, fontSize: 28 }, reference: { y: 88, width: 80, fontSize: 24 } };
const COMPACT: TemplateLayout = { arabic: { y: 42, width: 86, fontSize: 72 }, translation: { y: 58, width: 80, fontSize: 31 }, title: { y: 20, width: 80, fontSize: 27 }, reference: { y: 82, width: 80, fontSize: 23 } };
type Template = {
  id: TemplateId; name: string; subtitle: string; background: BackgroundChoice;
  arabicFont: FontFamily; translationFont: FontFamily; arabicColor: string; translationColor: string; secondaryColor: string;
  layout: TemplateLayout; dim: number; motion: BackgroundMotion; motionStrength: number;
  arabicAnimation: TextAnimation['effect']; translationAnimation: TextAnimation['effect'];
};
const BASE = { arabicFont: 'Amiri Quran' as const, translationFont: 'serif' as const,
  arabicColor: '#ffffff', translationColor: '#f2ede3', secondaryColor: '#ffffff', layout: CENTERED,
  dim: 0, motion: 'none' as const, motionStrength: 0, arabicAnimation: 'none' as const, translationAnimation: 'none' as const };
export const VIDEO_TEMPLATES: readonly Template[] = [
  { ...BASE, id: 'stillness', name: 'Stillness', subtitle: 'Mountains · Warm white', background: 'mountains', dim: .43 },
  { ...BASE, id: 'forest', name: 'Forest', subtitle: 'Forest · Gentle zoom', background: 'forest', dim: .5, motion: 'zoom-in', motionStrength: 6, arabicAnimation: 'typewriter', translationAnimation: 'line-reveal' },
  { ...BASE, id: 'coast', name: 'Coast', subtitle: 'Open skies · Ivory text', background: 'coast', dim: .5, translationFont: 'DM Sans', layout: SPACIOUS, motion: 'pan-left', motionStrength: 4 },
  { ...BASE, id: 'charcoal', name: 'Charcoal', subtitle: 'Dark gray · Serif translation', background: 'dark-gray', layout: SPACIOUS, arabicAnimation: 'typewriter', translationAnimation: 'line-reveal' },
  { ...BASE, id: 'midnight', name: 'Midnight', subtitle: 'Navy · Cool white', background: 'midnight', arabicFont: 'Noto Naskh Arabic', translationFont: 'DM Sans', arabicColor: '#edf3ff', translationColor: '#d7e1ef', secondaryColor: '#c2cee0', layout: COMPACT },
  { ...BASE, id: 'olive', name: 'Olive', subtitle: 'Deep olive · Cream', background: 'deep-olive', arabicFont: 'Amiri', arabicColor: '#f2ead7', translationColor: '#e2dccb', secondaryColor: '#c8c4ac', layout: SPACIOUS },
  { ...BASE, id: 'parchment', name: 'Parchment', subtitle: 'Warm paper · Dark ink', background: 'parchment', arabicFont: 'Amiri', arabicColor: '#342c24', translationColor: '#514333', secondaryColor: '#635340', layout: SPACIOUS },
  { ...BASE, id: 'ivory', name: 'Ivory', subtitle: 'Light · Simple sans serif', background: 'ivory', arabicFont: 'Noto Naskh Arabic', translationFont: 'sans-serif', arabicColor: '#252925', translationColor: '#444c44', secondaryColor: '#5c655c', layout: COMPACT },
  { ...BASE, id: 'black-gold', name: 'Black & gold', subtitle: 'Black · Muted gold', background: 'black', arabicColor: '#e6c98f', translationColor: '#eee3cf', secondaryColor: '#cdbb96', layout: SPACIOUS },
  { ...BASE, id: 'slate', name: 'Slate', subtitle: 'Blue gray · Clear type', background: 'slate', arabicFont: 'Scheherazade New', translationFont: 'DM Sans', arabicColor: '#f1f5fa', translationColor: '#dbe2ed', secondaryColor: '#c5cfdd', layout: CENTERED },
];
export function getVideoTemplate(id: TemplateId) { return VIDEO_TEMPLATES.find(template => template.id === id)!; }
export function templateRecipeDefaults(id?: TemplateId) {
  if (!id) return {};
  const template = getVideoTemplate(id);
  return { background: template.background, dim: template.dim, motion: template.motion, motionStrength: template.motionStrength,
    arabicFont: template.arabicFont, translationFont: template.translationFont,
    arabicAnimation: template.arabicAnimation, translationAnimation: template.translationAnimation };
}
export function applyVideoTemplate(project: Project, id: TemplateId): Project {
  const template = getVideoTemplate(id);
  const scale = Math.min(project.width / 1080, project.height / 1920);
  const background = backgroundForChoice(template.background, project.duration);
  if (background.type === 'image') Object.assign(background, { dim: template.dim, motion: template.motion, motionStrength: template.motionStrength });
  return { ...project, autoFitText: true, background, layers: project.layers.map(layer => {
    const slot: Slot | undefined = layer.kind === 'text' ? layer.id === 'title' ? 'title' : undefined : layer.kind;
    if (!slot) return layer;
    const layout = template.layout[slot];
    return { ...layer, ...layout, x: 50, fontSize: Math.round(layout.fontSize * scale), align: 'center',
      color: slot === 'arabic' ? template.arabicColor : slot === 'translation' ? template.translationColor : template.secondaryColor,
      fontFamily: slot === 'arabic' ? template.arabicFont : slot === 'translation' ? template.translationFont : 'DM Sans',
      opacity: slot === 'arabic' ? 1 : slot === 'translation' ? .95 : slot === 'title' ? .82 : .7,
      ...(slot === 'arabic' || slot === 'translation' ? { animation: { effect: slot === 'arabic' ? template.arabicAnimation : template.translationAnimation, duration: 1.5 } } : {}),
    } satisfies VisualLayer;
  }) };
}
