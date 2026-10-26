import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { encodeRecipe, recipeFragment } from '../../lib/video-recipe';

const recipe = { chapter: 1, from: 2, to: 3, name: 'Forest reflection', background: 'forest', translationFont: 'serif' };
const link = (input: unknown = recipe) => `/?utm_source=chatgpt.com${recipeFragment(input)}`;

test('opens old valid base64 links and rejects a corrupted ChatGPT link before downloading audio', async ({ page }) => {
  await page.goto(`/#recipe=${encodeRecipe(recipe)}`);
  const dialog = page.getByRole('dialog', { name: 'Open video recipe', exact: true });
  await expect(dialog.getByRole('button', { name: 'Prepare video', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  // A valid base64 alphabet can still contain damaged UTF-8/JSON. Never guess
  // missing settings or silently change the Quran range to repair such a link.
  const corrupt = readFileSync('tests/fixtures/damaged-recipe.txt', 'utf8').trim();
  await page.goto(`/?utm_source=chatgpt.com#recipe=${corrupt}`);
  await expect(dialog.getByRole('alert')).toContainText('invalid');
  await expect(dialog.getByRole('button', { name: 'Prepare video', exact: true })).toBeDisabled();
});

test('reviews a recipe, prepares locally, exports and preserves the previous project', async ({ page }) => {
  const api: string[] = [], errors: string[] = []; let audioRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://download.quranicaudio.com/**', route => { audioRequests++; return route.fulfill({ path: 'public/audio/al-fatihah-alafasy.mp3', contentType: 'audio/mpeg' }); });
  await page.goto('/');
  await page.getByLabel('Project name').fill('Keep my original');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.goto(link());
  const dialog = page.getByRole('dialog', { name: 'Open video recipe', exact: true });
  await expect(dialog.getByRole('button', { name: 'Prepare video', exact: true })).toBeEnabled();
  await expect(dialog).toContainText('verses 2–3');
  expect(audioRequests).toBe(0);
  await expect(page.getByLabel('Project name')).toHaveValue('Keep my original');
  await dialog.getByRole('button', { name: 'Prepare video', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel('Project name')).toHaveValue('Forest reflection');
  expect(new URL(page.url()).hash).toBe(''); expect(audioRequests).toBeGreaterThan(0);
  await expect(page.locator('.verse-card')).toHaveCount(2);
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Project name')).toHaveValue('Forest reflection');
  await expect(page.locator('.audio-clip')).toContainText('1:2–3');
  await page.getByTitle('Project menu').click();
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project & media', exact: true }).click();
  const backup = JSON.parse(readFileSync((await (await backupDownload).path())!, 'utf8'));
  expect(backup.project.duration).toBeCloseTo(10.21);
  expect(backup.project.verses.map((verse: { key: string }) => verse.key)).toEqual(['1:2', '1:3']);
  expect(backup.project.verses[0].start).toBe(0);
  expect(backup.project.layers.find((layer: { kind: string }) => layer.kind === 'translation').fontFamily).toBe('serif');
  expect(backup.media).toHaveLength(1); expect(backup.media[0].data).toMatch(/^data:audio\/wav;base64,/);
  expect(backup.media[0].attribution.provider).toBe('Quran Foundation');
  await page.screenshot({ path: '/tmp/quranvid-recipe-editor.png' });
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  const exported = page.waitForEvent('download', { timeout: 120000 });
  await page.getByRole('button', { name: 'Export MP4', exact: true }).click();
  await (await exported).saveAs('/tmp/quranvid-public-recipe.mp4');
  await page.getByRole('button', { name: 'Back to editing', exact: true }).click();
  await page.getByTitle('Project menu').click();
  await page.getByRole('button', { name: 'Saved projects', exact: true }).click();
  await page.getByRole('dialog', { name: 'Saved projects' }).getByRole('button', { name: /Keep my original/ }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Keep my original');
  expect(api).toEqual([]); expect(errors).toEqual([]);
});

test('rejects malformed and unavailable recipes without changing the current project', async ({ page }) => {
  for (const [index, hash] of ['#recipe=', '#recipe=invalid', '#recipe=' + 'a'.repeat(12001), recipeFragment({ ...recipe, chapter: 109, from: 1, to: 6, reciterId: 9001 })].entries()) await test.step(`Invalid recipe ${index + 1}`, async () => {
    await page.goto('/' + hash);
    const dialog = page.getByRole('dialog', { name: 'Open video recipe', exact: true });
    await expect(dialog.getByRole('alert'), `Recipe ${index + 1}: ${page.url().slice(0,100)}`).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Prepare video', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByLabel('Project name')).toHaveValue('Al-Fatihah · A moment of reflection');
  });
});

test('can retry a failed download and cancel preparation without replacing the project', async ({ page }) => {
  await page.route('https://download.quranicaudio.com/**', route => route.abort('failed'));
  await page.goto(link());
  const dialog = page.getByRole('dialog', { name: 'Open video recipe', exact: true });
  await dialog.getByRole('button', { name: 'Prepare video', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 30000 });
  await expect(dialog.getByRole('button', { name: 'Prepare video', exact: true })).toBeEnabled();
  await page.unroute('https://download.quranicaudio.com/**');
  let requested!: () => void;
  const request = new Promise<void>(resolve => { requested = resolve; });
  await page.route('https://download.quranicaudio.com/**', async route => { requested(); await new Promise(resolve => setTimeout(resolve, 1000)); await route.abort().catch(() => {}); });
  await dialog.getByRole('button', { name: 'Prepare video', exact: true }).click();
  await request;
  await dialog.getByRole('button', { name: 'Cancel preparation', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('Project name')).toHaveValue('Al-Fatihah · A moment of reflection');
  await page.reload();
  await expect(page.getByLabel('Project name')).toHaveValue('Al-Fatihah · A moment of reflection');
});
