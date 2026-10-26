import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, WebMOutputFormat, canEncodeAudio } from 'mediabunny';
import { getExportCapabilities, EXPORT_BITRATE } from './export-capabilities';
import { exportDimensions, type ExportSize } from './export-settings';
import { mixAudio } from './audio';
import type { MediaAsset, Project } from './model';
import { drawProject, loadBackground, seekVideo } from './renderer';
import { ensureProjectFonts } from './fonts';

export async function exportVideo(project: Project, assets: MediaAsset[], format: 'mp4' | 'webm', onProgress: (progress: number) => void, signal: AbortSignal, size: ExportSize = 'original') {
  signal.throwIfAborted();
  const dimensions = exportDimensions(project.width, project.height, size);
  const capabilities = await getExportCapabilities({ ...dimensions, hasAudio: project.audio.length > 0 });
  signal.throwIfAborted();
  if (!capabilities[format]) throw new Error(format === 'mp4'
    ? 'This browser cannot encode H.264 video. Select WebM to export on this device.'
    : 'WebM export is unavailable for this project in this browser.');
  const videoCodec = format === 'mp4' ? 'avc' : capabilities.webmCodec!;
  const audioCodec = format === 'mp4' ? 'aac' : 'opus';
  if (project.audio.length && format === 'mp4' && !await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 })) {
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
  }
  if (project.audio.length && !await canEncodeAudio(audioCodec, { numberOfChannels: 2, sampleRate: 48000 })) {
    throw new Error(`${audioCodec.toUpperCase()} audio encoding is unavailable. ${format === 'mp4' ? 'Choose WebM to export with Opus audio.' : 'Try a current version of Chrome or Edge.'}`);
  }
  await ensureProjectFonts(project);
  const resources = await loadBackground(project, assets);
  const canvas = document.createElement('canvas'); canvas.width = dimensions.width; canvas.height = dimensions.height;
  canvas.getContext('2d')!.scale(dimensions.width / project.width, dimensions.height / project.height);
  const target = new BufferTarget();
  const output = new Output({ target, format: format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat() });
  const video = new CanvasSource(canvas, { codec: videoCodec, bitrate: EXPORT_BITRATE });
  output.addVideoTrack(video, { frameRate: 30 });
  const audio = project.audio.length ? new AudioBufferSource({ codec: audioCodec, bitrate: 192000 }) : undefined;
  if (audio) output.addAudioTrack(audio);
  try {
    signal.throwIfAborted();
    onProgress(.01);
    const mixed = await mixAudio(project, assets);
    signal.throwIfAborted();
    await output.start();
    // Feed audio and video concurrently; the muxer may apply cross-track backpressure.
    const addAudio = audio && mixed ? audio.add(mixed).then(() => audio.close()) : Promise.resolve();
    const addVideo = async () => {
      const frames = Math.ceil(project.duration * 30);
      for (let i = 0; i < frames; i++) {
        signal.throwIfAborted();
        const time = i / 30;
        if (resources.video) await seekVideo(resources.video, time);
        drawProject(canvas, project, time, resources);
        await video.add(time, Math.min(1 / 30, project.duration - time));
        if (i % 5 === 0) { onProgress(.05 + .92 * i / frames); await new Promise(resolve => setTimeout(resolve, 0)); }
      }
      video.close();
    };
    await Promise.all([addAudio, addVideo()]);
    signal.throwIfAborted(); await output.finalize(); onProgress(1);
    return new Blob([target.buffer!], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' });
  } catch (error) { if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel(); throw error; }
  finally { if (resources.video) { resources.video.pause(); resources.video.removeAttribute('src'); resources.video.load(); } }
}
