import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type * as z from 'zod/v4';
import { createProject } from '../lib/sample';
import { resizeProject, validateProject, type Chapter, type Project, type Verse } from '../lib/model';
import { recitationAttribution, selectRecitationRange, type RecitationCatalog, type TimedRecitation } from '../lib/recitations';
import { mergeVerseParts, splitVerse } from '../lib/verse-split';
import { ApiError, Store, type Handoff, type StoredAsset, type StoredProject } from './store';
import type { ServerConfig } from './config';
import { MediaService } from './media';
import type { createInput, editInput } from './schemas';
import { applyVideoTemplate, backgroundForChoice, RECIPE_BACKGROUNDS, SOLID_BACKGROUNDS, VIDEO_TEMPLATES } from '../lib/templates';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function referencedAssets(project: Project) { return [...new Set([...project.audio.map(a => a.assetId), ...(['image', 'video'].includes(project.background.type) && !project.background.source.startsWith('/') ? [project.background.source] : [])])]; }
export class ProjectService {
  constructor(public store: Store, public config: ServerConfig, public media: MediaService, public verses: Verse[], public chapters: Chapter[], public recitations: RecitationCatalog) {}
  static async initialize(store: Store, config: ServerConfig, media: MediaService) {
    const data = await Promise.all(['quran.json', 'chapters.json', 'recitations/catalog.json'].map(file => readFile(path.join(config.root, 'public/data', file), 'utf8').then(JSON.parse)));
    return new ProjectService(store, config, media, data[0], data[1], data[2]);
  }
  catalog() { return { chapters: this.chapters, recitations: this.recitations, backgrounds: RECIPE_BACKGROUNDS, solidColors: SOLID_BACKGROUNDS,
    customColor: { field: 'backgroundColor', format: '#RRGGBB', example: '#272727', notes: 'Custom hex and named solid backgrounds are static and need no image import.' },
    templates: VIDEO_TEMPLATES.map(template => ({ id: template.id, name: template.name, description: template.subtitle, background: template.background })),
    limits: { projectSeconds: 600, versesPerCreation: 100, partsPerVerse: 16 }, notes: 'Reciters are available only for chapters listed in their catalog entry. Without a reciter, timings are estimates and no recording is added.' }; }
  async get(id: string) { return this.store.get<StoredProject>('projects', id); }
  async list() { return (await this.store.list<StoredProject>('projects')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, revision, project, createdAt, updatedAt }) => ({ id, revision, name: project.name, createdAt, updatedAt })); }
  async assets(project: Project) { return Promise.all(referencedAssets(project).map(id => this.store.get<StoredAsset>('assets', id))); }
  async create(input: z.infer<typeof createInput>) {
    const chapter = this.chapters.find(c => c.id === input.chapter)!;
    if (input.to < input.from || input.to > chapter.count || input.to - input.from >= 100) throw new ApiError(400, 'Choose 1–100 valid verses within the selected surah.');
    const selected = this.verses.filter(v => { const [c, n] = v.key.split(':').map(Number); return c === input.chapter && n >= input.from && n <= input.to; });
    let project = createProject(); project.id = randomUUID(); project.name = input.name ?? `${chapter.name} ${input.from}–${input.to}`; project.audio = [];
    const formats = { portrait: [1080, 1920], square: [1080, 1080], landscape: [1920, 1080], post: [1080, 1350] };
    [project.width, project.height] = formats[input.format];
    const duration = input.duration ?? Math.min(600, selected.length * 6);
    project.duration = duration; project.verses = selected.map((v, i) => ({ ...v, id: randomUUID(), start: i * duration / selected.length, end: (i + 1) * duration / selected.length }));
    if (input.reciterId !== undefined) {
      const reciter = this.recitations.reciters.find(r => r.id === input.reciterId && r.chapters.includes(input.chapter));
      if (!reciter) throw new ApiError(400, 'That reciter/chapter combination is unavailable. Use get_catalog for available recordings.');
      const recording: TimedRecitation = JSON.parse(await readFile(path.join(this.config.root, 'public/data/recitations', String(reciter.id), `${input.chapter}.json`), 'utf8'));
      const range = selectRecitationRange(recording, selected, input.chapter, input.from, input.to);
      const asset = await this.media.importUrl({ url: recording.audioUrl, type: 'audio', name: `${chapter.name} ${input.from}–${input.to} · ${reciter.name}`, start: range.start, end: range.end,
        attribution: recitationAttribution(reciter, `${chapter.name} ${input.from}–${input.to}`) });
      project.duration = range.end - range.start; project.verses = range.clips;
      project.audio = [{ id: randomUUID(), assetId: asset.id, name: asset.name, start: 0, offset: 0, duration: project.duration, sourceDuration: asset.duration!, volume: 1, fadeIn: 0, fadeOut: 0, recitation: true }];
    }
    if (input.template) project = applyVideoTemplate(project, input.template);
    project.layers = project.layers.map(layer => ({ ...layer, end: project.duration,
      ...(layer.id === 'title' ? { text: chapter.name } : {}),
      ...(layer.kind === 'arabic' && input.arabicFont ? { fontFamily: input.arabicFont } : {}),
      ...(layer.kind === 'translation' && input.translationFont ? { fontFamily: input.translationFont } : {}) }));
    if (input.background !== undefined || input.backgroundColor !== undefined || !input.template) project.background = backgroundForChoice(input.background ?? 'mountains', project.duration, input.backgroundColor);
    if (input.backgroundAssetId) { const asset = await this.store.get<StoredAsset>('assets', input.backgroundAssetId); if (asset.type === 'audio') throw new ApiError(400, 'Choose an image or video for the background.'); project.background = { ...project.background, type: asset.type, source: asset.id, name: asset.name }; }
    await this.validate(project);
    return this.store.exclusive(async () => {
      if ((await this.list()).length >= 1000) throw new ApiError(507, 'The server project limit has been reached.');
      const now = new Date().toISOString(); const record = { id: project.id, revision: 1, project, createdAt: now, updatedAt: now };
      await this.store.put('projects', record.id, record); return record;
    });
  }
  async edit(input: z.infer<typeof editInput>) {
    return this.store.exclusive(async () => {
      const record = await this.get(input.projectId);
      if (record.revision !== input.expectedRevision) throw new ApiError(409, 'This project changed. Read it again and retry with its latest revision.');
      let project = structuredClone(record.project);
      for (const key of ['name', 'width', 'height', 'showReference', 'autoFitText'] as const) if (input[key] !== undefined) Object.assign(project, { [key]: input[key] });
      if (input.showReference !== undefined) project.layers = project.layers.map(layer => layer.kind === 'reference' ? { ...layer, visible: input.showReference! } : layer);
      if (input.background) project.background = { ...project.background, ...input.background };
      for (const { id, patch } of input.layers ?? []) {
        const layer = project.layers.find(l => l.id === id); if (!layer) throw new ApiError(400, `Unknown layer: ${id}`);
        if (patch.text !== undefined && layer.kind !== 'text') throw new ApiError(400, 'Canonical verse text cannot be changed through a layer edit.');
        if ((layer.kind === 'arabic' || layer.kind === 'translation') && (patch.x !== undefined || patch.y !== undefined) && input.autoFitText !== true) project.autoFitText = false;
        Object.assign(layer, patch); if (layer.kind === 'reference' && patch.visible !== undefined) project.showReference = patch.visible;
      }
      for (const patch of input.addText ?? []) project.layers.push({ id: randomUUID(), kind: 'text', name: patch.name ?? patch.text.slice(0, 30), x: 50, y: 75, width: 80, fontSize: 38, color: '#ffffff', align: 'center', opacity: 1, visible: true, start: 0, end: project.duration, ...patch });
      if (input.audio) project.audio = await Promise.all(input.audio.map(async clip => {
        const asset = await this.store.get<StoredAsset>('assets', clip.assetId); if (asset.type !== 'audio' || !asset.duration) throw new ApiError(400, 'Audio clips must reference imported audio assets.');
        return { ...clip, id: clip.id ?? randomUUID(), name: clip.name ?? asset.name, sourceDuration: asset.duration };
      }));
      for (const timing of input.verseTimings ?? []) { const verse = project.verses.find(v => v.id === timing.id); if (!verse) throw new ApiError(400, 'Unknown verse clip.'); Object.assign(verse, { start: timing.start, end: timing.end }); }
      if (input.splitVerse) { const split = input.splitVerse; project = splitVerse(project, split.id, split.breaks, split.times, split.translations); }
      if (input.mergeVerseId) project = mergeVerseParts(project, input.mergeVerseId);
      const contentEnd = Math.max(1, ...project.verses.map(v => v.end), ...project.audio.map(a => a.start + a.duration));
      project = resizeProject(project, input.duration ?? Math.max(project.duration, contentEnd));
      await this.validate(project);
      const next = { ...record, project, revision: record.revision + 1, updatedAt: new Date().toISOString() };
      await this.store.put('projects', next.id, next); return next;
    });
  }
  async validate(project: Project) {
    const ids = [...project.layers, ...project.verses, ...project.audio].map(item => item.id);
    if (new Set(ids).size !== ids.length) throw new ApiError(400, 'Every project clip and layer must have a unique ID.');
    if (!validateProject(project) || project.layers.some(l => l.end > project.duration) || project.verses.some(v => v.end > project.duration) || project.audio.some(a => a.start + a.duration > project.duration)) throw new ApiError(400, 'Project settings or clip timings are invalid.');
    for (const verse of project.verses) {
      const canonical = this.verses.find(v => v.key === verse.key);
      if (!canonical || (verse.part ? verse.part.arabic !== canonical.arabic || verse.part.translation !== canonical.translation : verse.arabic !== canonical.arabic || verse.translation !== canonical.translation)) throw new ApiError(400, 'Verse text must match the verified Quran dataset.');
    }
    const assets = await this.assets(project);
    if (project.audio.some(clip => assets.find(a => a.id === clip.assetId)?.type !== 'audio')) throw new ApiError(400, 'Missing audio asset.');
    const bg = project.background;
    if (bg.type === 'color' ? !/^#[\da-f]{6}$/i.test(bg.source) : !['/backgrounds/mountains.jpg', '/backgrounds/forest.jpg', '/backgrounds/coast.jpg'].includes(bg.source) && !assets.some(a => a.id === bg.source && a.type === bg.type)) throw new ApiError(400, 'Use a bundled background, an imported media ID, or a hex color.');
  }
  async createLink(id: string, hours: number) {
    const project = await this.get(id); const token = randomBytes(32).toString('base64url');
    const record: Handoff = { id: tokenHash(token), project, assetIds: referencedAssets(project.project), expiresAt: Date.now() + hours * 3600000 };
    await this.store.put('handoffs', record.id, record);
    return { url: `${this.config.publicUrl.origin}/#draft=${token}`, expiresAt: new Date(record.expiresAt).toISOString(), linkId: record.id,
      note: 'This link grants access only to this project revision and its media. Opening it creates a local editable copy; server edits require an authenticated API/MCP call.' };
  }
  async handoff(token: string) {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new ApiError(404, 'Project link not found.');
    const handoff = await this.store.get<Handoff>('handoffs', tokenHash(token));
    if (handoff.expiresAt < Date.now()) throw new ApiError(410, 'This project link has expired. Ask for a new link.');
    return handoff;
  }
}
