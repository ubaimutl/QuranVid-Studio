import { activeVerse, clamp, getLineHeight, type Project, type VisualLayer } from './model';
import { fontStack, getLayerFont } from './fonts';

export function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > width) { lines.push(line); line = word; }
      else line = test;
    }
    if (line) lines.push(line);
  }
  return lines;
}


export function layerText(project: Project, layer: VisualLayer, time: number) {
  const verse = activeVerse(project, time);
  if (layer.kind === 'reference') return !verse ? '' : layer.referenceFormat === 'number' ? verse.key.split(':')[1] : layer.referenceFormat === 'key' ? verse.key : `Quran ${verse.key}`;
  return layer.kind === 'arabic' ? verse?.arabic ?? '' : layer.kind === 'translation' ? verse?.translation ?? '' : layer.text ?? '';
}


export type TextMeasurement = { lines: string[]; top: number; bottom: number; height: number };
const measurements = new WeakMap<CanvasRenderingContext2D, Map<string, TextMeasurement>>();

// Use full shaped lines, including vowel marks. Measurements never depend on
// reveal progress, so an entrance animation cannot move the layout around.
export function measureLayerText(ctx: CanvasRenderingContext2D, project: Project, layer: VisualLayer, text: string): TextMeasurement {
  ctx.save();
  ctx.font = `${layer.fontSize}px ${fontStack(getLayerFont(layer))}`;
  ctx.textBaseline = 'middle'; ctx.direction = layer.kind === 'arabic' || /[\u0600-\u06ff]/.test(text) ? 'rtl' : 'ltr';
  const width = project.width * layer.width / 100;
  // Font metrics change when a web font replaces its fallback. Include a probe
  // in the cache key so preview and export always use the loaded font's sizes.
  const probe = ctx.measureText('بِسْمِ ٱللَّهِ Aa');
  const key = JSON.stringify([ctx.font, ctx.direction, width, getLineHeight(layer), text, probe.width, probe.actualBoundingBoxAscent]);
  let cache = measurements.get(ctx);
  if (!cache) { cache = new Map(); measurements.set(ctx, cache); }
  const cached = cache.get(key);
  if (cached) { ctx.restore(); return cached; }
  const lines = wrapText(ctx, text, width);
  const step = layer.fontSize * getLineHeight(layer) / 100;
  let top = Infinity, bottom = -Infinity;
  lines.forEach((line, index) => {
    const metrics = ctx.measureText(line);
    const baseline = (index - (lines.length - 1) / 2) * step;
    top = Math.min(top, baseline - metrics.actualBoundingBoxAscent);
    bottom = Math.max(bottom, baseline + metrics.actualBoundingBoxDescent);
  });
  if (!lines.length) top = bottom = 0;
  const result = { lines, top, bottom, height: bottom - top };
  if (cache.size >= 512) cache.clear();
  cache.set(key, result); ctx.restore(); return result;
}

