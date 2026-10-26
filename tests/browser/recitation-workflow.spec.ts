import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

function wav(seconds = 4) {
  const rate = 16000, samples = Math.ceil(rate * seconds), data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  return data;
}
async function chooseChapter(page: Page, name: string) {
  await page.locator('.chapter-select').click();
  await page.getByLabel('Search chapters').fill(name);
  await page.locator('.chapter-results button').click();
}
async function importAlafasy(page: Page) {
  await page.getByLabel('From verse', { exact: true }).fill('2');
  await page.getByLabel('To verse', { exact: true }).fill('3');
  await page.getByLabel('Reciter', { exact: true }).selectOption('7');
  await page.getByRole('button', { name: 'Add verses & recitation', exact: true }).click();
  await expect(page.locator('.audio-clip').filter({ hasText: '1:2–3' })).toHaveCount(1);
}
async function backup(page: Page) {
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.getByTitle('Project menu').click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project & media', exact: true }).click();
  return JSON.parse(readFileSync((await (await downloaded).path())!, 'utf8'));
}

test('replaces verses and their imported recitation, preserves other audio, and can undo or choose another reciter', async ({ page }) => {
  // Exercise sparse coverage independently of the production catalog growing.
  const catalog = JSON.parse(readFileSync('public/data/recitations/catalog.json', 'utf8'));
  const limited = { ...catalog, reciters: catalog.reciters.filter((r: { id: number }) => [6, 7, 12, 173, 9001].includes(r.id))
    .map((r: { id: number; chapters: number[] }) => r.id === 9001 ? r : { ...r, chapters: r.chapters.filter(chapter => chapter <= 2 && (r.id !== 173 || chapter === 2)) }) };
  await page.route('**/data/recitations/catalog.json', route => route.fulfill({ json: limited }));
  await page.route('https://download.quranicaudio.com/**', route => route.fulfill({ path: 'public/audio/al-fatihah-alafasy.mp3', contentType: 'audio/mpeg' }));
  const recording = JSON.parse(readFileSync('public/data/recitations/9001/15.json', 'utf8'));
  await page.route('https://cdn.mp3quran.net/**', route => route.fulfill({ body: wav(recording.timings[1].end + 1), contentType: 'audio/wav' }));
  await page.goto('/');
  await importAlafasy(page);
  await page.locator('input[type=file]').first().setInputFiles({ name: 'ambience.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(page.locator('.audio-clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Quran', exact: true }).click();
  await chooseChapter(page, 'Hijr');
  // Browsing surahs must not edit the existing timeline.
  await expect(page.locator('.audio-clip')).toHaveCount(2);
  await page.getByLabel('To verse', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Add verses to timeline', exact: true }).click();
  await expect(page.locator('.verse-card').first()).toContainText('15:1');
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await expect(page.locator('.audio-clip')).toContainText('ambience.wav');
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  await expect(page.locator('.verse-card').first()).toContainText('1:2');
  await expect(page.locator('.audio-clip')).toHaveCount(2);
  await page.getByTitle('Redo (Ctrl+Shift+Z)', { exact: true }).click();
  await expect(page.locator('.verse-card').first()).toContainText('15:1');
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  const reciter = page.getByLabel('Reciter', { exact: true });
  await expect(reciter).toHaveValue('9001');
  await expect(reciter.locator('option:enabled')).toHaveCount(1);
  await expect(reciter.locator('option:disabled')).toHaveCount(4);
  await expect(page.getByText('1 reciter available for Al-Hijr.', { exact: false })).toBeVisible();
  await page.screenshot({ path: '/tmp/quranvid-reciter-workflow-local.png' });
  await page.getByRole('button', { name: 'Add verses & recitation', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(2);
  await expect(page.locator('.audio-clip').filter({ hasText: 'Islam Sobhi' })).toHaveCount(1);
  const imported = await backup(page);
  expect(imported.project.audio.filter((clip: { recitation?: boolean }) => clip.recitation)).toHaveLength(1);
  expect(imported.project.audio.some((clip: { name: string }) => clip.name === 'ambience.wav')).toBe(true);
  await chooseChapter(page, 'Fatihah');
  await expect(reciter.locator('option:enabled')).toHaveCount(4);
  await importAlafasy(page);
  await expect(page.locator('.audio-clip')).toHaveCount(2);
  await expect(page.locator('.audio-clip').filter({ hasText: 'Islam Sobhi' })).toHaveCount(0);
  await expect(page.locator('.audio-clip').filter({ hasText: 'ambience.wav' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Add verses to timeline', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await expect(page.locator('.audio-clip')).toContainText('ambience.wav');
});

test('changing a surah cancels an old recitation import before it can overwrite the new verses', async ({ page }) => {
  let release!: () => void, requested!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const request = new Promise<void>(resolve => { requested = resolve; });
  await page.route('https://download.quranicaudio.com/**', async route => {
    requested(); await pending;
    await route.fulfill({ path: 'public/audio/al-fatihah-alafasy.mp3', contentType: 'audio/mpeg' }).catch(() => {});
  });
  await page.goto('/');
  await page.getByLabel('From verse', { exact: true }).fill('2');
  await page.getByLabel('To verse', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Add verses & recitation', exact: true }).click();
  await request;
  await chooseChapter(page, 'Hijr');
  await page.getByRole('button', { name: 'Add verses to timeline', exact: true }).click();
  release();
  await expect(page.getByRole('button', { name: 'Add verses & recitation', exact: true })).toBeEnabled();
  await expect(page.locator('.verse-card').first()).toContainText('15:1');
  await expect(page.locator('.audio-clip')).toHaveCount(0);
  const saved = await backup(page);
  expect(saved.project.verses.every((verse: { key: string }) => verse.key.startsWith('15:'))).toBe(true);
  expect(saved.project.audio).toHaveLength(0);
});
