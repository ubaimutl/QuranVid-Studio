import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 120000, workers: 1,
  use: { baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 1000 }, headless: true, launchOptions: { args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] } },
});
