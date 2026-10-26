import { test, expect } from '@playwright/test';
import { createProject } from '../../lib/sample';
import { splitVerse } from '../../lib/verse-split';
import { readFileSync } from 'node:fs';

test('imports a reciter range with matching verse timings and keeps the audio after reload', async ({ page }) => {
  await page.route('https://download.quranicaudio.com/**', route => route.fulfill({ path: 'public/audio/al-fatihah-alafasy.mp3', contentType: 'audio/mpeg' }));
  await page.goto('/');
  await page.getByLabel('From verse', { exact: true }).fill('2');
  await page.getByLabel('To verse', { exact: true }).fill('3');
  await page.getByLabel('Reciter', { exact: true }).selectOption('7');
  await page.getByRole('button', { name: 'Add verses & recitation', exact: true }).click();
  await expect(page.locator('.verse-card')).toHaveCount(2, { timeout: 20000 });
  await expect(page.locator('.verse-card').first()).toContainText('1:2');
  await expect(page.getByLabel('Verse start', { exact: true })).toHaveValue('0');
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await expect(page.locator('.audio-clip')).toContainText('1:2–3');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await expect(page.locator('.verse-card')).toHaveCount(2);
  await expect(page.locator('.audio-clip')).toContainText('1:2–3');
});

for (const kind of ['audio', 'video'] as const) test(`extracts a local ${kind} range to MP3 and adds the same range to the timeline`, async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Audio', exact: true }).click();
  await page.getByRole('button', { name: 'Extract from audio or video', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Just the part you need.' });
  await dialog.locator('input[type=file]').setInputFiles(kind === 'audio' ? { name: 'trim-test.wav', mimeType: 'audio/wav', buffer: wav() } : 'tests/fixtures/audio-video.mp4');
  await expect(dialog.getByRole('button', { name: 'Download MP3', exact: true })).toBeEnabled();
  await dialog.getByLabel('Extraction start time').fill('00:01');
  await dialog.getByLabel('Extraction end time').fill('00:03');
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download MP3', exact: true }).click();
  await (await downloaded).saveAs(`/tmp/quranvid-extracted-${kind}-range.mp3`);
  await expect(dialog.getByRole('button', { name: 'Add to timeline', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Add to timeline', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('Audio duration', { exact: true })).toHaveValue('2');
  await expect(page.locator('.audio-clip')).toHaveCount(2);
});

function wav() {
  const rate = 48000, samples = rate * 4;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 16000), 44 + i * 2);
  return buffer;
}

test('seeks the extraction preview independently of its range and keeps playing while scrubbing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Audio', exact: true }).click();
  await page.getByRole('button', { name: 'Extract from audio or video', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Just the part you need.' });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'seek.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(dialog.getByRole('button', { name: 'Download MP3', exact: true })).toBeEnabled();
  await dialog.getByLabel('Extraction start time').fill('00:01');
  await dialog.getByLabel('Extraction end time').fill('00:03');
  const wave = await dialog.locator('.extract-waveform').boundingBox();
  await page.mouse.click(wave!.x + wave!.width * .5, wave!.y + wave!.height / 2);
  await expect.poll(() => dialog.locator('audio').evaluate(a => (a as HTMLAudioElement).currentTime)).toBeCloseTo(2, 1);
  await expect(dialog.getByLabel('Extraction start time')).toHaveValue('00:01');
  await expect(dialog.getByLabel('Extraction end time')).toHaveValue('00:03');
  const seek = dialog.getByRole('slider', { name: 'Playback position', exact: true });
  await seek.focus(); await seek.press('ArrowRight');
  await expect.poll(() => dialog.locator('audio').evaluate(a => (a as HTMLAudioElement).currentTime)).toBeCloseTo(2.01, 2);
  await page.mouse.click(wave!.x + wave!.width * .8, wave!.y + wave!.height / 2);
  await dialog.getByRole('button', { name: 'Play preview', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Pause preview', exact: true })).toBeVisible();
  await expect.poll(() => dialog.locator('audio').evaluate(a => (a as HTMLAudioElement).currentTime)).toBeGreaterThan(3.2);
  await page.mouse.move(wave!.x + wave!.width * .6, wave!.y + wave!.height / 2);
  await page.mouse.down(); await page.mouse.move(wave!.x + wave!.width * .4, wave!.y + wave!.height / 2, { steps: 4 }); await page.mouse.up();
  await expect.poll(() => dialog.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(false);
  await expect.poll(() => dialog.locator('audio').evaluate(a => (a as HTMLAudioElement).currentTime)).toBeLessThan(2.2);
  await dialog.getByRole('button', { name: 'Pause preview', exact: true }).click();
});

test('previews just the selection and can mark range boundaries at the playhead', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Audio', exact: true }).click();
  await page.getByRole('button', { name: 'Extract from audio or video', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Just the part you need.' });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'selection.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(dialog.getByRole('button', { name: 'Download MP3', exact: true })).toBeEnabled();
  await dialog.getByLabel('Extraction start time').fill('00:00.30');
  await dialog.getByLabel('Extraction end time').fill('00:00.70');
  await dialog.getByRole('button', { name: 'Play selection', exact: true }).click();
  await expect.poll(() => dialog.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
  await expect.poll(() => dialog.locator('audio').evaluate(a => (a as HTMLAudioElement).currentTime)).toBeCloseTo(.7, 2);
  const wave = await dialog.locator('.extract-waveform').boundingBox();
  await page.mouse.click(wave!.x + wave!.width * .1, wave!.y + wave!.height / 2);
  await dialog.getByRole('button', { name: 'Set to playhead', exact: true }).first().click();
  await expect(dialog.getByLabel('Extraction start time')).toHaveValue('00:00.40');
  await page.mouse.click(wave!.x + wave!.width * .5, wave!.y + wave!.height / 2);
  await dialog.getByRole('button', { name: 'Set to playhead', exact: true }).last().click();
  await expect(dialog.getByLabel('Extraction end time')).toHaveValue('00:02.00');
});

test('edits canvas position, undoes/redoes, and restores saved edits after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByLabel('X position', { exact: true })).toHaveValue('50');
  await page.getByLabel('X position', { exact: true }).fill('55');
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect(page.getByLabel('X position', { exact: true })).toHaveValue('50');
  await page.getByTitle('Redo (Ctrl+Shift+Z)').click();
  await expect(page.getByLabel('X position', { exact: true })).toHaveValue('55');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('X position', { exact: true })).toHaveValue('55');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await page.getByRole('button', { name: 'Forest light', exact: true }).click();
  await expect(page.getByText('Forest light', { exact: true }).last()).toBeVisible();
  expect(errors).toEqual([]);
});

test('selects Quran verses from the local full library', async ({ page }) => {
  await page.goto('/');
  await page.locator('.chapter-select').click();
  await page.getByLabel('Search chapters').fill('Ikhlas');
  await page.locator('.chapter-results button').click();
  await expect(page.getByLabel('To verse', { exact: true })).toHaveValue('4');
  await page.getByRole('button', { name: 'Add verses to timeline' }).click();
  await expect(page.locator('.verse-card')).toHaveCount(4);
  await expect(page.locator('.verse-card').first()).toContainText('112:1');
  await expect(page.locator('.verse-card').first()).toContainText('قُلْ');
  await expect(page.locator('.audio-clip')).toHaveCount(0);
});

test('places, trims and splits an uploaded recording and backs up its media', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'custom-recording.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(page.getByLabel('Audio duration', { exact: true })).toHaveValue('4');
  await page.getByLabel('Audio duration', { exact: true }).fill('2');
  await page.getByLabel('Source offset', { exact: true }).fill('1');
  await page.getByLabel('Audio start', { exact: true }).fill('3');
  const ruler = await page.locator('.time-ruler').boundingBox();
  await page.mouse.click(ruler!.x + 64, ruler!.y + 12);
  await page.getByTitle('Split selected audio at playhead (S)').click();
  await expect(page.locator('.audio-clip')).toHaveCount(3);
  await expect(page.getByLabel('Audio start', { exact: true })).toHaveValue('4');
  await expect(page.getByLabel('Source offset', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('Audio duration', { exact: true })).toHaveValue('1');
  await page.getByTitle('Project menu').click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project & media' }).click();
  const download = await downloaded;
  const json = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(json.media).toHaveLength(1);
  expect(json.media[0].data).toContain('data:audio/wav;base64,');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await expect(page.locator('.audio-clip')).toHaveCount(3);
});

for (const format of ['webm', 'mp4'] as const) test(`exports actual ${format} frames and correctly placed custom audio in the browser`, async ({ page }) => {
  const project = createProject();
  project.name = 'Export verification'; project.width = 360; project.height = 640; project.duration = 3;
  project.verses = [{ ...project.verses[0], start: 0, end: 3 }];
  project.layers = project.layers.map(l => ({ ...l, fontSize: l.fontSize / 3, start: 0, end: 3 }));
  project.layers[0].fontFamily = 'Amiri Quran';
  project.layers[0].transition = { enter: 'fade', exit: 'slide-up', duration: .3 };
  project.layers[0].animation = { effect: 'typewriter', duration: .5 };
  project.layers[1].fontFamily = 'monospace';
  project.layers[1].animation = { effect: 'line-reveal', duration: .7 };
  project.layers[3].referenceFormat = 'key';
  project.layers[3].x = 70;
  project.verses = splitVerse(project, project.verses[0].id, [2], [1.5]).verses;
  project.background.transition = { enter: 'slide-left', exit: 'slide-right', duration: .2 };
  project.background.motion = 'zoom-in';
  project.background.motionStrength = 20;
  project.background.motionDuration = 1;
  project.background.motionRepeat = true;
  project.audio = [{ id: 'test-audio-clip', assetId: 'test-tone', name: 'Offset test', start: 1, offset: 1, duration: 1, sourceDuration: 4, volume: .5, fadeIn: 0, fadeOut: 0 }];
  const portable = { project, media: [{ id: 'test-tone', name: 'Offset test', type: 'audio', duration: 4, data: `data:audio/wav;base64,${wav().toString('base64')}` }] };
  await page.goto('/');
  await page.locator('input[type="file"]').nth(1).setInputFiles({ name: 'export.quranvid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(portable)) });
  await expect(page.getByLabel('Project name')).toHaveValue('Export verification');
  await page.getByRole('button', { name: 'Export video' }).click();
  await page.getByLabel('Export format').selectOption(format);
  const downloaded = page.waitForEvent('download', { timeout: 100000 });
  await page.getByRole('button', { name: `Export ${format.toUpperCase()}`, exact: true }).click();
  const download = await downloaded;
  await download.saveAs(`/tmp/quranvid-export-verification.${format}`);
  await expect(page.getByText(/Your video is ready/)).toBeVisible();
});

test('splits a verse, keeps audio intact, saves parts and merges the original text with undo', async ({ page }) => {
  await page.goto('/');
  const originalArabic = await page.locator('.verse-card').first().locator('p').innerText();
  await page.locator('.verse-card').first().click();
  await page.getByRole('button', { name: 'Split verse into parts', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Split verse 1:1', exact: true });
  await dialog.getByRole('button', { name: '2 parts', exact: true }).click();
  await dialog.getByLabel('Part 1 end time', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Create 2 parts', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.verse-clip')).toHaveCount(8);
  await expect(page.locator('.verse-card').first()).toContainText('Part 1/2');
  await expect(page.locator('.verse-card').nth(1)).toContainText('Part 2/2');
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await expect(page.getByLabel('Verse end', { exact: true })).toHaveValue('3');
  const firstFrame = await page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL());
  await page.locator('.verse-card').nth(1).click();
  await expect(page.getByLabel('Verse start', { exact: true })).toHaveValue('3');
  await expect.poll(() => page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL())).not.toBe(firstFrame);
  // Editing one shared boundary also trims the preceding part.
  await page.getByLabel('Verse start', { exact: true }).fill('3.5');
  await page.locator('.verse-card').first().click();
  await expect(page.getByLabel('Verse end', { exact: true })).toHaveValue('3.5');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.getByTitle('Project menu').click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download project & media' }).click();
  const file = await (await downloaded).path();
  const backup = JSON.parse(readFileSync(file!, 'utf8'));
  const source = createProject();
  expect(backup.project.audio).toEqual(source.audio);
  expect(backup.project.duration).toBe(source.duration);
  expect(backup.project.verses[0].part.arabic).toBe(originalArabic);
  await page.reload();
  await expect(page.locator('.verse-card')).toHaveCount(8);
  await page.locator('.verse-card').first().click();
  await page.getByRole('button', { name: 'Merge verse parts', exact: true }).click();
  await expect(page.locator('.verse-card')).toHaveCount(7);
  await expect(page.locator('.verse-inspect p')).toHaveText(originalArabic);
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect(page.locator('.verse-card')).toHaveCount(8);
  await page.getByTitle('Redo (Ctrl+Shift+Z)').click();
  await expect(page.locator('.verse-card')).toHaveCount(7);
  // Portable backups can restore split metadata, not only the browser's saved copy.
  await page.locator('input[type="file"]').nth(1).setInputFiles({ name: 'split.quranvid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator('.verse-card')).toHaveCount(8);
  await page.locator('.verse-card').first().click();
  await expect(page.getByRole('button', { name: 'Merge verse parts', exact: true })).toBeVisible();
});

test('chooses manual breaks, marks a boundary while listening and validates part translations', async ({ page }) => {
  await page.goto('/');
  await page.locator('.verse-card').first().click();
  await page.getByRole('button', { name: 'Split verse into parts', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Split verse 1:1', exact: true });
  await dialog.getByRole('button', { name: 'Break after word 2', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Break after word 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Listen to verse', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Pause recitation', exact: true })).toBeVisible();
  await expect.poll(() => dialog.getByRole('slider', { name: 'Verse playback position' }).inputValue().then(Number)).toBeGreaterThan(.15);
  await dialog.getByRole('button', { name: 'Pause recitation', exact: true }).click();
  await dialog.getByRole('button', { name: 'Mark part 1 end at playhead', exact: true }).click();
  expect(Number(await dialog.getByLabel('Part 1 end time', { exact: true }).inputValue())).toBeGreaterThan(.1);
  await dialog.getByLabel('Part 1 end time', { exact: true }).fill('0');
  await dialog.getByRole('button', { name: 'Create 2 parts', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('at least 0.1 seconds');
  await dialog.getByLabel('Part 1 end time', { exact: true }).fill('3');
  await dialog.getByLabel('Translation display', { exact: true }).selectOption('custom');
  await dialog.getByRole('button', { name: 'Create 2 parts', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('translation for every part');
  await dialog.getByLabel('Part 1 translation', { exact: true }).fill('In the name of Allah');
  await dialog.getByLabel('Part 2 translation', { exact: true }).fill('the Most Compassionate, Most Merciful.');
  await dialog.getByRole('button', { name: 'Create 2 parts', exact: true }).click();
  await expect(page.locator('.verse-inspect>span').last()).toHaveText('In the name of Allah');
  await page.locator('.verse-card').nth(1).click();
  await expect(page.locator('.verse-inspect>span').last()).toHaveText('the Most Compassionate, Most Merciful.');
});

test('cancels split drafts without edits and fits the long verse controls on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quran', exact: true }).click();
  await page.locator('.verse-card').last().click();
  await page.getByRole('button', { name: 'Split verse into parts', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Split verse 1:7', exact: true });
  await dialog.getByRole('button', { name: '3 parts', exact: true }).click();
  await expect(dialog.locator('.split-part')).toHaveCount(3);
  expect(await dialog.evaluate(d => d.scrollWidth <= d.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.screenshot({ path: '/tmp/quranvid-verse-split-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.verse-card')).toHaveCount(7);
  await expect(page.getByRole('button', { name: 'Split verse into parts', exact: true })).toBeFocused();
});

test('trims a shared part edge and moves the verse parts together with one undo per drag', async ({ page }) => {
  await page.goto('/');
  await page.locator('.verse-card').first().click();
  await page.getByRole('button', { name: 'Split verse into parts', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Split verse 1:1', exact: true });
  await dialog.getByRole('button', { name: '2 parts', exact: true }).click();
  await dialog.getByLabel('Part 1 end time', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Create 2 parts', exact: true }).click();
  const first = page.locator('.verse-clip').first();
  const handle = await first.locator('.trim-handle.right').boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down(); await page.mouse.move(handle!.x + handle!.width / 2 + 16, handle!.y + handle!.height / 2, { steps: 5 }); await page.mouse.up();
  await expect(page.getByLabel('Verse end', { exact: true })).toHaveValue('4');
  // Keyboard selection avoids adding an extra pointer drag checkpoint.
  await page.locator('.verse-clip').nth(1).press('Enter');
  await expect(page.getByLabel('Verse start', { exact: true })).toHaveValue('4');
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect(page.getByLabel('Verse start', { exact: true })).toHaveValue('3');
  const body = await first.boundingBox();
  await page.mouse.move(body!.x + 15, body!.y + body!.height / 2);
  await page.mouse.down(); await page.mouse.move(body!.x + 31, body!.y + body!.height / 2, { steps: 5 }); await page.mouse.up();
  await expect(page.getByLabel('Verse start', { exact: true })).toHaveValue('1');
  await page.locator('.verse-clip').nth(1).press('Enter');
  await expect(page.getByLabel('Verse start', { exact: true })).toHaveValue('4');
  await expect(page.getByLabel('Verse end', { exact: true })).toHaveValue('7.09');
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect(page.getByLabel('Verse start', { exact: true })).toHaveValue('3');
});

test('mobile layout stays within the viewport and exposes all editor panels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await expect(page.locator('canvas')).toBeVisible();
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasOverflow).toBe(false);
  await page.screenshot({ path: '/tmp/quranvid-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Add a text layer' }).click();
  await expect(page.locator('textarea')).toHaveValue('Your title here');
});

test('adjusts percentage line height, persists it, and replaces the background directly', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Line height', { exact: true })).toHaveValue('185');
  await page.getByLabel('Line height', { exact: true }).fill('125');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Line height', { exact: true })).toHaveValue('125');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTitle('Replace background', { exact: true }).click();
  await (await chooser).setFiles('public/backgrounds/coast.jpg');
  await expect(page.locator('.background-info')).toContainText('coast.jpg');
  await expect(page.locator('.inspector').getByRole('button', { name: 'Replace background', exact: true })).toBeVisible();
});

test('extends the last verse beyond the old project end with a single undoable drag', async ({ page }) => {
  await page.goto('/');
  const clip = page.locator('.verse-clip').last();
  await clip.scrollIntoViewIfNeeded();
  const handle = clip.locator('.trim-handle.right');
  const bounds = await handle.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds!.x + bounds!.width / 2 + 48, bounds!.y + bounds!.height / 2, { steps: 8 }); await page.mouse.up();
  const newEnd = Number(await page.getByLabel('Verse end', { exact: true }).inputValue());
  expect(newEnd).toBeGreaterThan(48);
  await expect(page.getByRole('slider', { name: 'Video duration', exact: true })).toHaveAttribute('aria-valuenow', String(newEnd));
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect(page.getByLabel('Verse end', { exact: true })).toHaveValue('46.49');
});

test('drags the video end handle and keeps the final verse and Quran layers visible', async ({ page }) => {
  await page.goto('/');
  const handle = page.getByRole('slider', { name: 'Video duration', exact: true });
  await handle.scrollIntoViewIfNeeded();
  const bounds = await handle.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 10);
  await page.mouse.down(); await page.mouse.move(bounds!.x + bounds!.width / 2 + 80, bounds!.y + 10, { steps: 10 }); await page.mouse.up();
  const duration = Number(await handle.getAttribute('aria-valuenow'));
  expect(duration).toBeGreaterThan(50);
  await expect(page.getByLabel('Project duration', { exact: true })).toHaveValue(String(duration));
  await page.locator('.verse-clip').last().click();
  await expect(page.getByLabel('Verse end', { exact: true })).toHaveValue(String(duration));
  await page.getByRole('button', { name: 'Style Arabic text', exact: true }).click();
  await expect(page.getByLabel('Layer end', { exact: true })).toHaveValue(String(duration));
});

test('renders the bundled Quran fonts and preserves font and transition choices', async ({ page }) => {
  await page.goto('/');
  const font = page.getByLabel('Font family', { exact: true });
  await expect(font).toHaveValue('Noto Naskh Arabic');
  for (const family of ['Amiri Quran', 'Amiri', 'Scheherazade New', 'Lateef']) {
    const before = await page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL());
    await font.selectOption(family);
    await expect.poll(() => page.evaluate(name => document.fonts.check(`24px "${name}"`), family)).toBe(true);
    await expect.poll(() => page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL())).not.toBe(before);
  }
  await font.selectOption('Amiri Quran');
  await page.getByLabel('Entrance transition', { exact: true }).selectOption('slide-up');
  await page.getByLabel('Exit transition', { exact: true }).selectOption('fade');
  await page.getByLabel('Transition duration', { exact: true }).fill('0.7');
  await page.getByRole('button', { name: 'Preview transition', exact: true }).click();
  await expect(page.getByTitle('Pause (Space)', { exact: true })).toBeVisible();
  await page.getByTitle('Pause (Space)', { exact: true }).click();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await expect(font).toHaveValue('Amiri Quran');
  await expect(page.getByLabel('Entrance transition', { exact: true })).toHaveValue('slide-up');
  await expect(page.getByLabel('Transition duration', { exact: true })).toHaveValue('0.7');
  await page.locator('.inspector .layer-list').getByRole('button', { name: 'Background', exact: true }).click();
  await page.getByLabel('Entrance transition', { exact: true }).selectOption('fade');
  await page.getByLabel('Exit transition', { exact: true }).selectOption('zoom');
  await page.getByLabel('Background motion', { exact: true }).selectOption('pan-left');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await page.locator('.inspector .layer-list').getByRole('button', { name: 'Background', exact: true }).click();
  await expect(page.getByLabel('Entrance transition', { exact: true })).toHaveValue('fade');
  await expect(page.getByLabel('Exit transition', { exact: true })).toHaveValue('zoom');
  await expect(page.getByLabel('Background motion', { exact: true })).toHaveValue('pan-left');
});

for (const size of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) test(`keeps the custom text color picker inside a ${size.width}px viewport`, async ({ page }) => {
  await page.setViewportSize(size);
  await page.goto('/');
  if (size.width <= 850) await page.getByRole('button', { name: 'Edit selection', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Text color', exact: true });
  await trigger.click();
  const picker = page.getByRole('dialog', { name: 'Text color picker', exact: true });
  await expect(picker).toBeVisible();
  const bounds = await picker.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height);
  await picker.getByLabel('Hex color', { exact: true }).fill('#d8aa44');
  await expect(trigger).toContainText('#d8aa44');
  await picker.getByRole('slider', { name: 'Saturation and brightness', exact: true }).press('ArrowLeft');
  await expect(trigger).not.toContainText('#d8aa44');
  await picker.getByRole('button', { name: 'Set text color #c0d5a7', exact: true }).click();
  await expect(trigger).toContainText('#c0d5a7');
  await page.screenshot({ path: `/tmp/quranvid-color-picker-${size.width}.png` });
  await picker.press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page.getByText('Saved on this device')).toBeAttached();
  await page.reload();
  if (size.width <= 850) await page.getByRole('button', { name: 'Edit selection', exact: true }).click();
  await expect(trigger).toContainText('#c0d5a7');
});

test('styles, positions and hides the live verse number without changing the surah title', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Style verse number', exact: true }).click();
  await page.getByLabel('Verse number format', { exact: true }).selectOption('number');
  await page.getByLabel('Font family', { exact: true }).selectOption('serif');
  await page.getByLabel('Font size', { exact: true }).fill('42');
  await page.getByLabel('X position', { exact: true }).fill('60');
  await page.getByLabel('Y position', { exact: true }).fill('80');
  await page.getByRole('button', { name: 'Visible on canvas', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hidden on canvas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hidden on canvas', exact: true }).click();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Style verse number', exact: true }).click();
  await expect(page.getByLabel('Verse number format', { exact: true })).toHaveValue('number');
  await expect(page.getByLabel('Font family', { exact: true })).toHaveValue('serif');
  await expect(page.getByLabel('Font size', { exact: true })).toHaveValue('42');
  await expect(page.getByLabel('X position', { exact: true })).toHaveValue('60');
  await expect(page.getByLabel('Y position', { exact: true })).toHaveValue('80');
  await page.locator('.inspector .layer-list').getByRole('button', { name: 'Chapter title', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Text content', exact: true })).toHaveValue('Al-Fatihah');
  await page.locator('.inspector .layer-list').getByRole('button', { name: 'Background', exact: true }).click();
  await page.getByLabel('Show verse reference', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Style verse number', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hidden on canvas', exact: true })).toBeVisible();
});

test('upgrades a legacy backup and keeps a hidden reference hidden until enabled', async ({ page }) => {
  const project = createProject();
  project.layers = project.layers.filter(layer => layer.kind !== 'reference');
  project.showReference = false;
  await page.goto('/');
  await page.locator('input[type="file"]').nth(1).setInputFiles({ name: 'legacy.quranvid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ project, media: [] })) });
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Style verse number', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hidden on canvas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hidden on canvas', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Visible on canvas', exact: true })).toBeVisible();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await expect(page.locator('.inspector .layer-list').getByRole('button', { name: 'Verse number', exact: true })).toHaveCount(1);
});

test('renders translation font categories and deterministic text reveals without changing the layout', async ({ page }) => {
  await page.goto('/');
  await page.locator('.inspector .layer-list').getByRole('button', { name: 'English translation', exact: true }).click();
  for (const family of ['sans-serif', 'serif', 'monospace']) {
    const previous = await page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL());
    await page.getByLabel('Font family', { exact: true }).selectOption(family);
    await expect(page.getByLabel('Font preview')).toHaveCSS('font-family', family);
    await expect.poll(() => page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL())).not.toBe(previous);
  }
  await page.getByLabel('Text animation', { exact: true }).selectOption('typewriter');
  await page.getByLabel('Reveal duration', { exact: true }).fill('2');
  await page.getByTitle('Go to start', { exact: true }).click();
  const hidden = await page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL());
  const ruler = await page.locator('.time-ruler').boundingBox();
  await page.mouse.click(ruler!.x + 16, ruler!.y + ruler!.height / 2);
  await expect.poll(() => page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL())).not.toBe(hidden);
  const partial = await page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL());
  await page.mouse.click(ruler!.x + 48, ruler!.y + ruler!.height / 2);
  await expect.poll(() => page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL())).not.toBe(partial);
  const complete = await page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL());
  await page.getByLabel('Text animation', { exact: true }).selectOption('none');
  await page.getByTitle('Go to start', { exact: true }).click();
  await expect.poll(() => page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL())).toBe(complete);
  await page.getByLabel('Text animation', { exact: true }).selectOption('word-reveal');
  await page.getByRole('button', { name: 'Preview text animation', exact: true }).click();
  await expect(page.getByTitle('Pause (Space)', { exact: true })).toBeVisible();
  await page.getByTitle('Pause (Space)', { exact: true }).click();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await page.locator('.inspector .layer-list').getByRole('button', { name: 'English translation', exact: true }).click();
  await expect(page.getByLabel('Text animation', { exact: true })).toHaveValue('word-reveal');
  await expect(page.getByLabel('Font family', { exact: true })).toHaveValue('monospace');
});

for (const effect of ['typewriter', 'line-reveal']) test(`renders continuously changing Arabic frames for ${effect} without reflow`, async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Font size', { exact: true }).fill('120');
  await page.getByLabel('Text animation', { exact: true }).selectOption(effect);
  await page.getByLabel('Reveal duration', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Preview text animation', exact: true }).click();
  await expect(page.getByTitle('Pause (Space)', { exact: true })).toBeVisible();
  const frames = await page.locator('canvas').evaluate(async canvas => {
    const context = (canvas as HTMLCanvasElement).getContext('2d')!;
    const hashes: number[] = [];
    for (let frame = 0; frame < 24; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const pixels = context.getImageData(80, 520, 920, 580).data;
      let hash = 2166136261;
      for (let i = 0; i < pixels.length; i += 4) hash = Math.imul(hash ^ pixels[i], 16777619);
      hashes.push(hash >>> 0);
    }
    return hashes;
  });
  // Whole-word/whole-line stepping produces only a few unique frames here.
  expect(new Set(frames).size).toBeGreaterThan(12);
  await page.getByTitle('Pause (Space)', { exact: true }).click();
  const ruler = await page.locator('.time-ruler').boundingBox();
  await page.mouse.click(ruler!.x + 56, ruler!.y + ruler!.height / 2);
  await expect.poll(() => page.locator('.timecode').innerText()).toContain('00:03.50');
  await page.screenshot({ path: `/tmp/quranvid-smooth-${effect}.png` });
  const complete = await page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL());
  await page.getByLabel('Text animation', { exact: true }).selectOption('none');
  await expect.poll(() => page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL())).toBe(complete);
});

