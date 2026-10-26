import * as z from 'zod/v4';
import { FONT_OPTIONS } from '../lib/fonts';
import { BACKGROUND_MOTIONS, TRANSITION_OPTIONS } from '../lib/transitions';
import { TEXT_ANIMATIONS } from '../lib/text-animation';
import { RECIPE_BACKGROUNDS, TEMPLATE_IDS } from '../lib/templates';

export const identifier = z.string().uuid();
const time = z.number().finite().min(0).max(600);
export const transition = z.object({ enter: z.enum(TRANSITION_OPTIONS.map(item => item.value)), exit: z.enum(TRANSITION_OPTIONS.map(item => item.value)), duration: z.number().min(.1).max(3) }).strict();
export const animation = z.object({ effect: z.enum(TEXT_ANIMATIONS.map(item => item.value)), duration: z.number().min(.1).max(10) }).strict();
export const backgroundPatch = z.object({ type: z.enum(['image', 'video', 'color']).optional(), source: z.string().max(200).optional(), name: z.string().max(200).optional(),
  dim: z.number().min(0).max(1).optional(), blur: z.number().min(0).max(30).optional(), scale: z.number().min(1).max(3).optional(),
  positionX: z.number().min(0).max(100).optional(), positionY: z.number().min(0).max(100).optional(),
  motion: z.enum(BACKGROUND_MOTIONS.map(item => item.value)).optional(), motionStrength: z.number().min(0).max(40).optional(), motionDuration: z.number().min(.1).max(600).optional(), motionRepeat: z.boolean().optional(), transition: transition.optional() }).strict();
export const layerPatch = z.object({ text: z.string().max(5000).optional(), name: z.string().max(100).optional(), x: z.number().min(0).max(100).optional(), y: z.number().min(0).max(100).optional(),
  width: z.number().min(5).max(100).optional(), fontSize: z.number().min(8).max(200).optional(), color: z.string().regex(/^#[\da-fA-F]{6}$/).optional(),
  fontFamily: z.enum(FONT_OPTIONS.map(font => font.family)).optional(), align: z.enum(['left', 'center', 'right']).optional(), opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(), start: time.optional(), end: time.optional(), lineHeight: z.number().min(80).max(300).optional(),
  referenceFormat: z.enum(['full', 'key', 'number']).optional(), transition: transition.optional(), animation: animation.optional() }).strict();
export const createInput = z.object({ chapter: z.number().int().min(1).max(114), from: z.number().int().min(1).max(286), to: z.number().int().min(1).max(286),
  reciterId: z.number().int().positive().optional().describe('Use an available reciter from get_catalog to import exact recitation and timings.'),
  duration: z.number().min(1).max(600).optional().describe('Used for manual verse timing when no reciter is selected.'),
  name: z.string().min(1).max(100).optional(), format: z.enum(['portrait', 'square', 'landscape', 'post']).default('portrait'),
  background: z.enum(RECIPE_BACKGROUNDS).optional().describe('Bundled photo or named static color. Defaults to mountains when no template is selected.'),
  backgroundColor: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional().describe('Custom static solid background, for example #272727 for dark gray.'),
  template: z.enum(TEMPLATE_IDS).optional(), backgroundAssetId: identifier.optional(),
  arabicFont: z.enum(FONT_OPTIONS.filter(font => font.arabic).map(font => font.family)).optional(), translationFont: z.enum(FONT_OPTIONS.map(font => font.family)).optional() }).strict();
export const editInput = z.object({ projectId: identifier, expectedRevision: z.number().int().positive(), name: z.string().min(1).max(100).optional(),
  duration: z.number().min(1).max(600).optional(), width: z.number().int().min(100).max(3840).optional(), height: z.number().int().min(100).max(3840).optional(),
  background: backgroundPatch.optional(), showReference: z.boolean().optional(), autoFitText: z.boolean().optional(),
  layers: z.array(z.object({ id: z.string().max(100), patch: layerPatch }).strict()).max(100).optional(),
  addText: z.array(layerPatch.extend({ text: z.string().min(1).max(5000) })).max(20).optional(),
  audio: z.array(z.object({ id: z.string().max(100).optional(), assetId: identifier, name: z.string().max(200).optional(), recitation: z.boolean().optional(), sourceDuration: z.number().positive().max(100000).optional(), start: time, offset: z.number().min(0).max(100000).default(0), duration: z.number().min(.05).max(600),
    volume: z.number().min(0).max(2).default(1), fadeIn: z.number().min(0).max(30).default(0), fadeOut: z.number().min(0).max(30).default(0) }).strict()).max(100).optional().describe('If supplied, replaces all audio clips, including recitation. Use get_project first to preserve existing clips.'),
  verseTimings: z.array(z.object({ id: z.string().max(100), start: time, end: time }).strict()).max(1000).optional(),
  splitVerse: z.object({ id: z.string().max(100), breaks: z.array(z.number().int().positive()).min(1).max(15), times: z.array(time).min(1).max(15), translations: z.array(z.string().max(10000)).max(16).optional() }).strict().optional(),
  mergeVerseId: z.string().max(100).optional() }).strict();
export const searchInput = z.object({ type: z.enum(['image', 'audio']), query: z.string().min(1).max(200), limit: z.number().int().min(1).max(20).default(8) }).strict();
export const importInput = z.object({ url: z.string().url().max(4096).optional(), type: z.enum(['image', 'audio', 'video']), name: z.string().max(200).optional(),
  openverseId: identifier.optional().describe('Prefer an Openverse search result ID to retain verified source/license metadata.'), start: time.optional(), end: z.number().min(.1).max(100000).optional(),
  sourceUrl: z.string().url().max(4096).optional(), creator: z.string().max(200).optional(), license: z.string().max(100).optional(), licenseUrl: z.string().url().max(4096).optional() }).strict();
export const linkInput = z.object({ projectId: identifier, hours: z.number().int().min(1).max(168).default(72) }).strict();
