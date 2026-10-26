import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { excludedFromPublicSource } from '../scripts/content-files.mjs';
import { exportPublicSource } from '../scripts/export-public-source.mjs';
import { prepareContent, downloadPack } from '../scripts/prepare-content.mjs';
import { missingContent } from '../scripts/check-content.mjs';
import http from 'node:http';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
async function fixture(fn) { const dir = await mkdtemp(path.join(os.tmpdir(), 'quranvid-release-test-')); try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); } }
async function file(root, name, value) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); }
async function pack(root) {
  const chapters = Array.from({ length: 114 }, (_, i) => ({ id: i + 1, count: i === 0 ? 7 : i === 113 ? 69 : 55, name: 'Test fixture', arabic: 'fixture' }));
  const verses = chapters.flatMap(c => Array.from({ length: c.count }, (_, i) => ({ key: `${c.id}:${i + 1}`, arabic: 'fixture text', translation: 'test-only translation' })));
  const timings = verses.slice(0, 7).map((v, i) => ({ key: v.key, start: i * 6, end: i === 6 ? 46.49 : (i + 1) * 6 }));
  const recording = { version: 1, reciterId: 7, chapter: 1, audioUrl: 'https://example.com/audio.mp3', timings };
  for (const [name, data] of Object.entries({ 'public/data/chapters.json': chapters, 'public/data/quran.json': verses, 'public/data/recitations/catalog.json': { version: 1, reciters: [{ id: 7, chapters: [1] }] }, 'public/data/recitations/7/1.json': recording, 'lib/sample-data.json': timings.map((t, i) => ({ ...verses[i], ...t, id: String(i) })) })) await file(root, name, data);
  await file(root, 'public/audio/al-fatihah-alafasy.mp3', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(1000)]));
  return { chapters, verses, recording };
}
test('release boundary excludes sensitive content and keeps original license notices', () => {
  for (const name of ['.env', '.env.production', '.private/HOSTING.md', '.git/config', 'public/data/quran.json', 'public/data/recitations/7/1.json', 'lib/sample-data.json', 'public/audio/test.mp3', 'test-results/project.zip']) assert.equal(excludedFromPublicSource(name), true, name);
  for (const name of ['.env.example', 'LICENSE', 'public/fonts/Amiri-LICENSE.txt', 'public/data/SOURCES.md', 'public/audio/SOURCES.md', 'public/licenses/dependencies.json']) assert.equal(excludedFromPublicSource(name), false, name);
});
test('export never copies prepared assets, credentials or Git history and refuses overwrites', () => fixture(async dir => {
  const source = path.join(dir, 'source'), output = path.join(dir, 'output');
  for (const name of ['LICENSE', '.env', '.env.example', '.git/config', '.private/notes', 'lib/sample-data.json', 'public/data/quran.json', 'public/data/recitations/7/1.json', 'public/audio/sample.mp3', 'public/fonts/Amiri-LICENSE.txt']) await file(source, name, 'fixture');
  await exportPublicSource(output, source);
  for (const name of ['.env', '.git', '.private', 'lib/sample-data.json', 'public/data/quran.json', 'public/audio/sample.mp3']) await assert.rejects(access(path.join(output, name)));
  assert.equal(await readFile(path.join(output, 'LICENSE'), 'utf8'), 'fixture');
  assert.equal(await readFile(path.join(output, '.env.example'), 'utf8'), 'fixture');
  await assert.rejects(exportPublicSource(output, source), /already exists/);
  await assert.rejects(exportPublicSource(path.join(source, 'inside'), source), /outside/);
}));
test('a content import installs only validated content and preserves existing content by default', () => fixture(async dir => {
  const source = path.join(dir, 'source'), target = path.join(dir, 'target'); await pack(source);
  await file(source, '.env', 'NEVER_COPY=private');
  await mkdir(target); assert.ok((await missingContent(target)).length > 0);
  await prepareContent([`--from=${source}`], target);
  assert.deepEqual(await missingContent(target), []);
  await assert.rejects(access(path.join(target, '.env')));
  await assert.rejects(prepareContent([`--from=${source}`], target), /preserved/);
  await prepareContent([`--from=${source}`, '--force'], target);
}));
test('an invalid staged content pack leaves the existing installation unchanged', () => fixture(async dir => {
  const source = path.join(dir, 'source'), target = path.join(dir, 'target'); await pack(source); await pack(target);
  const before = await readFile(path.join(target, 'public/data/quran.json'));
  await file(source, 'public/data/quran.json', []);
  await assert.rejects(prepareContent([`--from=${source}`, '--force'], target), /Invalid Quran/);
  assert.deepEqual(await readFile(path.join(target, 'public/data/quran.json')), before);
}));
test('explicit downloads pair ordered Arabic, translation and recording data without leaking HTML footnotes', () => fixture(async dir => {
  const source = path.join(dir, 'source'), output = path.join(dir, 'output'); const data = await pack(source);
  const audio = await readFile(path.join(source, 'public/audio/al-fatihah-alafasy.mp3'));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const payload = req.url.startsWith('/chapters') ? { chapters: data.chapters.map(c => ({ id: c.id, name_simple: c.name, name_arabic: c.arabic, verses_count: c.count })) }
      : req.url.includes('/uthmani') ? { verses: data.verses.map(v => ({ verse_key: v.key, text_uthmani: v.arabic })) }
      : req.url.includes('/translations') ? { translations: data.verses.map(v => ({ verse_key: v.key, text: '<sup foot_note="1">1</sup>' + v.translation + ' &amp; more' })) }
      : { audio_file: { chapter_id: 1, audio_url: data.recording.audioUrl, timestamps: data.recording.timings.map(t => ({ verse_key: t.key, timestamp_from: t.start * 1000, timestamp_to: t.end * 1000 })) } };
    res.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await downloadPack(output, `http://127.0.0.1:${server.address().port}`, async () => audio); }
  finally { await new Promise(resolve => server.close(resolve)); }
  const verses = JSON.parse(await readFile(path.join(output, 'public/data/quran.json'), 'utf8'));
  assert.equal(verses[0].translation, 'test-only translation & more');
  assert.equal(JSON.parse(await readFile(path.join(output, 'public/data/recitations/catalog.json'), 'utf8')).environment, 'starter');
}));
test('audit detects excluded content in history even after a later deletion', () => fixture(async dir => {
  const git = args => execFileSync('git', ['-c', 'user.name=Release test', '-c', 'user.email=release-test@example.invalid', ...args], { cwd: dir, stdio: 'pipe' });
  git(['init', '-b', 'main']); await file(dir, 'lib/sample-data.json', 'historically excluded content'); git(['add', '.']); git(['commit', '-m', 'Fixture content']);
  git(['rm', 'lib/sample-data.json']); git(['commit', '-m', 'Delete fixture']);
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/audit-public-source.mjs')], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /History: excluded path lib\/sample-data.json/);
}));
test('audit masks known credential matches and succeeds after removal in a new history', () => fixture(async dir => {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  const secret = 'fixture-credential-never-log-this-value'; const env = path.join(dir, '.env'); await file(dir, '.gitignore', '.env\n'); await file(dir, '.env', `QF_CLIENT_SECRET=${secret}\n`); await file(dir, 'README.md', secret);
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/audit-public-source.mjs'), `--secrets-from=${env}`], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /possible credential/); assert.ok(!result.stderr.includes(secret));
  await file(dir, 'README.md', 'Safe source');
  const clean = spawnSync(process.execPath, [path.join(ROOT, 'scripts/audit-public-source.mjs'), `--secrets-from=${env}`], { cwd: dir, encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr);
}));
