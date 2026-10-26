import { test, expect } from '@playwright/test';
import { createProject } from '../../lib/sample';

test('selects WebM when H.264 is unavailable, disables MP4 and exports a real VP9 video', async ({ page }) => {
  await page.addInitScript(() => {
    const native = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = config => config.codec.startsWith('avc') ? Promise.resolve({ supported: false, config }) : native(config);
  });
  const project = createProject();
  project.name = 'Browser-compatible export'; project.width = 360; project.height = 640; project.duration = 2; project.audio = [];
  project.layers = project.layers.map(layer => ({ ...layer, end: 2, fontSize: layer.fontSize / 3 }));
  project.verses = [{ ...project.verses[0], start: 0, end: 2 }];
  await page.goto('/');
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'compatible.quranvid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ project, media: [] })) });
  await expect(page.getByLabel('Project name')).toHaveValue(project.name);
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  await expect(page.getByLabel('Export format', { exact: true })).toHaveValue('webm');
  await expect(page.locator('option[value="mp4"]')).toHaveJSProperty('disabled', true);
  await expect(page.getByText('WebM is selected because this browser cannot encode H.264 video.', { exact: false })).toBeVisible();
  await expect(page.locator('option[value="webm"]')).toHaveText('WebM · VP9 + Opus');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export WEBM', exact: true }).click();
  await (await download).saveAs('/tmp/quranvid-compatible-export.webm');
  await expect(page.getByText(/Your video is ready/)).toBeVisible();
});

test('uses VP8 when VP9 is unavailable and reports completely unsupported encoders before exporting', async ({ page }) => {
  await page.addInitScript(() => {
    const native = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = config => config.codec.startsWith('avc') || config.codec.startsWith('vp09') ? Promise.resolve({ supported: false, config }) : native(config);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  await expect(page.getByLabel('Export format', { exact: true })).toHaveValue('webm');
  await expect(page.locator('option[value="webm"]')).toHaveText('WebM · VP8 + Opus');
  await expect(page.getByRole('button', { name: 'Export WEBM', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Close export dialog', exact: true }).click();
  await page.addInitScript(() => {
    VideoEncoder.isConfigSupported = config => Promise.resolve({ supported: false, config });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  await expect(page.getByText('This browser cannot encode video at this project’s settings.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export WEBM', exact: true })).toBeDisabled();
});

test('exports a smaller 720p MP4 while leaving the editable project at its original resolution', async ({ page }) => {
  const project = createProject(); project.name = '720p export'; project.duration = 1; project.audio = [];
  project.layers = project.layers.map(layer => ({ ...layer, end: 1 }));
  project.verses = [{ ...project.verses[0], start: 0, end: 1 }];
  await page.goto('/');
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: '720p.quranvid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ project, media: [] })) });
  await expect(page.getByLabel('Project name')).toHaveValue(project.name);
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  await page.getByLabel('Export resolution', { exact: true }).selectOption('720p');
  await expect(page.locator('.export-summary')).toContainText('720 × 1280');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MP4', exact: true }).click();
  await (await download).saveAs('/tmp/quranvid-720p-export.mp4');
  await page.getByRole('button', { name: 'Back to editing', exact: true }).click();
  await expect(page.locator('canvas')).toHaveAttribute('width', '1080');
  await expect(page.locator('canvas')).toHaveAttribute('height', '1920');
});
