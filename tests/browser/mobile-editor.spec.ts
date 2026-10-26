import { test, expect, type Page } from '@playwright/test';
import { createProject } from '../../lib/sample';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
async function ready(page: Page) {
  await page.goto('/'); await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Mobile editor tools' })).toBeVisible();
}
async function assertBounds(page: Page, landscape = false) {
  const bounds = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, canvas: rect('.video-canvas'), timeline: rect('.timeline'), nav: rect('.mobile-tools') };
  });
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
  expect(bounds.scrollHeight).toBeLessThanOrEqual(bounds.height);
  expect(bounds.canvas.top).toBeGreaterThanOrEqual(0);
  expect(bounds.canvas.bottom).toBeLessThanOrEqual(bounds.nav.top);
  expect(bounds.timeline.bottom).toBeLessThanOrEqual(bounds.nav.top);
  if (landscape) expect(bounds.canvas.right).toBeLessThanOrEqual(bounds.timeline.left);
  else expect(bounds.canvas.bottom).toBeLessThanOrEqual(bounds.timeline.top);
}

test('keeps the preview, tracks and bottom tools usable at small phone, tablet and landscape sizes', async ({ page }) => {
  await ready(page);
  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [768, 1024], [844, 390], [932, 430]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.locator('.mobile-tools').isVisible()).toBe(true);
    await assertBounds(page, width > height);
    await page.screenshot({ path: `/tmp/quranvid-mobile-editor-${width}x${height}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.timeline').evaluate(element => element.getBoundingClientRect().height)).toBe(240);
  await assertBounds(page);
});

test('opens and switches library sheets, edits verses and applies a template without duplicating the editor', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Quran', exact: true }).tap();
  let sheet = page.getByRole('dialog', { name: 'Quran tools', exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('From verse', { exact: true }).fill('2');
  await sheet.getByLabel('To verse', { exact: true }).fill('3');
  await sheet.getByRole('button', { name: 'Add verses to timeline', exact: true }).tap();
  await expect(page.locator('.verse-clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Templates', exact: true }).tap();
  sheet = page.getByRole('dialog', { name: 'Templates tools', exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Apply Charcoal template', exact: true }).tap();
  await expect(sheet).not.toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('.timeline')).toHaveCount(1);
  await expect.poll(() => page.locator('canvas').evaluate(canvas => [...(canvas as HTMLCanvasElement).getContext('2d')!.getImageData(5, 5, 1, 1).data].slice(0, 3))).toEqual([39, 39, 39]);
  await page.getByRole('button', { name: 'Edit selection', exact: true }).tap();
  sheet = page.getByRole('dialog', { name: 'Selection settings', exact: true });
  await expect(sheet.getByRole('checkbox', { name: 'Auto-fit text', exact: true })).toBeChecked();
  await page.screenshot({ path: '/tmp/quranvid-mobile-settings-sheet.png' });
  await sheet.getByRole('button', { name: 'Close Selection settings', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Edit selection', exact: true })).toBeFocused();
});

test('adds and edits text from a sheet, preserves it on reload and supports undo', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Text', exact: true }).tap();
  await page.getByRole('button', { name: 'Add a text layer', exact: true }).tap();
  const sheet = page.getByRole('dialog', { name: 'Selection settings', exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Text content', { exact: true }).fill('A quiet moment');
  await sheet.getByLabel('Font size', { exact: true }).fill('44');
  await sheet.getByLabel('Y position', { exact: true }).fill('72');
  await sheet.getByRole('button', { name: 'Typography', exact: true }).tap();
  await expect(sheet.getByLabel('Text content', { exact: true })).toBeHidden();
  await sheet.getByRole('button', { name: 'Typography', exact: true }).tap();
  await expect(sheet.getByLabel('Text content', { exact: true })).toHaveValue('A quiet moment');
  await sheet.getByRole('button', { name: 'Close Selection settings', exact: true }).tap();
  await page.getByRole('button', { name: 'Editor controls', exact: true }).tap();
  await page.getByRole('button', { name: 'Undo', exact: true }).tap();
  await page.getByRole('button', { name: 'Edit selection', exact: true }).tap();
  await expect(sheet.getByLabel('Y position', { exact: true })).toHaveValue('75');
  await expect(page.getByText('Saved on this device')).toBeAttached();
  await page.reload();
  await page.getByRole('button', { name: 'Edit selection', exact: true }).tap();
  await sheet.getByRole('button', { name: 'A quiet moment', exact: true }).tap();
  await expect(sheet.getByLabel('Text content', { exact: true })).toHaveValue('A quiet moment');
  await expect(sheet.getByLabel('Font size', { exact: true })).toHaveValue('44');
});

async function swipe(page: Page, x: number, y: number, dx: number) {
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 10; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 10, y }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

test('swipes the timeline without moving clips, then opts in to touch dragging and undoes the move', async ({ page }) => {
  await ready(page);
  const first = page.locator('.verse-clip').first();
  const style = await first.getAttribute('style');
  const rect = (await page.locator('.verse-clip').nth(1).boundingBox())!;
  await swipe(page, rect.x + 45, rect.y + 18, -100);
  await expect.poll(() => page.locator('.timeline-scroll').evaluate(element => element.scrollLeft)).toBeGreaterThan(20);
  await expect(first).toHaveAttribute('style', style!);
  // Wait for the native fling to finish before resetting scroll and tapping a toolbar control.
  let lastScroll = -1, stableScroll = 0;
  await expect.poll(async () => {
    const position = await page.locator('.timeline-scroll').evaluate(element => element.scrollLeft);
    stableScroll = position === lastScroll ? stableScroll + 1 : 0; lastScroll = position;
    return stableScroll;
  }, { intervals: [100] }).toBeGreaterThanOrEqual(3);
  await page.locator('.timeline-scroll').evaluate(element => { element.scrollLeft = 0; });
  await page.getByRole('button', { name: 'Move clips', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Move clips', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const clip = (await first.boundingBox())!;
  await swipe(page, clip.x + 35, clip.y + 18, 35);
  await expect(first).not.toHaveAttribute('style', style!);
  await page.getByRole('button', { name: 'Editor controls', exact: true }).tap();
  await page.getByRole('button', { name: 'Undo', exact: true }).tap();
  await expect(first).toHaveAttribute('style', style!);
});

test('selects a verse by touch and exposes precise timing, splitting and color controls', async ({ page }) => {
  await ready(page);
  await page.locator('.verse-clip').nth(1).tap();
  await page.getByRole('button', { name: 'Edit selection', exact: true }).tap();
  const sheet = page.getByRole('dialog', { name: 'Selection settings', exact: true });
  await expect(sheet.getByLabel('Verse start', { exact: true })).toHaveValue('6.09');
  await sheet.getByRole('button', { name: 'Split verse into parts', exact: true }).tap();
  const split = page.getByRole('dialog', { name: 'Split verse 1:2', exact: true });
  await expect(split).toBeVisible();
  expect(await split.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await sheet.getByRole('button', { name: 'Style Arabic text', exact: true }).tap();
  await sheet.getByRole('button', { name: 'Text color', exact: true }).tap();
  const picker = page.getByRole('dialog', { name: 'Text color picker', exact: true });
  await expect(picker).toBeVisible();
  const box = (await picker.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390); expect(box.y + box.height).toBeLessThanOrEqual(844);
  await picker.getByLabel('Hex color', { exact: true }).fill('#e6c98f');
  await picker.getByRole('button', { name: 'Close color picker', exact: true }).tap();
  await expect(sheet.getByRole('button', { name: 'Text color', exact: true })).toContainText('#e6c98f');
});


test('opens the export dialog and renders a video with recitation from the mobile workspace', async ({ page }) => {
  await ready(page);
  const project = createProject(); project.name = 'Mobile export'; project.width = 360; project.height = 640; project.duration = 1;
  project.verses = [{ ...project.verses[0], start: 0, end: 1 }];
  project.layers = project.layers.map(layer => ({ ...layer, end: 1, fontSize: layer.fontSize / 3 }));
  project.audio = project.audio.map(audio => ({ ...audio, duration: 1 }));
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'mobile.quranvid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ project, media: [] })) });
  await expect(page.getByLabel('Project name')).toHaveValue('Mobile export');
  await page.getByRole('button', { name: 'Export video', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Ready to share your vision?', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByLabel('Export format', { exact: true }).selectOption('mp4');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export MP4', exact: true }).tap();
  await (await download).saveAs('/tmp/quranvid-mobile-export.mp4');
  await expect(dialog.getByText(/Your video is ready/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to editing', exact: true }).tap();
  await assertBounds(page);
});

test('keeps the header compact and reveals controls only when requested', async ({ page }) => {
  await ready(page);
  const controls = page.getByRole('button', { name: 'Editor controls', exact: true });
  await expect(controls).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.canvas-toolbar')).toBeHidden();
  expect((await page.locator('.app-header').boundingBox())!.height).toBe(48);
  await controls.tap();
  await expect(controls).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Replace background', exact: true })).toBeVisible();
  await assertBounds(page);
  await controls.tap();
  await expect(page.locator('.canvas-toolbar')).toBeHidden();
  await page.screenshot({ path: '/tmp/quranvid-mobile-compact-header.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(controls).toBeHidden();
  await expect(page.locator('.canvas-toolbar')).toBeVisible();
});

test('provides an install manifest, native install action and a browser instructions fallback', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  await ready(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await page.getByRole('button', { name: 'Project menu', exact: true }).tap();
  await page.getByRole('button', { name: 'Install QuranVid', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Install QuranVid', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Add to Home Screen');
  await page.getByRole('button', { name: 'Close install instructions', exact: true }).tap();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { prompt: async () => { document.documentElement.dataset.installPrompted = 'true'; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    window.dispatchEvent(event);
  });
  await page.getByRole('button', { name: 'Project menu', exact: true }).tap();
  await page.getByRole('button', { name: 'Install QuranVid', exact: true }).tap();
  await expect(page.locator('html')).toHaveAttribute('data-install-prompted', 'true');
  await expect(dialog).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await page.getByRole('button', { name: 'Project menu', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Install QuranVid', exact: true })).toHaveCount(0);
});
