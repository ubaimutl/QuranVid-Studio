import { canEncodeAudio, canEncodeVideo } from 'mediabunny';

export type ExportCapabilities = { mp4: boolean; webm: boolean; webmCodec: 'vp8' | 'vp9' | null };
export const EXPORT_BITRATE = 6e6;
export async function getExportCapabilities(project: { width: number; height: number; hasAudio: boolean }): Promise<ExportCapabilities> {
  const config = { width: project.width, height: project.height, bitrate: EXPORT_BITRATE };
  const [mp4, vp8, vp9, opus] = await Promise.all([
    canEncodeVideo('avc', config), canEncodeVideo('vp8', config), canEncodeVideo('vp9', config),
    project.hasAudio ? canEncodeAudio('opus', { numberOfChannels: 2, sampleRate: 48000 }) : Promise.resolve(true),
  ]);
  // Keep VP9 as the preferred WebM codec; use VP8 only when VP9 is unavailable.
  const webmCodec = vp9 ? 'vp9' : vp8 ? 'vp8' : null;
  return { mp4, webm: !!webmCodec && opus, webmCodec };
}
