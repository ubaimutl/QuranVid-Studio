import { test, expect, type Page } from '@playwright/test';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createProject } from '../../lib/sample';
import { applyVideoTemplate, VIDEO_TEMPLATES } from '../../lib/templates';
import { type Project, type Verse } from '../../lib/model';

const quran: Verse[] = JSON.parse(readFileSync('public/data/quran.json', 'utf8'));
const bundle = buildSync({ stdin: { contents: `export * from './lib/text-layout'; export { drawProject } from './lib/renderer'; export { ensureProjectFonts } from './lib/fonts';`, resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'TextFitTest', write: false }).outputFiles[0].text;
type TestApi = typeof import('../../lib/text-layout') & typeof import('../../lib/renderer') & typeof import('../../lib/fonts');

function longProject(key = '10:2') {
  const project = applyVideoTemplate(createProject(), 'parchment');
  project.verses = [{ ...quran.find(verse => verse.key === key)!, id: 'long-verse', start: 0, end: project.duration }];
  project.layers.find(layer => layer.id === 'title')!.text = 'Yunus';
  return project;
}
async function openProject(page: Page, project: Project) {
  await page.goto('/');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.evaluate(async project => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('quranvid-studio', 1);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put(project, 'current');
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }, project);
  await page.reload();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.addScriptTag({ content: bundle });
}

test('measures long verses with real fonts and keeps templates separated through reveal and transition animations', async ({ page }) => {
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const projects = VIDEO_TEMPLATES.flatMap(template => [[1080, 1920], [1080, 1080], [1080, 1350], [1920, 1080]].map(([width, height]) => {
    const base = longProject(); base.width = width; base.height = height;
    const project = applyVideoTemplate(base, template.id);
    project.layers = project.layers.map(layer => layer.kind === 'arabic' ? { ...layer, animation: { effect: 'typewriter', duration: 2 }, transition: { enter: 'slide-up', exit: 'zoom', duration: .5 } } : layer.kind === 'translation' ? { ...layer, animation: { effect: 'line-reveal', duration: 2 }, transition: { enter: 'slide-down', exit: 'slide-up', duration: .5 } } : layer);
    return project;
  }));
  const result = await page.evaluate(async projects => {
    const api = (window as unknown as { TextFitTest: TestApi }).TextFitTest;
    const checks = [];
    for (const project of projects) {
      await api.ensureProjectFonts(project);
      const canvas = document.createElement('canvas'); canvas.width = project.width; canvas.height = project.height;
      const ctx = canvas.getContext('2d')!;
      const before = JSON.stringify(project);
      const fitted = api.fitProjectText(ctx, project, 1);
      const start = api.fitProjectText(ctx, project, .001);
      const end = api.fitProjectText(ctx, project, project.duration - .001);
      const bounds = api.drawProject(canvas, project, 2, {});
      const arabic = bounds.find(b => b.id === 'arabic')!, translation = bounds.find(b => b.id === 'translation')!;
      const title = bounds.find(b => b.id === 'title')!, reference = bounds.find(b => b.id === 'verse-reference')!;
      checks.push({ overflow: fitted.overflow, unchanged: JSON.stringify(project) === before,
        stable: JSON.stringify(fitted.project.layers) === JSON.stringify(start.project.layers) && JSON.stringify(start.project.layers) === JSON.stringify(end.project.layers),
        gap: translation.y - arabic.y - arabic.height, topGap: arabic.y - title.y - title.height, bottomGap: reference.y - translation.y - translation.height });
    }
    return checks;
  }, projects);
  for (const check of result) {
    expect(check.unchanged).toBe(true); expect(check.stable).toBe(true);
    expect(check.gap).toBeGreaterThan(10);
    if (!check.overflow) { expect(check.topGap).toBeGreaterThan(0); expect(check.bottomGap).toBeGreaterThan(0); }
  }
  expect(result[6 * 4].overflow).toBe(false); // Exact Parchment portrait regression.
});

