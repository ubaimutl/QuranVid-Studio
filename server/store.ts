import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project, MediaAttribution } from '../lib/model';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type StoredAsset = { id: string; name: string; type: 'image' | 'video' | 'audio'; mime: string; filename: string;
  bytes: number; duration?: number; width?: number; height?: number; attribution?: MediaAttribution; createdAt: string };
export type StoredProject = { id: string; revision: number; project: Project; createdAt: string; updatedAt: string };
export type Handoff = { id: string; project: StoredProject; assetIds: string[]; expiresAt: number };
export class Store {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(public directory: string) {}
  async initialize() { for (const name of ['projects', 'assets', 'handoffs', 'oauth', 'files']) await mkdir(path.join(this.directory, name), { recursive: true, mode: 0o700 }); }
  file(bucket: string, id: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !['projects', 'assets', 'handoffs', 'oauth', 'files'].includes(bucket)) throw new ApiError(400, 'Invalid record identifier.');
    return path.join(this.directory, bucket, `${id}${bucket === 'files' ? '' : '.json'}`);
  }
  async get<T>(bucket: string, id: string): Promise<T> {
    try { return JSON.parse(await readFile(this.file(bucket, id), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiError(404, 'Record not found.'); throw error; }
  }
  async put(bucket: string, id: string, record: unknown) {
    const filename = this.file(bucket, id), temporary = `${filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 }); await rename(temporary, filename);
  }
  async list<T>(bucket: string): Promise<T[]> {
    const files = (await readdir(path.join(this.directory, bucket))).filter(file => file.endsWith('.json'));
    return Promise.all(files.map(file => this.get<T>(bucket, file.slice(0, -5))));
  }
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task); this.queue = result.catch(() => undefined); return result;
  }
}