test('previews configurable background image movement and restores its settings', async ({ page }) => {
  await page.goto('/');
  await page.locator('.inspector .layer-list').getByRole('button', { name: 'Background', exact: true }).click();
  await page.getByLabel('Background motion', { exact: true }).selectOption('zoom-in');
  await expect(page.getByLabel('Motion duration', { exact: true })).toHaveValue('12');
  await page.getByLabel('Motion duration', { exact: true }).fill('4');
  await page.getByRole('slider', { name: 'Motion strength', exact: true }).fill('25');
  await page.getByLabel('Repeat back and forth', { exact: true }).check();
  for (const motion of ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'zoom-drift', 'breathe']) {
    await page.getByLabel('Background motion', { exact: true }).selectOption(motion);
    const labels: Record<string, string> = { 'zoom-in': 'slow zoom in', 'zoom-out': 'slow zoom out', 'pan-left': 'pan left', 'pan-right': 'pan right', 'pan-up': 'pan up', 'pan-down': 'pan down', 'zoom-drift': 'zoom & drift', 'breathe': 'zoom in & out' };
    await expect(page.getByRole('button', { name: `Preview ${labels[motion]}`, exact: true })).toBeVisible();
    await page.getByTitle('Go to start', { exact: true }).click();
    const before = await page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL());
    const ruler = await page.locator('.time-ruler').boundingBox();
    await page.mouse.click(ruler!.x + 32, ruler!.y + ruler!.height / 2);
    await expect.poll(() => page.locator('canvas').evaluate(c => (c as HTMLCanvasElement).toDataURL())).not.toBe(before);
  }
  await page.getByRole('button', { name: 'Preview zoom in & out', exact: true }).click();
  await expect(page.getByTitle('Pause (Space)', { exact: true })).toBeVisible();
  await page.getByTitle('Pause (Space)', { exact: true }).click();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await page.locator('.inspector .layer-list').getByRole('button', { name: 'Background', exact: true }).click();
  await expect(page.getByLabel('Background motion', { exact: true })).toHaveValue('breathe');
  await expect(page.getByLabel('Motion duration', { exact: true })).toHaveValue('4');
  await expect(page.getByRole('slider', { name: 'Motion strength', exact: true })).toHaveValue('25');
  await expect(page.getByLabel('Repeat back and forth', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Remove motion', exact: true }).click();
  await expect(page.getByLabel('Background motion', { exact: true })).toHaveValue('none');
  await page.getByRole('button', { name: 'Try gentle zoom in', exact: true }).click();
  await expect(page.getByLabel('Background motion', { exact: true })).toHaveValue('zoom-in');
  await expect(page.getByRole('slider', { name: 'Motion strength', exact: true })).toHaveValue('6');
  await expect(page.getByLabel('Motion duration', { exact: true })).toHaveValue('46.49');
  await expect(page.getByLabel('Repeat back and forth', { exact: true })).not.toBeChecked();
});

