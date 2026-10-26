import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { createApp } from '../../server/app';
import { serverConfig } from '../../server/config';

let server: Server, base: string, directory: string;
const key = 'browser-test-only-owner-key-at-least-32-characters';
test.use({ launchOptions: { args: [] } });

test.beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'quranvid-browser-oauth-'));
  const probe = net.createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as net.AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  const service = await createApp(serverConfig({ QURANVID_API_KEY: key, QURANVID_PUBLIC_URL: base,
    QURANVID_PORT: String(port), QURANVID_DATA_DIR: directory }));
  server = service.app.listen(port, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
});
test.afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('submits the actual authorization form with its same-origin browser header and completes PKCE', async ({ page, request }) => {
  const callback = 'https://example.com/quranvid-test-callback';
  const registered = await request.post(base + '/register', { headers: { Origin: 'https://chatgpt.com' }, data: {
    client_name: 'Browser authorization test', redirect_uris: [callback], token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
  } });
  expect(registered.status()).toBe(201);
  const client = await registered.json(), verifier = 'A'.repeat(50);
  const query = new URLSearchParams({ client_id: client.client_id, response_type: 'code', redirect_uri: callback,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    state: 'browser-test', scope: 'quranvid', resource: base + '/mcp' });
  // Keep the fake OAuth callback in the test; no credentials leave localhost.
  await page.route(callback + '**', route => route.fulfill({ contentType: 'text/html', body: '<p>Connected.</p>' }));
  await page.goto(base + '/authorize?' + query, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.getByLabel('Server access key').fill(key);
  const submitted = page.waitForRequest(r => r.url() === base + '/oauth/approve' && r.method() === 'POST');
  const approved = page.waitForResponse(r => r.url() === base + '/oauth/approve' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  expect((await submitted).headers().origin).toBe(base);
  expect((await approved).status()).toBe(303);
  await expect(page).toHaveURL(new RegExp('^https://example\\.com/quranvid-test-callback\\?'));
  const destination = new URL(page.url()); expect(destination.searchParams.get('state')).toBe('browser-test');
  const tokens = await request.post(base + '/token', { headers: { Origin: 'https://chatgpt.com' }, form: {
    client_id: client.client_id, grant_type: 'authorization_code', code: destination.searchParams.get('code')!,
    code_verifier: verifier, redirect_uri: callback, resource: base + '/mcp',
  } });
  expect(tokens.status()).toBe(200);
});
