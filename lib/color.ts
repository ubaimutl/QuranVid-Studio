export type HSV = { h: number; s: number; v: number };
export function normalizeHex(value: string): string | null {
  const hex = value.trim().replace(/^#/, '');
  return /^[\da-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : /^[\da-f]{3}$/i.test(hex) ? `#${[...hex].map(c => c + c).join('').toLowerCase()}` : null;
}
export function hexToHsv(hex: string): HSV {
  const normalized = normalizeHex(hex) ?? '#ffffff';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(normalized.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const h = !delta ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: h * 60, s: max ? delta / max : 0, v: max };
}
export function hsvToHex({ h, s, v }: HSV) {
  const chroma = v * s, x = chroma * (1 - Math.abs(((h % 360) / 60) % 2 - 1)), m = v - chroma;
  const rgb = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${rgb.map(c => Math.round((c + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}