test('opens a shared project with media credits and preserves the previous local project', async ({ page }) => {
  const token = 't'.repeat(43), photoId = '10000000-0000-4000-8000-000000000001';
  const project = createProject(); project.name = 'Shared forest draft';
  project.background = { ...project.background, source: photoId, name: 'Forest photograph' };
  const photo = readFileSync('public/backgrounds/forest.jpg');
  await page.route(`**/api/handoffs/${token}`, route => route.fulfill({ json: { project, expiresAt: new Date(Date.now() + 3600000).toISOString(), media: [{ id: photoId, type: 'image', name: 'Forest photograph', bytes: photo.length, url: `/api/handoffs/${token}/media/${photoId}`, attribution: { title: 'Forest photograph', creator: 'Example photographer', sourceUrl: 'https://example.com/forest', license: 'CC BY 4.0', provider: 'Test library' } }] } }));
  await page.route(`**/api/handoffs/${token}/media/${photoId}`, route => route.fulfill({ body: photo, contentType: 'image/jpeg' }));
  await page.goto('/');
  await page.getByLabel('Project name').fill('My previous project');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.goto(`/#draft=${token}`);
  const dialog = page.getByRole('dialog', { name: 'Open shared project', exact: true });
  await expect(dialog.getByRole('button', { name: 'Open editable copy', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Project name')).toHaveValue('My previous project');
  await expect(dialog).toContainText('Example photographer');
  await dialog.getByRole('button', { name: 'Open editable copy', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('Project name')).toHaveValue('Shared forest draft');
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.getByTitle('Project menu').click();
  await page.getByRole('button', { name: 'Media credits', exact: true }).click();
  const credits = page.getByRole('dialog', { name: 'Media credits', exact: true });
  await expect(credits).toContainText('Example photographer');
  await expect(credits.getByRole('link', { name: 'View source', exact: true })).toHaveAttribute('href', 'https://example.com/forest');
  await credits.getByRole('button', { name: 'Close media credits', exact: true }).click();
  await page.getByTitle('Project menu').click();
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download project & media', exact: true }).click();
  const backup = JSON.parse(readFileSync((await (await downloaded).path())!, 'utf8'));
  expect(backup.media[0].attribution.creator).toBe('Example photographer');
  await page.reload();
  await page.getByTitle('Project menu').click(); await page.getByRole('button', { name: 'Saved projects', exact: true }).click();
  const saved = page.getByRole('dialog', { name: 'Saved projects', exact: true });
  await expect(saved.getByRole('button', { name: /Shared forest draft/ })).toBeVisible();
  await saved.getByRole('button', { name: /My previous project/ }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('My previous project');
});

test('shows an expired project link without replacing the current project', async ({ page }) => {
  const token = 'e'.repeat(43);
  await page.route(`**/api/handoffs/${token}`, route => route.fulfill({ status: 410, json: { error: 'Expired link' } }));
  await page.goto(`/#draft=${token}`);
  const dialog = page.getByRole('dialog', { name: 'Open shared project', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('expired');
  await expect(dialog.getByRole('button', { name: 'Open editable copy', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close shared project', exact: true }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Al-Fatihah · A moment of reflection');
});
