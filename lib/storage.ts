import { openDB } from 'idb';
import type { MediaAsset, Project } from './model';
const database = () => openDB('quranvid-studio', 1, {
  upgrade(db) { db.createObjectStore('projects'); db.createObjectStore('assets', { keyPath: 'id' }); },
});
export async function saveProject(project: Project) {
  const db = await database();
  const transaction = db.transaction('projects', 'readwrite');
  await transaction.store.put(project, project.id);
  await transaction.store.put(project, 'current');
  await transaction.done;
}
export async function loadSavedProjects(): Promise<Project[]> {
  const records: Project[] = await (await database()).getAll('projects');
  return [...new Map(records.map(project => [project.id, project])).values()];
}
export async function savePreparedProject(previous: Project, project: Project, assets: MediaAsset[]) {
  const db = await database();
  const transaction = db.transaction(['projects', 'assets'], 'readwrite');
  await transaction.objectStore('projects').put(previous, previous.id);
  for (const { url: _url, ...asset } of assets) await transaction.objectStore('assets').put(asset);
  await transaction.objectStore('projects').put(project, project.id);
  await transaction.objectStore('projects').put(project, 'current');
  await transaction.done;
}
export async function loadProject(): Promise<Project | undefined> {
  return (await database()).get('projects', 'current');
}
export async function storeAsset(asset: MediaAsset) {
  const { url: _url, ...data } = asset;
  await (await database()).put('assets', data);
}
export async function loadAssets(): Promise<MediaAsset[]> {
  const records = await (await database()).getAll('assets');
  return records.filter(a => a.blob instanceof Blob).map(a => ({ ...a, url: URL.createObjectURL(a.blob) }));
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
