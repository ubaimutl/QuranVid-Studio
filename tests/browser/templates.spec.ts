import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { VIDEO_TEMPLATES } from '../../lib/templates';
import { recipeFragment } from '../../lib/video-recipe';

async function backup(page: Page) {
  await page.getByTitle('Project menu').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project & media', exact: true }).click();
  return JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
}
async function corner(page: Page) {
  return page.locator('canvas').evaluate(canvas => [...(canvas as HTMLCanvasElement).getContext('2d')!.getImageData(5, 5, 1, 1).data].slice(0, 3));
}
test('applies all ten templates, supports undo and custom solid colors, and preserves audio and verse timings', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  const original = await backup(page);
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(page.locator('.template-card')).toHaveCount(10);
  await page.screenshot({ path: '/tmp/quranvid-templates-gallery.png' });
  for (const template of VIDEO_TEMPLATES) {
    await page.getByRole('button', { name: `Apply ${template.name} template`, exact: true }).click();
    await expect(page.locator('.audio-clip')).toHaveCount(1);
  }
  await page.getByRole('button', { name: 'Apply Ivory template', exact: true }).click();
  await expect.poll(() => corner(page)).toEqual([245, 241, 232]);
  await page.getByRole('button', { name: 'Apply Charcoal template', exact: true }).click();
  await expect.poll(() => corner(page)).toEqual([39, 39, 39]);
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect.poll(() => corner(page)).toEqual([245, 241, 232]);
  await page.getByTitle('Redo (Ctrl+Shift+Z)').click();
  await expect.poll(() => corner(page)).toEqual([39, 39, 39]);
  await expect(page.getByLabel('Background motion', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Background color', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Background color picker', exact: true });
  await picker.getByLabel('Hex color', { exact: true }).fill('#313131');
  await picker.getByRole('button', { name: 'Close color picker', exact: true }).click();
  await expect.poll(() => corner(page)).toEqual([49, 49, 49]);
  const changed = await backup(page);
  expect(changed.project.verses).toEqual(original.project.verses); expect(changed.project.audio).toEqual(original.project.audio);
  expect(changed.project.duration).toBe(original.project.duration);
  expect(changed.project.background).toMatchObject({ type: 'color', source: '#313131', dim: 0, motion: 'none', motionRepeat: false });
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await expect.poll(() => corner(page)).toEqual([49, 49, 49]);
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await page.getByRole('button', { name: 'Use dark gray background', exact: true }).click();
  await expect.poll(() => corner(page)).toEqual([39, 39, 39]);
});

test('prepares a public Charcoal recipe as a static color and exports it with audio', async ({ page }) => {
  await page.route('https://download.quranicaudio.com/**', route => route.fulfill({ path: 'public/audio/al-fatihah-alafasy.mp3', contentType: 'audio/mpeg' }));
  const fragment = recipeFragment({ chapter: 1, from: 2, to: 3, template: 'charcoal', name: 'Dark gray reflection' });
  await page.goto('/' + fragment);
  const dialog = page.getByRole('dialog', { name: 'Open video recipe', exact: true });
  await expect(dialog).toContainText('Dark gray background · Charcoal style');
  await dialog.getByRole('button', { name: 'Prepare video', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
  await expect.poll(() => corner(page)).toEqual([39, 39, 39]);
  const ruler = await page.locator('.time-ruler').boundingBox();
  await page.mouse.click(ruler!.x + 32, ruler!.y + ruler!.height / 2);
  await expect.poll(() => corner(page)).toEqual([39, 39, 39]);
  const saved = await backup(page);
  expect(saved.project.background).toMatchObject({ type: 'color', source: '#272727', dim: 0, motion: 'none' });
  expect(saved.project.verses.map((verse: { key: string }) => verse.key)).toEqual(['1:2', '1:3']);
  expect(saved.project.duration).toBeCloseTo(10.21); expect(saved.media).toHaveLength(1);
  await page.screenshot({ path: '/tmp/quranvid-charcoal-editor.png' });
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.getByRole('button', { name: 'Export MP4', exact: true }).click();
  await (await download).saveAs('/tmp/quranvid-charcoal.mp4');
});
