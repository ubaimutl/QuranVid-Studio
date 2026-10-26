import * as z from 'zod/v4';
import { createProject } from './sample';
import { uid, validateProject, type Chapter, type Project, type Verse } from './model';
import { selectRecitationRange, type RecitationCatalog, type TimedRecitation } from './recitations';
import { applyVideoTemplate, backgroundForChoice, RECIPE_BACKGROUNDS, solidForeground, TEMPLATE_IDS, templateRecipeDefaults } from './templates';

// Only settings belong in a public link. Media URLs, credentials, Quran text and
// executable content are deliberately absent from this versioned format.
const position = z.number().min(0).max(100);
const layout = z.object({
  x: position.optional(), y: position.optional(), width: z.number().min(10).max(100).optional(),
  fontSize: z.number().min(12).max(180).optional(), color: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(),
  opacity: z.number().min(0).max(1).optional(), lineHeight: z.number().min(80).max(300).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
}).strict();
const recipeObject = z.object({
  version: z.literal(1).default(1), name: z.string().trim().min(1).max(100).optional(),
  chapter: z.number().int().min(1).max(114), from: z.number().int().min(1).max(286), to: z.number().int().min(1).max(286),
  reciterId: z.number().int().min(1).max(10000).default(7),
  format: z.enum(['portrait', 'square', 'landscape', 'post']).default('portrait'),
  background: z.enum(RECIPE_BACKGROUNDS).default('forest').describe('A bundled photo, named solid color, or color for a custom hex background. Solid colors are always static.'),
  backgroundColor: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional().describe('Any six-digit hex color, for example #272727 for dark gray. Overrides the background with a static solid color; no uploaded image is needed.'),
  template: z.enum(TEMPLATE_IDS).optional().describe('Optional starting design from get_catalog. Explicit recipe settings override the template. Charcoal is dark gray; parchment and ivory use dark text on light backgrounds.'),
  style: z.enum(['calm', 'cinematic', 'minimal']).default('calm'),
  arabicFont: z.enum(['Noto Naskh Arabic', 'Amiri Quran', 'Amiri', 'Scheherazade New', 'Lateef']).default('Amiri Quran'),
  translationFont: z.enum(['DM Sans', 'sans-serif', 'serif', 'monospace']).default('serif'),
  showTranslation: z.boolean().default(true), showTitle: z.boolean().default(true), showReference: z.boolean().default(true),
  referenceFormat: z.enum(['full', 'key', 'number']).default('full'),
  arabicAnimation: z.enum(['none', 'typewriter', 'word-reveal', 'line-reveal']).default('typewriter'),
  translationAnimation: z.enum(['none', 'typewriter', 'word-reveal', 'line-reveal']).default('line-reveal'),
  animationDuration: z.number().min(.1).max(5).default(1.5),
  motion: z.enum(['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'zoom-drift', 'breathe']).default('zoom-in'),
  motionStrength: z.number().min(0).max(40).default(6), dim: z.number().min(0).max(.9).default(.55),
  layout: z.object({ arabic: layout.optional(), translation: layout.optional(), title: layout.optional(), reference: layout.optional() }).strict().optional(),
}).strict();
const validRange = (value: { from: number; to: number }) => value.to >= value.from && value.to - value.from < 100;
const rangeIssue = { message: 'Choose 1–100 consecutive verses.', path: ['to'] };
export const recipeSchema = recipeObject.refine(validRange, rangeIssue);
// Keep omitted fields omitted at the MCP boundary, so template defaults never
// override a setting explicitly supplied by the user (including false and 0).
export const recipeInputSchema = recipeObject.extend({
  version: recipeObject.shape.version.removeDefault().optional(),
  reciterId: recipeObject.shape.reciterId.removeDefault().optional(),
  format: recipeObject.shape.format.removeDefault().optional(),
  background: recipeObject.shape.background.removeDefault().optional().describe('Photo background or named static solid color such as dark-gray. Custom colors use backgroundColor; all solid backgrounds are static.'),
  style: recipeObject.shape.style.removeDefault().optional(),
  arabicFont: recipeObject.shape.arabicFont.removeDefault().optional(),
  translationFont: recipeObject.shape.translationFont.removeDefault().optional(),
  showTranslation: recipeObject.shape.showTranslation.removeDefault().optional(),
  showTitle: recipeObject.shape.showTitle.removeDefault().optional(),
  showReference: recipeObject.shape.showReference.removeDefault().optional(),
  referenceFormat: recipeObject.shape.referenceFormat.removeDefault().optional(),
  arabicAnimation: recipeObject.shape.arabicAnimation.removeDefault().optional(),
  translationAnimation: recipeObject.shape.translationAnimation.removeDefault().optional(),
  animationDuration: recipeObject.shape.animationDuration.removeDefault().optional(),
  motion: recipeObject.shape.motion.removeDefault().optional(),
  motionStrength: recipeObject.shape.motionStrength.removeDefault().optional(),
  dim: recipeObject.shape.dim.removeDefault().optional(),
}).refine(validRange, rangeIssue);
export type VideoRecipe = z.infer<typeof recipeSchema>;
export type RecipeLibrary = { chapters: Chapter[]; verses: Verse[]; recitations: RecitationCatalog };
export const RECIPE_MAX_BYTES = 8192;
export const RECIPE_MAX_ENCODED = Math.ceil(RECIPE_MAX_BYTES * 4 / 3);
export function normalizeRecipe(value: unknown): VideoRecipe {
  const input = recipeInputSchema.parse(value);
  const settings = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  const recipe = recipeSchema.parse({ ...templateRecipeDefaults(input.template), ...settings });
  if (recipe.backgroundColor) recipe.background = 'color';
  if (!['mountains', 'forest', 'coast'].includes(recipe.background)) {
    recipe.dim = 0; recipe.motion = 'none'; recipe.motionStrength = 0;
  }
  return recipe;
}

export function encodeRecipe(value: unknown) {
  const recipe = normalizeRecipe(value);
  const bytes = new TextEncoder().encode(JSON.stringify(recipe));
  if (bytes.length > RECIPE_MAX_BYTES) throw new Error('This video recipe is too large.');
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeRecipe(encoded: string): VideoRecipe {
  if (!encoded || encoded.length > RECIPE_MAX_ENCODED || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('This video recipe link is invalid or too large.');
  try {
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
    if (bytes.length > RECIPE_MAX_BYTES) throw new Error();
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (data?.version !== 1) throw new Error();
    return normalizeRecipe(data);
  } catch { throw new Error('This video recipe is invalid or uses an unsupported version. Ask for a new link.'); }
}

// Readable, compact fragments are easier for clients to preserve verbatim than
// long base64 strings. Version 1 defaults are fixed by recipeSchema; only
// non-default settings need to travel in new links. Legacy links remain valid.
export function recipeFragment(value: unknown) {
  const recipe = normalizeRecipe(value);
  const defaults = normalizeRecipe({ chapter: recipe.chapter, from: recipe.from, to: recipe.to, template: recipe.template });
  const params = new URLSearchParams({ create: '1', chapter: String(recipe.chapter), from: String(recipe.from), to: String(recipe.to) });
  if (recipe.template) params.set('template', recipe.template);
  for (const key of Object.keys(recipe) as (keyof VideoRecipe)[]) {
    if (['version', 'chapter', 'from', 'to', 'template'].includes(key) || JSON.stringify(recipe[key]) === JSON.stringify(defaults[key])) continue;
    params.set(key, key === 'layout' ? JSON.stringify(recipe[key]) : String(recipe[key]));
  }
  const fragment = '#' + params.toString();
  if (fragment.length > 12000) throw new Error('This video recipe is too large.');
  return fragment;
}
export function decodeRecipeFragment(fragment: string): VideoRecipe {
  if (fragment.length > 12000) throw new Error('This video recipe link is too large.');
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  const legacy = params.get('recipe');
  if (legacy !== null && params.size === 1) return decodeRecipe(legacy);
  if (params.get('create') !== '1' || new Set(params.keys()).size !== params.size) throw new Error('This video recipe link is damaged or uses an unsupported version. Ask for a new link.');
  try {
    const numeric = new Set(['chapter', 'from', 'to', 'reciterId', 'animationDuration', 'motionStrength', 'dim']);
    const boolean = new Set(['showTranslation', 'showTitle', 'showReference']);
    const recipe: Record<string, unknown> = { version: 1 };
    for (const [key, value] of params) {
      if (key === 'create') continue;
      if (key === 'version') throw new Error();
      if (numeric.has(key) || boolean.has(key) || key === 'layout') {
        const parsed: unknown = JSON.parse(value);
        if ((numeric.has(key) && typeof parsed !== 'number') || (boolean.has(key) && typeof parsed !== 'boolean')) throw new Error();
        Object.defineProperty(recipe, key, { value: parsed, enumerable: true });
      } else Object.defineProperty(recipe, key, { value, enumerable: true });
    }
    if (new TextEncoder().encode(JSON.stringify(recipe)).length > RECIPE_MAX_BYTES) throw new Error();
    return normalizeRecipe(recipe);
  } catch { throw new Error('This video recipe contains invalid settings. Ask for a new link.'); }
}
export function recipeSelection(recipe: VideoRecipe, library: RecipeLibrary, recording?: TimedRecitation) {
  const chapter = library.chapters.find(chapter => chapter.id === recipe.chapter);
  if (!chapter || recipe.to > chapter.count) throw new Error('Choose valid verses within the selected surah.');
  const reciter = library.recitations.reciters.find(reciter => reciter.id === recipe.reciterId && reciter.chapters.includes(recipe.chapter));
  if (!reciter) throw new Error('This reciter and surah combination is unavailable. Ask for a recording listed in get_catalog.');
  if (!recording) return { chapter, reciter };
  if (recording.version !== 1 || recording.reciterId !== recipe.reciterId) throw new Error('The recording does not match this recipe.');
  return { chapter, reciter, range: selectRecitationRange(recording, library.verses, recipe.chapter, recipe.from, recipe.to) };
}
export function buildRecipeProject(recipe: VideoRecipe, library: RecipeLibrary, recording: TimedRecitation, audioAssetId: string): Project {
  const { chapter, reciter, range } = recipeSelection(recipe, library, recording);
  if (!range) throw new Error('Verified verse timings are required.');
  let project = createProject();
  const formats = { portrait: [1080, 1920], square: [1080, 1080], landscape: [1920, 1080], post: [1080, 1350] };
  [project.width, project.height] = formats[recipe.format];
  if (recipe.template) project = applyVideoTemplate(project, recipe.template);
  if (['arabic', 'translation'].some(slot => { const position = recipe.layout?.[slot as 'arabic' | 'translation']; return position?.x !== undefined || position?.y !== undefined; })) project.autoFitText = false;
  project.id = uid(); project.name = recipe.name ?? `${chapter.name} ${recipe.chapter}:${recipe.from}–${recipe.to}`;
  project.duration = range.end - range.start; project.verses = range.clips; project.showReference = recipe.showReference;
  project.background = backgroundForChoice(recipe.background, project.duration, recipe.backgroundColor);
  if (project.background.type === 'image') Object.assign(project.background, { dim: recipe.dim, motion: recipe.motion, motionStrength: recipe.motionStrength });
  const scale = Math.min(project.width / 1080, project.height / 1920);
  const colors = project.background.type === 'color' && !recipe.template ? solidForeground(project.background.source) : undefined;
  project.layers = project.layers.map(layer => {
    const slot = layer.kind === 'reference' ? 'reference' : layer.id as 'arabic' | 'translation' | 'title';
    const next = { ...layer, end: project.duration, fontSize: recipe.template ? layer.fontSize : Math.round(layer.fontSize * scale),
      ...(recipe.style === 'cinematic' ? { color: '#f2ede3' } : {}),
      ...(colors ? { color: layer.kind === 'arabic' ? colors.arabic : layer.kind === 'translation' ? colors.translation : colors.secondary } : {}),
      ...(recipe.style === 'minimal' ? { opacity: 1 } : {}) };
    if (layer.kind === 'arabic') Object.assign(next, { fontFamily: recipe.arabicFont, animation: { effect: recipe.arabicAnimation, duration: recipe.animationDuration } });
    if (layer.kind === 'translation') Object.assign(next, { fontFamily: recipe.translationFont, visible: recipe.showTranslation,
      animation: { effect: recipe.translationAnimation, duration: recipe.animationDuration },
      transition: { enter: 'fade', exit: 'fade', duration: .35 } });
    if (layer.id === 'title') Object.assign(next, { text: chapter.name, visible: recipe.showTitle });
    if (layer.kind === 'reference') Object.assign(next, { visible: recipe.showReference, referenceFormat: recipe.referenceFormat });
    return { ...next, ...recipe.layout?.[slot] };
  });
  project.audio = [{ id: uid(), assetId: audioAssetId, name: `${reciter.name} · ${recipe.chapter}:${recipe.from}–${recipe.to}`,
    start: 0, offset: 0, duration: project.duration, sourceDuration: project.duration, volume: 1, fadeIn: 0, fadeOut: 0, recitation: true }];
  if (!validateProject(project)) throw new Error('The recipe could not be converted to a valid project.');
  return project;
}
