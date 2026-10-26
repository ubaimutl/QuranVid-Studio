import { audioGain, type AudioClip, type MediaAsset, type Project } from './model';
const decoded = new Map<string, AudioBuffer>();
export async function decodeAsset(asset: MediaAsset, context: BaseAudioContext) {
  const cached = decoded.get(asset.id);
  if (cached) return cached;
  const response = asset.blob ? null : await fetch(asset.url);
  if (response && !response.ok) throw new Error(`Could not load ${asset.name}`);
  const bytes = asset.blob ? await asset.blob.arrayBuffer() : await response!.arrayBuffer();
  const buffer = await context.decodeAudioData(bytes);
  decoded.set(asset.id, buffer); return buffer;
}
export function getPeaks(buffer: AudioBuffer, count = 360) {
  const data = buffer.getChannelData(0); const step = Math.max(1, Math.floor(data.length / count));
  return Array.from({ length: count }, (_, i) => {
    let peak = 0;
    for (let j = i * step; j < Math.min((i + 1) * step, data.length); j += 16) peak = Math.max(peak, Math.abs(data[j]));
    return peak;
  });
}
export function scheduleClip(context: BaseAudioContext, buffer: AudioBuffer, clip: AudioClip, from: number) {
  const local = Math.max(0, from - clip.start);
  const remaining = Math.min(clip.duration - local, buffer.duration - clip.offset - local);
  if (remaining <= 0) return;
  const source = context.createBufferSource(); source.buffer = buffer;
  const gain = context.createGain(); source.connect(gain); gain.connect(context.destination);
  const when = context.currentTime + Math.max(0, clip.start - from);
  gain.gain.setValueAtTime(audioGain(clip, local), when);
  const points = new Set([local, clip.duration, clip.fadeIn, clip.duration - clip.fadeOut]);
  for (const point of [...points].sort((a, b) => a - b)) {
    if (point > local && point <= clip.duration) gain.gain.linearRampToValueAtTime(audioGain(clip, Math.min(point, clip.duration - .000001)), when + point - local);
  }
  source.start(when, clip.offset + local, remaining);
  return source;
}
export async function mixAudio(project: Project, assets: MediaAsset[]) {
  if (!project.audio.length) return undefined;
  const context = new OfflineAudioContext(2, Math.ceil(project.duration * 48000), 48000);
  await Promise.all(project.audio.map(async clip => {
    const asset = assets.find(a => a.id === clip.assetId);
    if (!asset) throw new Error(`Audio is missing: ${clip.name}. Re-import the source file before exporting.`);
    scheduleClip(context, await decodeAsset(asset, context), clip, 0);
  }));
  return context.startRendering();
}
