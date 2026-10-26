import { mkdir, readFile, writeFile, copyFile, readdir, access, mkdtemp, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { normalizeRecording } from './recitation-data.mjs';
import { REQUIRED_CONTENT } from './content-files.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const option = (args, name) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const cleanText = text => text.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '').replace(/<[^>]*>/g, '')
  .replace(/&#(?:x([\da-f]+)|(\d+));/gi, (_, hex, decimal) => String.fromCodePoint(parseInt(hex || decimal, hex ? 16 : 10)))
  .replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, entity) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[entity]);

export async function validateContent(root) {
  const read = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
  const [chapters, verses, sample, catalog, recording] = await Promise.all(['public/data/chapters.json', 'public/data/quran.json', 'lib/sample-data.json', 'public/data/recitations/catalog.json', 'public/data/recitations/7/1.json'].map(read));
  if (chapters.length !== 114 || chapters.some((chapter, index) => chapter.id !== index + 1 || !Number.isInteger(chapter.count) || chapter.count < 1 || chapter.count > 286) || chapters.reduce((sum, chapter) => sum + chapter.count, 0) !== 6236) throw new Error('Expected all 114 chapters and 6,236 verses.');
  const keys = chapters.flatMap(chapter => Array.from({ length: chapter.count }, (_, index) => `${chapter.id}:${index + 1}`));
  if (verses.length !== keys.length || verses.some((verse, index) => verse.key !== keys[index] || typeof verse.arabic !== 'string' || !verse.arabic.trim() || typeof verse.translation !== 'string')) throw new Error('Invalid Quran text pack: text, translations or verse order do not match.');
  if (sample.length !== 7 || sample.some((verse, index) => verse.key !== `1:${index + 1}` || verse.arabic !== verses[index].arabic || verse.translation !== verses[index].translation || !Number.isFinite(verse.start) || verse.end <= verse.start || (index && verse.start < sample[index - 1].end))) throw new Error('Sample verses must match the text pack and have ordered, positive timings.');
  if (Math.abs(sample.at(-1).end - 46.49) > .001) throw new Error('The current starter project requires the 46.49-second Al-Fatihah timing version.');
  if (catalog.version !== 1 || !catalog.reciters?.some(reciter => reciter.id === 7 && reciter.chapters.includes(1))) throw new Error('The starter recording is missing from the catalog.');
  if (recording.reciterId !== 7 || recording.chapter !== 1 || recording.timings?.length !== 7 || recording.timings.some((timing, index) => timing.key !== sample[index].key || timing.start !== sample[index].start || timing.end !== sample[index].end)) throw new Error('Sample timing metadata does not match the starter project.');
  const url = new URL(recording.audioUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search) throw new Error('Use a public HTTPS recording URL without credentials or query tokens.');
  const audio = await readFile(path.join(root, 'public/audio/al-fatihah-alafasy.mp3'));
  if (audio.length < 1000 || !(audio.subarray(0, 3).toString() === 'ID3' || (audio[0] === 255 && (audio[1] & 224) === 224))) throw new Error('The starter audio is not an MP3 file.');
}
async function copyPack(from, to) {
  for (const name of REQUIRED_CONTENT) { if ((await lstat(path.join(from, name))).isSymbolicLink()) throw new Error('Content packs must not contain symlinks.'); await mkdir(path.dirname(path.join(to, name)), { recursive: true }); await copyFile(path.join(from, name), path.join(to, name)); }
  const copyRecordings = async (source, dest) => {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Content packs must not contain symlinks.');
      if (entry.isDirectory() && /^\d+$/.test(entry.name)) { await mkdir(path.join(dest, entry.name), { recursive: true }); await copyRecordings(path.join(source, entry.name), path.join(dest, entry.name)); }
      else if (entry.isFile() && /^(?:catalog|\d+)\.json$/.test(entry.name)) await copyFile(path.join(source, entry.name), path.join(dest, entry.name));
    }
  };
  await copyRecordings(path.join(from, 'public/data/recitations'), path.join(to, 'public/data/recitations'));
}
async function request(url, json = true) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45000), credentials: 'omit' });
  if (!response.ok) throw new Error(`Content provider returned HTTP ${response.status}. No files were installed.`);
  return json ? response.json() : Buffer.from(await response.arrayBuffer());
}
export async function downloadPack(to, api = 'https://api.quran.com/api/v4', recordingFetch = request) {
  const [chapterResponse, arabicResponse, translationResponse, audioResponse] = await Promise.all([
    request(`${api}/chapters?language=en`), request(`${api}/quran/verses/uthmani`),
    request(`${api}/quran/translations/20`), request(`${api}/chapter_recitations/7/1?segments=true`),
  ]);
  const chapters = chapterResponse.chapters.map(chapter => ({ id: chapter.id, name: chapter.name_simple, arabic: chapter.name_arabic, count: chapter.verses_count }));
  const translations = translationResponse.translations;
  if (translations.length !== arabicResponse.verses.length) throw new Error('Translation coverage differs from the Arabic source.');
  const verses = arabicResponse.verses.map((verse, index) => {
    const translation = translations[index];
    if (translation.verse_key && translation.verse_key !== verse.verse_key) throw new Error('Translation verse order differs from the Arabic source.');
    return { key: verse.verse_key, arabic: verse.text_uthmani, translation: cleanText(translation.text) };
  });
  const recording = normalizeRecording(audioResponse.audio_file, 7, 1, 7);
  const audio = await recordingFetch(recording.audioUrl, false);
  const sample = recording.timings.map((timing, index) => ({ ...verses[index], id: `verse-${index}`, start: timing.start, end: timing.end }));
  const catalog = { version: 1, generatedAt: new Date().toISOString(), environment: 'starter', reciters: [{ id: 7, name: 'Mishary Rashid Alafasy', style: 'Murattal', chapters: [1] }] };
  for (const [name, data] of Object.entries({ 'public/data/chapters.json': chapters, 'public/data/quran.json': verses, 'public/data/recitations/catalog.json': catalog, 'public/data/recitations/7/1.json': recording, 'lib/sample-data.json': sample })) {
    await mkdir(path.dirname(path.join(to, name)), { recursive: true }); await writeFile(path.join(to, name), JSON.stringify(data));
  }
  await mkdir(path.join(to, 'public/audio'), { recursive: true }); await writeFile(path.join(to, 'public/audio/al-fatihah-alafasy.mp3'), audio);
  await writeFile(path.join(to, 'public/data/content-provenance.json'), JSON.stringify({ preparedAt: new Date().toISOString(), api, translation: 'Saheeh International (resource 20)', audioUrl: recording.audioUrl, codeLicenseDoesNotCoverContent: true }, null, 2));
}
export async function prepareContent(args, root = ROOT) {
  const from = option(args, 'from');
  if ((!from && !args.includes('--download')) || (from && args.includes('--download'))) throw new Error('Choose --from=/path/to/permitted-content or --download. See docs/CONTENT-SETUP.md for provider terms and setup.');
  if (!args.includes('--force')) {
    let exists = false; for (const name of REQUIRED_CONTENT) { try { await access(path.join(root, name)); exists = true; } catch {} }
    if (exists) throw new Error('Content already exists. It was preserved. Use --force only to deliberately replace it.');
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'quranvid-content-'));
  try {
    if (from) await copyPack(path.resolve(from), temporary); else await downloadPack(temporary);
    await validateContent(temporary);
    await copyPack(temporary, root);
    try { await copyFile(path.join(temporary, 'public/data/content-provenance.json'), path.join(root, 'public/data/content-provenance.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    console.log('Prepared local content. These files remain excluded from the public source release. Review provider terms before redistributing or hosting them.');
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await prepareContent(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Content preparation failed.'); process.exitCode = 1; }
}