export type TextFitResult = { project: Project; overflow: boolean; adjusted: boolean };
export function fitProjectText(ctx: CanvasRenderingContext2D, project: Project, time: number): TextFitResult {
  const unchanged = { project, overflow: false, adjusted: false };
  if (!project.autoFitText) return unchanged;
  const active = project.layers.filter(layer => layer.visible && time >= layer.start && time < layer.end);
  // Additional duplicated text layers are manual decorations, not template slots.
  const slots = ['arabic', 'translation'].flatMap(kind => {
    const layer = active.find(layer => layer.kind === kind);
    return layer && layerText(project, layer, time) ? [layer] : [];
  });
  if (!slots.length) return unchanged;
  const h = project.height;
  const padding = h * .035;
  const title = active.find(layer => layer.id === 'title');
  const reference = project.showReference ? active.find(layer => layer.kind === 'reference') : undefined;
  const top = Math.max(h * .1, title ? title.y * h / 100 + measureLayerText(ctx, project, title, layerText(project, title, time)).bottom + padding : 0);
  const bottom = Math.min(h * .9, reference ? reference.y * h / 100 + measureLayerText(ctx, project, reference, layerText(project, reference, time)).top - padding : h);
  const gap = slots.length > 1 ? h * .03 : 0;
  const measure = (layer: VisualLayer) => measureLayerText(ctx, project, layer, layerText(project, layer, time));
  // Reserve the full transition envelope, not just this frame's transform.
  const envelope = (layer: VisualLayer, m: TextMeasurement) => {
    const effects = [layer.transition?.enter, layer.transition?.exit];
    const travel = effects.some(effect => effect === 'slide-up' || effect === 'slide-down') ? h * .035 : 0;
    const zoom = layer.transition?.exit === 'zoom' ? .08 * Math.max(Math.abs(m.top), Math.abs(m.bottom)) : 0;
    return { top: m.top - travel - zoom - 8, bottom: m.bottom + travel + zoom + 8 };
  };
  const at = (factor: number) => slots.map(original => {
    const layer = { ...original, fontSize: Math.max(8, original.fontSize * factor) };
    return { layer, ...envelope(layer, measure(layer)) };
  });
  const total = (items: ReturnType<typeof at>) => items.reduce((sum, item) => sum + item.bottom - item.top, gap);
  let items = at(1);
  const alreadyFits = items.every(item => item.layer.y * h / 100 + item.top >= top && item.layer.y * h / 100 + item.bottom <= bottom)
    && (items.length < 2 || items[0].layer.y * h / 100 + items[0].bottom + gap <= items[1].layer.y * h / 100 + items[1].top);
  if (alreadyFits) return unchanged;
  // Never reduce below 75% of the chosen size. Truly long passages need parts,
  // rather than silently becoming unreadable. A fixed search keeps fitting cheap.
  if (total(items) > bottom - top) {
    let low = .75, high = 1;
    items = at(low);
    if (total(items) <= bottom - top) {
      for (let i = 0; i < 9; i++) {
        const mid = (low + high) / 2, candidate = at(mid);
        if (total(candidate) <= bottom - top) { low = mid; items = candidate; } else high = mid;
      }
    }
  }
  const height = total(items);
  let cursor = (top + bottom - height) / 2;
  const replacements = new Map(items.map(item => {
    const layer = { ...item.layer, y: (cursor - item.top) / h * 100 };
    cursor += item.bottom - item.top + gap;
    return [layer.id, layer];
  }));
  return { project: { ...project, layers: project.layers.map(layer => replacements.get(layer.id) ?? layer) }, overflow: height > bottom - top, adjusted: true };
}

// Freeze the current fitted layout when users switch to manual positioning.
export function manualTextLayout(ctx: CanvasRenderingContext2D, project: Project, time: number): Project {
  const fitted = fitProjectText(ctx, project, time).project;
  return { ...fitted, autoFitText: false, layers: fitted.layers.map(layer => ({ ...layer, y: clamp(layer.y, 0, 100) })) };
}

export function verseTextOverlaps(ctx: CanvasRenderingContext2D, project: Project, time: number): boolean {
  const blocks = ['arabic', 'translation'].map(kind => {
    const layer = project.layers.find(layer => layer.kind === kind && layer.visible && time >= layer.start && time < layer.end);
    if (!layer) return undefined;
    const text = layerText(project, layer, time);
    if (!text) return undefined;
    const measured = measureLayerText(ctx, project, layer, text);
    return { left: layer.x - layer.width / 2, right: layer.x + layer.width / 2,
      top: project.height * layer.y / 100 + measured.top, bottom: project.height * layer.y / 100 + measured.bottom };
  });
  const [arabic, translation] = blocks;
  return !!arabic && !!translation && arabic.left < translation.right && translation.left < arabic.right
    && arabic.top < translation.bottom && translation.top < arabic.bottom;
}
