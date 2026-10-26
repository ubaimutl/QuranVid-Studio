import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/'); await expect(page.getByText('Saved on this device')).toBeAttached();
}
async function boxes(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right };
    };
    return { timeline: rect('.timeline'), stage: rect('.stage-area'), canvas: rect('.video-canvas'), workspace: rect('.workspace-column') };
  });
}
test('collapses inspector sections by mouse and keyboard without losing field values or toggling playback', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Arabic verse', exact: true }).click();
  await page.getByLabel('Font size', { exact: true }).fill('66');
  const heading = page.getByRole('button', { name: 'Typography', exact: true });
  await expect(heading).toHaveAttribute('aria-expanded', 'true');
  await heading.click();
  await expect(heading).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Font size', { exact: true })).toBeHidden();
  await heading.focus(); await heading.press('Space');
  await expect(heading).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Font size', { exact: true })).toHaveValue('66');
  await expect(page.getByRole('button', { name: 'Play (Space)', exact: true })).toBeVisible();
  await heading.press('Enter');
  await expect(page.getByLabel('Font size', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Text layout', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Auto-fit text', exact: true })).toBeHidden();
});

test('grows the timeline by dragging, limits its height, resets it and keeps the preview above it', async ({ page }) => {
  await ready(page);
  const initial = await boxes(page);
  const divider = page.getByRole('separator', { name: 'Resize timeline height', exact: true });
  const handle = (await divider.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2, handle.y - 120, { steps: 8 }); await page.mouse.up();
  const grown = await boxes(page);
  expect(grown.timeline.height).toBeGreaterThan(initial.timeline.height + 100);
  expect(grown.stage.height).toBeLessThan(initial.stage.height);
  expect(grown.canvas.bottom).toBeLessThanOrEqual(grown.timeline.top);
  expect(grown.canvas.top).toBeGreaterThanOrEqual(grown.stage.top);
  await divider.focus(); await divider.press('End');
  const maximum = await boxes(page);
  expect(maximum.timeline.height).toBeLessThanOrEqual(Number(await divider.getAttribute('aria-valuemax')) + 1);
  expect(maximum.stage.height).toBeGreaterThanOrEqual(259);
  expect(maximum.canvas.bottom).toBeLessThanOrEqual(maximum.timeline.top);
  await divider.press('ArrowDown');
  expect((await boxes(page)).timeline.height).toBeLessThan(maximum.timeline.height);
  await divider.press('Home');
  expect((await boxes(page)).timeline.height).toBe(180);
  await divider.dblclick();
  expect((await boxes(page)).timeline.height).toBe(initial.timeline.height);
  await divider.press('End');
  await page.setViewportSize({ width: 1440, height: 720 });
  await expect.poll(async () => (await boxes(page)).stage.height).toBeGreaterThanOrEqual(259);
  const shorter = await boxes(page);
  expect(shorter.canvas.bottom).toBeLessThanOrEqual(shorter.timeline.top);
  await page.screenshot({ path: '/tmp/quranvid-resizable-timeline.png' });
});

test('bounds timeline resizing on a narrow mobile layout without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await ready(page);
  const divider = page.getByRole('separator', { name: 'Resize timeline height', exact: true });
  await divider.focus(); await divider.press('End');
  const layout = await boxes(page);
  expect(layout.canvas.bottom).toBeLessThanOrEqual(layout.timeline.top);
  expect(layout.stage.height).toBeGreaterThanOrEqual(219);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
