import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { recipeFragment } from '../../lib/video-recipe';

const link = '/'+ recipeFragment({ chapter: 1, from: 2, to: 3, reciterId: 9001, background: 'dark-gray', name: 'Islam Sobhi reflection' });

// A quiet WAV with enough duration exercises range extraction without a network dependency.
function audioFixture() {
  const rate = 16000, samples = rate * 52, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) data.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 220 / rate) * 500), 44 + index * 2);
  return data;
}

test('imports Islam Sobhi locally with exact timings, retains credits and excludes incomplete surahs', async ({ page }) => {
  const audio: string[] = [], api: string[] = [], errors: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://cdn.mp3quran.net/**', route => { audio.push(route.request().url()); return route.fulfill({ body: audioFixture(), contentType: 'audio/wav' }); });
  await page.goto(link);
  const dialog = page.getByRole('dialog', { name: 'Open video recipe', exact: true });
  await expect(dialog.getByRole('button', { name: 'Prepare video', exact: true })).toBeEnabled();
  await expect(dialog).toContainText('Islam Sobhi'); expect(audio).toEqual([]);
  await dialog.getByRole('button', { name: 'Prepare video', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
  await expect(page.locator('.verse-card')).toHaveCount(2);
  expect(audio.length).toBeGreaterThan(0); expect(audio.every(url => url === 'https://cdn.mp3quran.net/audio/islam-sobhi/r1/001.mp3')).toBe(true);
  await page.getByTitle('Project menu').click();
  await page.getByRole('button', { name: 'Media credits', exact: true }).click();
  const credits = page.getByRole('dialog', { name: 'Media credits', exact: true });
  await expect(credits).toContainText('MP3Quran'); await expect(credits).toContainText('CC BY 4.0');
  await expect(credits.getByRole('link', { name: 'View timing source' })).toHaveAttribute('href', /v4\.0\.0$/);
  await credits.getByRole('button', { name: 'Close media credits' }).click();
  await page.reload();
  await expect(page.getByLabel('Project name')).toHaveValue('Islam Sobhi reflection');
  await page.getByTitle('Project menu').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project & media', exact: true }).click();
  const backup = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
  expect(backup.project.duration).toBeCloseTo(8.083);
  expect(backup.project.verses.map((verse: { key: string }) => verse.key)).toEqual(['1:2', '1:3']);
  expect(backup.project.verses[0].start).toBe(0);
  expect(backup.project.verses[1].start).toBeCloseTo(5.653);
  expect(backup.media[0].attribution.provider).toBe('MP3Quran');
  expect(backup.media[0].attribution.license).toBeUndefined();
  expect(backup.media[0].attribution.timing.license).toBe('CC BY 4.0');
  await page.getByLabel('From verse', { exact: true }).fill('2');
  await page.getByLabel('To verse', { exact: true }).fill('3');
  await page.getByLabel('Reciter', { exact: true }).selectOption('9001');
  await page.getByRole('button', { name: 'Add verses & recitation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add verses & recitation', exact: true })).toBeEnabled();
  await expect(page.locator('.audio-clip')).toContainText('Islam Sobhi');
  await expect(page.locator('.verse-card')).toHaveCount(2);
  await page.goto('/' + recipeFragment({ chapter: 109, from: 1, to: 6, reciterId: 9001 }));
  await expect(dialog.getByRole('alert')).toContainText('unavailable');
  await expect(dialog.getByRole('button', { name: 'Prepare video', exact: true })).toBeDisabled();
  expect(api).toEqual([]); expect(errors).toEqual([]);
});

test('prepares and exports actual MP3Quran audio directly in the browser', async ({ page }) => {
  test.skip(!process.env.QURANVID_TEST_LIVE_RECITATION, 'Opt-in live CDN and browser encoder check');
  const responses: { status: number; bytes: string | undefined }[] = [], api: string[] = [], errors: string[] = [];
  page.on('response', response => { if (response.url().startsWith('https://cdn.mp3quran.net/')) responses.push({ status: response.status(), bytes: response.headers()['content-length'] }); });
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(link);
  const dialog = page.getByRole('dialog', { name: 'Open video recipe', exact: true });
  await expect(dialog.getByRole('button', { name: 'Prepare video', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Prepare video', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 60000 });
  await expect(page.locator('.audio-clip')).toContainText('Islam Sobhi');
  expect(responses.some(response => response.status === 200 || response.status === 206)).toBe(true);
  await page.screenshot({ path: '/tmp/quranvid-islam-sobhi-editor.png' });
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  const exported = page.waitForEvent('download', { timeout: 120000 });
  await page.getByRole('button', { name: 'Export MP4', exact: true }).click();
  await (await exported).saveAs('/tmp/quranvid-islam-sobhi.mp4');
  expect(api).toEqual([]); expect(errors).toEqual([]);
  console.log('MP3Quran direct browser responses', responses);
});
