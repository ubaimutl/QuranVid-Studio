import type { Project, VisualLayer } from './model';

export const FONT_OPTIONS = [
  { family: 'Noto Naskh Arabic', arabic: true, description: 'Balanced Naskh' },
  { family: 'Amiri Quran', arabic: true, description: 'Quranic Naskh' },
  { family: 'Amiri', arabic: true, description: 'Classical Naskh' },
  { family: 'Scheherazade New', arabic: true, description: 'Traditional, spacious' },
  { family: 'Lateef', arabic: true, description: 'Soft, flowing forms' },
  { family: 'DM Sans', arabic: false, description: 'Clean sans serif' },
  { family: 'sans-serif', arabic: false, description: 'System sans-serif' },
  { family: 'serif', arabic: false, description: 'System serif' },
  { family: 'monospace', arabic: false, description: 'System monospace' },
] as const;
export type FontFamily = typeof FONT_OPTIONS[number]['family'];
export const isFontFamily = (value: unknown): value is FontFamily => FONT_OPTIONS.some(font => font.family === value);
export const getLayerFont = (layer: Pick<VisualLayer, 'kind' | 'fontFamily'>): FontFamily => layer.fontFamily ?? (layer.kind === 'arabic' ? 'Noto Naskh Arabic' : 'DM Sans');
export const fontStack = (family: FontFamily) => ['sans-serif', 'serif', 'monospace'].includes(family) ? family : `"${family}"`;
const loaded = new Map<FontFamily, Promise<void>>();
export function ensureFont(family: FontFamily) {
  // Generic families use installed browser fonts, not downloadable FontFace entries.
  if (['sans-serif', 'serif', 'monospace'].includes(family)) return Promise.resolve();
  let pending = loaded.get(family);
  if (!pending) {
    pending = document.fonts.load(`400 24px "${family}"`, 'بِسْمِ ٱللَّهِ Aa').then(faces => {
      if (!faces.length) throw new Error(`The ${family} font could not be loaded. Refresh and try again.`);
    }).catch(error => { loaded.delete(family); throw error; });
    loaded.set(family, pending);
  }
  return pending;
}
export async function ensureProjectFonts(project: Project) {
  const families = new Set<FontFamily>(['DM Sans', ...project.layers.map(getLayerFont)]);
  await Promise.all([...families].map(ensureFont));
}
