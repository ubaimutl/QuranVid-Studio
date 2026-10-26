import { ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, BufferTarget, Input, Mp3OutputFormat, Output, UrlSource, canEncodeAudio, type InputAudioTrack } from 'mediabunny';

export type AudioSourceInfo = { input: Input; track: InputAudioTrack; duration: number; first: number };
export function parseTimecode(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length > 3 || parts.some((p, i) => !(i === parts.length - 1 ? /^\d+(\.\d+)?$/ : /^\d+$/).test(p))) return null;
  const values = parts.map(Number);
  if (values.some((v, i) => !Number.isFinite(v) || (i > 0 && v >= 60))) return null;
  return values.reduce((total, value) => total * 60 + value, 0);
}
export async function openAudioSource(source: Blob | string): Promise<AudioSourceInfo> {
  const input = new Input({ source: typeof source === 'string' ? new UrlSource(source, { requestInit: { credentials: 'omit' } }) : new BlobSource(source), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('This file has no audio track. Choose a recording or a video with sound.');
    if (!await track.canDecode()) throw new Error('This browser cannot decode the audio in this file. Try MP3, WAV, or a video with AAC audio.');
    const first = await input.getFirstTimestamp([track]);
    const duration = await input.computeDuration([track]) - first;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('The recording has no readable duration.');
    return { input, track, duration, first };
  } catch (error) { input.dispose(); throw error; }
}
export async function sourcePeaks(source: AudioSourceInfo, signal: AbortSignal, count = 240) {
  const sink = new AudioBufferSink(source.track);
  const positions = Array.from({ length: count }, (_, i) => source.first + i * source.duration / count);
  const peaks: number[] = [];
  for await (const chunk of sink.buffersAtTimestamps(positions)) {
    signal.throwIfAborted();
    let peak = 0;
    if (chunk) { const data = chunk.buffer.getChannelData(0); for (let i = 0; i < data.length; i += 8) peak = Math.max(peak, Math.abs(data[i])); }
    peaks.push(peak);
  }
  return peaks;
}
export async function readAudioRange(source: AudioSourceInfo, start: number, end: number, signal: AbortSignal, progress: (p: number) => void = () => {}) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start >= source.duration || end > source.duration + .15) throw new Error('Choose a valid range within the recording.');
  if (end - start > 600) throw new Error('Choose a clip up to 10 minutes long.');
  const from = source.first + start, to = source.first + end;
  const sink = new AudioBufferSink(source.track);
  let result: AudioBuffer | undefined, last = from;
  for await (const chunk of sink.buffers(from, Math.min(to, source.first + source.duration))) {
    signal.throwIfAborted();
    const buffer = chunk.buffer;
    if (!result) result = new AudioBuffer({ numberOfChannels: Math.min(2, buffer.numberOfChannels), length: Math.ceil((end - start) * buffer.sampleRate), sampleRate: buffer.sampleRate });
    const rate = result.sampleRate;
    const sourceStart = Math.max(0, Math.round((from - chunk.timestamp) * rate));
    const destinationStart = Math.max(0, Math.round((chunk.timestamp - from) * rate));
    const length = Math.min(buffer.length - sourceStart, result.length - destinationStart);
    if (length > 0) for (let channel = 0; channel < result.numberOfChannels; channel++) result.getChannelData(channel).set(buffer.getChannelData(channel).subarray(sourceStart, sourceStart + length), destinationStart);
    last = Math.max(last, chunk.timestamp + chunk.duration);
    progress(Math.min(1, (last - from) / (to - from)));
  }
  if (!result || last < to - .15) throw new Error('The selected audio could not be read completely. Try a different range or recording.');
  signal.throwIfAborted(); progress(1); return result;
}
export function encodeWav(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels, length = buffer.length;
  const data = new ArrayBuffer(44 + length * channels * 2), view = new DataView(data);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length * channels * 2, true);
  const samples = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  for (let i = 0; i < length; i++) for (let c = 0; c < channels; c++) { const value = Math.min(1, Math.max(-1, samples[c][i])); view.setInt16(44 + (i * channels + c) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); }
  return new Blob([data], { type: 'audio/wav' });
}
export async function encodeMp3(buffer: AudioBuffer, signal: AbortSignal) {
  if (!await canEncodeAudio('mp3')) { const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder'); registerMp3Encoder(); }
  signal.throwIfAborted();
  const target = new BufferTarget();
  const output = new Output({ target, format: new Mp3OutputFormat() });
  const audio = new AudioBufferSource({ codec: 'mp3', bitrate: 192000 });
  output.addAudioTrack(audio);
  const cancel = () => { void output.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try { await output.start(); await audio.add(buffer); audio.close(); signal.throwIfAborted(); await output.finalize(); return new Blob([target.buffer!], { type: 'audio/mpeg' }); }
  catch (error) { if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); }
}
