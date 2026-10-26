import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

function wav(seconds: number) {
  const rate = 16000, samples = Math.ceil(rate * seconds), data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  return data;
}

test('offers production voices for Al-Hijr, imports Yasser and reuses downloaded audio', async ({ page }) => {
  const recording = JSON.parse(readFileSync('public/data/recitations/174/15.json', 'utf8'));
  const audio: string[] = [], errors: string[] = [], api: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url());
    if (request.url().startsWith('https://download.quranicaudio.com/')) audio.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  if (!process.env.QURANVID_TEST_LIVE_RECITATION) await page.route('https://download.quranicaudio.com/**', route => route.fulfill({ body: wav(recording.timings[1].end + 1), contentType: 'audio/wav' }));
  await page.goto('/');
  await page.locator('.chapter-select').click(); await page.getByLabel('Search chapters').fill('Hijr');
  await page.locator('.chapter-results button').click();
  const reciter = page.getByLabel('Reciter', { exact: true });
  for (const id of [6, 7, 159, 174, 9001]) await expect(reciter.locator(`option[value="${id}"]`)).toBeEnabled();
  await expect(page.locator('.audio-clip')).toHaveCount(1); expect(audio).toEqual([]);
  await page.getByLabel('To verse', { exact: true }).fill('2'); await reciter.selectOption('174');
  await page.getByRole('button', { name: 'Add verses & recitation', exact: true }).click();
  await expect(page.locator('.audio-clip')).toContainText('Yasser', { timeout: 60000 });
  await expect(page.locator('.audio-clip')).toHaveCount(1); await expect(page.locator('.verse-card')).toHaveCount(2);
  expect(audio.length).toBeGreaterThan(0); expect(audio.every(url => url === recording.audioUrl)).toBe(true);
  const requests = audio.length;
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.getByRole('button', { name: 'Audio', exact: true }).click(); await reciter.selectOption('174');
  await page.getByRole('button', { name: 'Add verses & recitation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add verses & recitation', exact: true })).toBeEnabled();
  expect(audio.length).toBe(requests);
  await expect(page.getByText('Saved on this device')).toBeVisible(); await page.getByTitle('Project menu').click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download project & media', exact: true }).click();
  const backup = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
  expect(backup.project.verses.map((verse: { key: string }) => verse.key)).toEqual(['15:1', '15:2']);
  expect(backup.project.duration).toBeCloseTo(recording.timings[1].end - recording.timings[0].start);
  expect(backup.project.audio).toHaveLength(1); expect(backup.media[0].attribution.provider).toBe('Quran Foundation');
  await page.getByRole('button', { name: 'Quran', exact: true }).click();
  await page.screenshot({ path: '/tmp/quranvid-production-reciter-options.png' });
  expect(api).toEqual([]); expect(errors).toEqual([]);
});
