export type ExportSize = 'original' | '720p';
export function exportDimensions(width: number, height: number, size: ExportSize) {
  const scale = size === '720p' ? Math.min(1, 720 / Math.min(width, height)) : 1;
  return scale === 1 ? { width, height } : { width: Math.max(2, Math.round(width * scale / 2) * 2), height: Math.max(2, Math.round(height * scale / 2) * 2) };
}
