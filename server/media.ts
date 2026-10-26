import { createWriteStream } from 'node:fs';
import { chmod, open, rm, rename, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { MediaAttribution } from '../lib/model';
import { ApiError, Store, type StoredAsset } from './store';
import type { ServerConfig } from './config';
import { publicJson, publicResponse } from './network';

const run = promisify(execFile);
export type ImportRequest = { url: string; type: StoredAsset['type']; name?: string; start?: number; end?: number; attribution?: MediaAttribution };
export type SearchResult = { id: string; type: 'image' | 'audio'; title: string; creator?: string; url: string; previewUrl?: string; sourceUrl: string; license: string; licenseUrl?: string; provider: 'openverse'; duration?: number };
export class MediaService {
  private active = 0;
  constructor(public store: Store, public config: ServerConfig, private requestJson: typeof publicJson = publicJson) {}
  async search(type: 'image' | 'audio', query: string, limit = 8): Promise<SearchResult[]> {
    const url = new URL(`https://api.openverse.org/v1/${type === 'image' ? 'images' : 'audio'}/`);
    url.searchParams.set('q', query); url.searchParams.set('page_size', String(limit)); url.searchParams.set('mature', 'false');
    url.searchParams.set('license', 'cc0,pdm,by,by-sa');
    const data = await this.requestJson(url.href, this.config.openverseToken ? { Authorization: `Bearer ${this.config.openverseToken}` } : {});
    if (!Array.isArray(data.results)) throw new ApiError(502, 'Openverse did not return search results.');
    return data.results.map((item: Record<string, unknown>) => this.result(type, item));
  }
  private result(type: 'image' | 'audio', item: Record<string, unknown>): SearchResult {
    return { id: String(item.id), type, title: String(item.title || 'Untitled media'), creator: typeof item.creator === 'string' ? item.creator : undefined,
      url: String(item.url), previewUrl: typeof item.thumbnail === 'string' ? item.thumbnail : undefined,
      sourceUrl: String(item.foreign_landing_url || item.url), license: String(item.license ?? 'unknown'),
      licenseUrl: typeof item.license_url === 'string' ? item.license_url : undefined, provider: 'openverse',
      duration: typeof item.duration === 'number' ? item.duration / 1000 : undefined };
  }
  async importOpenverse(type: 'image' | 'audio', id: string, start?: number, end?: number) {
    const data = await this.requestJson(`https://api.openverse.org/v1/${type === 'image' ? 'images' : 'audio'}/${id}/`, this.config.openverseToken ? { Authorization: `Bearer ${this.config.openverseToken}` } : {});
    const result = this.result(type, data);
    if (data.mature === true) throw new ApiError(400, 'This media is marked as mature.');
    return this.importUrl({ url: result.url, type, name: result.title, start, end, attribution: { title: result.title, creator: result.creator,
      sourceUrl: result.sourceUrl, license: result.license, licenseUrl: result.licenseUrl, provider: 'Openverse' } });
  }
  async importUrl(request: ImportRequest) {
    return this.ingest(request.type, request.name, request.attribution ?? { title: request.name ?? 'Imported media', sourceUrl: new URL(request.url).origin + new URL(request.url).pathname }, async filename => {
      const response = await publicResponse(request.url);
      if (Number(response.headers['content-length']) > this.config.maxAssetBytes) { response.destroy(); throw new ApiError(413, 'This media exceeds the download size limit.'); }
      await this.copyLimited(response, filename);
    }, request.start, request.end);
  }
  async upload(source: NodeJS.ReadableStream, type: StoredAsset['type'], name?: string) {
    return this.ingest(type, name, undefined, filename => this.copyLimited(source, filename));
  }
  private async copyLimited(source: NodeJS.ReadableStream, filename: string) {
    let bytes = 0;
    const maximum = this.config.maxAssetBytes;
    const limiter = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length; callback(bytes > maximum ? new ApiError(413, 'This media exceeds the file size limit.') : null, chunk);
    } });
    await pipeline(source, limiter, createWriteStream(filename, { mode: 0o600, flags: 'wx' }));
  }
  private async probe(filename: string) {
    try {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height', '-of', 'json', filename], { timeout: 20000, maxBuffer: 1024 ** 2 });
      return JSON.parse(stdout) as { format: { duration?: string; format_name: string }; streams: { codec_type: string; codec_name: string; width?: number; height?: number }[] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiError(503, 'Install FFmpeg and ffprobe on the companion server to import media.');
      throw new ApiError(400, 'This file is not a readable image, video or audio recording.');
    }
  }
  private async ingest(type: StoredAsset['type'], name: string | undefined, attribution: MediaAttribution | undefined, download: (file: string) => Promise<void>, start?: number, end?: number) {
    if (this.active >= 3) throw new ApiError(429, 'Three media imports are already running. Try again shortly.');
    this.active++;
    const id = randomUUID(), temporary = this.store.file('files', `${id}-download`), output = this.store.file('files', id);
    try {
      await download(temporary);
      const handle = await open(temporary, 'r'); const magic = Buffer.alloc(16);
      try { await handle.read(magic, 0, 16, 0); } finally { await handle.close(); }
      const image = magic.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'image/jpeg'
        : magic.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
        : magic.toString('ascii', 0, 3) === 'GIF' ? 'image/gif'
        : magic.toString('ascii', 0, 4) === 'RIFF' && magic.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp'
        : magic.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(magic.toString('ascii', 8, 16)) ? 'image/avif' : undefined;
      const binaryContainer = image || magic.toString('ascii', 0, 3) === 'ID3' || (magic[0] === 255 && (magic[1] & 224) === 224)
        || ['fLaC', 'OggS'].includes(magic.toString('ascii', 0, 4))
        || (magic.toString('ascii', 0, 4) === 'RIFF' && magic.toString('ascii', 8, 12) === 'WAVE')
        || magic.toString('ascii', 4, 8) === 'ftyp' || magic.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
      if (!binaryContainer) throw new ApiError(400, 'Use a media file, not a webpage, playlist or document.');
      const probe = await this.probe(temporary);
      const duration = Number(probe.format.duration);
      const video = probe.streams.find(stream => stream.codec_type === 'video');
      if (video && (!video.width || !video.height || video.width > 16384 || video.height > 16384 || video.width * video.height > 80000000)) throw new ApiError(400, 'Media dimensions exceed the supported limit.');
      const audio = probe.streams.find(stream => stream.codec_type === 'audio');
      if (type === 'image' ? !image || !video : image || (type === 'audio' ? !audio : !video) || !Number.isFinite(duration) || duration <= 0) throw new ApiError(400, 'The file contents do not match the requested media type. SVG and HTML are not supported.');
      const format = probe.format.format_name;
      let mime = image ?? (format.includes('mp3') ? 'audio/mpeg' : format.includes('wav') ? 'audio/wav' : format.includes('flac') ? 'audio/flac' : format.includes('ogg') ? (video ? 'video/ogg' : 'audio/ogg') : format.includes('webm') || format.includes('matroska') ? (video ? 'video/webm' : 'audio/webm') : format.includes('mov') || format.includes('mp4') ? (video ? 'video/mp4' : 'audio/mp4') : '');
      if (!mime) throw new ApiError(400, 'Use a standard JPEG, PNG, WebP, GIF, AVIF, MP3, WAV, FLAC, Ogg, MP4 or WebM file.');
      let storedDuration = type === 'image' ? undefined : duration;
      if (start !== undefined || end !== undefined) {
        if (type !== 'audio' || start === undefined || end === undefined || start < 0 || end <= start || end - start > 600 || end > duration + .2) throw new ApiError(400, 'Audio extraction requires a valid start/end range up to 10 minutes.');
        try { await run('ffmpeg', ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', temporary, '-ss', String(start), '-t', String(end - start), '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', output], { timeout: 120000, maxBuffer: 1024 ** 2 }); }
        catch { throw new ApiError(400, 'The selected audio range could not be extracted.'); }
        mime = 'audio/mpeg'; storedDuration = Number((await this.probe(output)).format.duration);
      } else await rename(temporary, output);
      await chmod(output, 0o600);
      const bytes = (await stat(output)).size;
      const asset: StoredAsset = { id, name: (name || `Imported ${type}`).slice(0, 200), type, mime, filename: id, bytes, duration: storedDuration,
        width: video?.width, height: video?.height, attribution, createdAt: new Date().toISOString() };
      await this.store.exclusive(async () => {
        const stored = await this.store.list<StoredAsset>('assets');
        if (stored.length >= 1000) throw new ApiError(507, 'The server media file limit has been reached.');
        const total = stored.reduce((sum, item) => sum + item.bytes, 0);
        if (total + bytes > this.config.maxStorageBytes) throw new ApiError(507, 'The server media storage limit has been reached.');
        await this.store.put('assets', id, asset);
      });
      return asset;
    } catch (error) {
      await rm(output, { force: true });
      if (error instanceof ApiError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') throw new ApiError(507, 'The server has no free disk space.');
      throw new ApiError(502, 'The media transfer failed or timed out. Retry, choose another source, or upload the file.');
    }
    finally { this.active--; await rm(temporary, { force: true }); }
  }
}
