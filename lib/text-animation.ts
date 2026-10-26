export const TEXT_ANIMATIONS = [
  { value: 'none', label: 'None' },
  { value: 'typewriter', label: 'Typewriter' },
  { value: 'word-reveal', label: 'Word by word' },
  { value: 'line-reveal', label: 'Line by line' },
] as const;
export type TextAnimation = { effect: typeof TEXT_ANIMATIONS[number]['value']; duration: number };
export function validTextAnimation(value: unknown): value is TextAnimation {
  if (!value || typeof value !== 'object') return false;
  const animation = value as TextAnimation;
  return TEXT_ANIMATIONS.some(option => option.value === animation.effect)
    && typeof animation.duration === 'number' && Number.isFinite(animation.duration) && animation.duration >= .1 && animation.duration <= 10;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function revealProgress(animation: TextAnimation | undefined, time: number, start: number, end: number) {
  if (!animation || animation.effect === 'none' || end <= start) return 1;
  return Math.max(0, Math.min(1, (time - start) / Math.min(animation.duration, (end - start) * .6)));
}
export function lineRevealOpacity(progress: number, index: number, count: number) {
  const span = 1 / (1 + Math.max(0, count - 1) * .55);
  const local = Math.max(0, Math.min(1, (progress - index * span * .55) / span));
  return local * local * (3 - 2 * local);
}
export function lineWipeProgress(widths: number[], index: number, progress: number) {
  if (progress >= 1 - 1e-9) return 1;
  const total = widths.reduce((sum, width) => sum + width, 0);
  const before = widths.slice(0, index).reduce((sum, width) => sum + width, 0);
  return Math.max(0, Math.min(1, (progress * total - before) / Math.max(1, widths[index])));
}
// Work from the fully wrapped lines so reveals never change the text layout.
// Continuous Arabic wipes and line fades draw the complete shaped text.
export function animatedLines(lines: string[], animation: TextAnimation | undefined, time: number, start: number, end: number, arabic = false): string[] {
  if (!animation || animation.effect === 'none' || end <= start) return lines;
  if (animation.effect === 'line-reveal' || (animation.effect === 'typewriter' && arabic)) return lines;
  const progress = revealProgress(animation, time, start, end);
  if (progress >= 1 - 1e-9) return lines;
  const units = lines.map(line => animation.effect === 'word-reveal' || arabic
    ? Array.from(line.matchAll(/\S+\s*/gu), match => match[0])
    : Array.from(graphemes.segment(line), segment => segment.segment));
  let remaining = Math.floor(progress * units.reduce((sum, line) => sum + line.length, 0));
  return units.map(line => { const visible = line.slice(0, Math.max(0, remaining)).join(''); remaining -= line.length; return visible.trimEnd(); });
}