test('fits Yunus 10:2 locally, preserves manual placement, supports undo and persists the setting', async ({ page }) => {
  await openProject(page, longProject());
  await expect(page.getByRole('checkbox', { name: 'Auto-fit text', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Arabic verse', exact: true }).click();
  await expect(page.getByText('Text spacing is adjusted for this verse.', { exact: false })).toBeVisible();
  await page.screenshot({ path: '/tmp/quranvid-yunus-autofit.png' });
  const y = await page.getByLabel('Y position', { exact: true }).inputValue();
  await page.getByRole('checkbox', { name: 'Auto-fit text', exact: true }).uncheck();
  await expect(page.getByLabel('Y position', { exact: true })).toHaveValue(y);
  await page.getByLabel('Y position', { exact: true }).fill('35');
  await expect(page.getByLabel('Y position', { exact: true })).toHaveValue('35');
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect(page.getByLabel('Y position', { exact: true })).toHaveValue(y);
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect(page.getByRole('checkbox', { name: 'Auto-fit text', exact: true })).toBeChecked();
  await page.getByLabel('Y position', { exact: true }).fill('38');
  await expect(page.getByRole('checkbox', { name: 'Auto-fit text', exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Y position', { exact: true })).toHaveValue('38');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Auto-fit text', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Arabic verse', exact: true }).click();
  await expect(page.getByLabel('Y position', { exact: true })).toHaveValue('38');
});

test('warns for verses beyond readable fitting limits and leaves existing manual projects unchanged', async ({ page }) => {
  await openProject(page, longProject('2:282'));
  await expect(page.getByRole('status').filter({ hasText: 'This verse is too long' })).toBeVisible();
  await page.screenshot({ path: '/tmp/quranvid-long-verse-fit-warning.png' });
  const result = await page.evaluate(async project => {
    const api = (window as unknown as { TextFitTest: TestApi }).TextFitTest;
    await api.ensureProjectFonts(project);
    const ctx = document.createElement('canvas').getContext('2d')!;
    const fit = api.fitProjectText(ctx, project, 1);
    const manual = { ...project, autoFitText: undefined };
    return { overflow: fit.overflow, ratios: fit.project.layers.filter(l => l.kind === 'arabic' || l.kind === 'translation').map(l => l.fontSize / project.layers.find(original => original.id === l.id)!.fontSize), manualUnchanged: api.fitProjectText(ctx, manual, 1).project === manual };
  }, longProject('2:282'));
  expect(result.overflow).toBe(true); expect(result.ratios.every(ratio => ratio >= .75)).toBe(true); expect(result.manualUnchanged).toBe(true);
});


test('exports the fitted long verse to MP4 using the same canvas layout', async ({ page }) => {
  const project = longProject();
  project.duration = 2; project.audio = [];
  project.verses = project.verses.map(verse => ({ ...verse, end: 2 }));
  project.layers = project.layers.map(layer => ({ ...layer, end: 2 }));
  await openProject(page, project);
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MP4', exact: true }).click();
  await (await download).saveAs('/tmp/quranvid-yunus-autofit.mp4');
});

test('uses bounded font fitting when spacing alone is insufficient, and handles hidden translation', async ({ page }) => {
  await page.goto('/'); await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async project => {
    const api = (window as unknown as { TextFitTest: TestApi }).TextFitTest;
    await api.ensureProjectFonts(project);
    const ctx = document.createElement('canvas').getContext('2d')!;
    const fit = api.fitProjectText(ctx, project, 1);
    const hidden = { ...project, layers: project.layers.map(layer => layer.kind === 'translation' ? { ...layer, visible: false } : layer) };
    const alone = api.fitProjectText(ctx, hidden, 1);
    return { overflow: fit.overflow, sizes: fit.project.layers.filter(l => l.kind === 'arabic' || l.kind === 'translation').map(l => ({ actual: l.fontSize, preferred: project.layers.find(original => original.id === l.id)!.fontSize })), aloneOverflow: alone.overflow, hidden: alone.project.layers.find(l => l.kind === 'translation')!.visible };
  }, longProject('2:255'));
  expect(result.overflow).toBe(false);
  expect(result.sizes.some(size => size.actual < size.preferred)).toBe(true);
  expect(result.sizes.every(size => size.actual >= size.preferred * .75)).toBe(true);
  expect(result.aloneOverflow).toBe(false); expect(result.hidden).toBe(false);
});

test('separates Ar-Rad 13:1–2 using the existing project layout and a raised verse reference', async ({ page }) => {
  const project = applyVideoTemplate(longProject('13:2'), 'stillness');
  project.layers.find(layer => layer.id === 'title')!.text = 'Ar-Ra’d';
  project.layers.find(layer => layer.kind === 'reference')!.y = 74;
  await openProject(page, project);
  const results = await page.evaluate(async ({ project, verses }) => {
    const api = (window as unknown as { TextFitTest: TestApi }).TextFitTest;
    await api.ensureProjectFonts(project);
    const canvas = document.createElement('canvas'); canvas.width = project.width; canvas.height = project.height;
    const ctx = canvas.getContext('2d')!;
    return verses.map(verse => {
      const current = { ...project, verses: [{ ...verse, id: 'active-verse', start: 0, end: project.duration }] };
      const fit = api.fitProjectText(ctx, current, 1);
      const check = (p: Project) => {
        const bounds = api.drawProject(canvas, p, 1, {});
        const arabic = bounds.find(b => b.id === 'arabic')!, translation = bounds.find(b => b.id === 'translation')!, reference = bounds.find(b => b.id === 'verse-reference')!;
        return { gap: translation.y - arabic.y - arabic.height, footerGap: reference.y - translation.y - translation.height };
      };
      return { overflow: fit.overflow, fitted: check(current), manual: check({ ...current, autoFitText: false }) };
    });
  }, { project, verses: quran.filter(v => v.key === '13:1' || v.key === '13:2') });
  for (const result of results) {
    expect(result.overflow).toBe(false); expect(result.fitted.gap).toBeGreaterThan(10); expect(result.fitted.footerGap).toBeGreaterThan(0);
  }
  expect(results[1].manual.gap).toBeLessThan(0);
  await page.screenshot({ path: '/tmp/quranvid-ar-rad-fitted.png' });
});

test('shows fitting first in the inspector and offers a one-click fix for older overlapping projects', async ({ page }) => {
  const project = longProject('13:2'); delete project.autoFitText;
  await openProject(page, project);
  const section = page.locator('.inspector-section').first();
  await expect(section.getByRole('heading', { name: 'Text layout', exact: true })).toBeVisible();
  await expect(section.getByRole('checkbox', { name: 'Auto-fit text', exact: true })).not.toBeChecked();
  await expect(section.getByRole('status')).toContainText('Arabic and translation overlap');
  await section.getByRole('button', { name: 'Fit text automatically', exact: true }).click();
  await expect(section.getByRole('checkbox', { name: 'Auto-fit text', exact: true })).toBeChecked();
  await expect(section.getByRole('button', { name: 'Fit text automatically', exact: true })).toHaveCount(0);
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect(section.getByRole('checkbox', { name: 'Auto-fit text', exact: true })).not.toBeChecked();
  await expect(section.getByRole('button', { name: 'Fit text automatically', exact: true })).toBeVisible();
});
