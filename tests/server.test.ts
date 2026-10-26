import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../server/app';
import { serverConfig } from '../server/config';
import { publicAddress, publicResponse, publicTarget } from '../server/network';
import { validateProject } from '../lib/model';
import { MediaService, type ImportRequest } from '../server/media';
import { decodeRecipeFragment } from '../lib/video-recipe';

describe('companion API and MCP integration', { concurrency: false }, () => {
  let service: Awaited<ReturnType<typeof createApp>>, server: import('node:http').Server, base: string, directory: string;
  const key = 'test-only-server-key-with-at-least-32-characters';
  const call = (url: string, options: RequestInit = {}) => fetch(base + url, { ...options, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...options.headers } });
  before(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'quranvid-api-test-'));
    const probe = net.createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as net.AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
    base = `http://127.0.0.1:${port}`;
    service = await createApp(serverConfig({ QURANVID_API_KEY: key, QURANVID_PUBLIC_URL: base, QURANVID_PORT: String(port), QURANVID_DATA_DIR: directory }));
    server = service.app.listen(port, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  });
  after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });

  it('requires authentication, advertises OAuth and rejects foreign browser origins', async () => {
    const denied = await fetch(base + '/api/projects'); assert.equal(denied.status, 401);
    assert.ok(denied.headers.get('www-authenticate')?.includes('oauth-protected-resource/mcp'));
    assert.equal((await call('/api/projects', { headers: { Origin: 'https://other.example' } })).status, 403);
    const metadata = await (await fetch(base + '/.well-known/oauth-authorization-server')).json();
    assert.equal(metadata.issuer, `${base}/`); assert.ok(metadata.code_challenge_methods_supported.includes('S256'));
    assert.equal((await (await call('/api/catalog')).json()).chapters.length, 114);
  });

  it('allows ChatGPT MCP/OAuth origins and preflight without opening the editor API', async () => {
    for (const origin of ['https://chatgpt.com', 'https://chat.openai.com']) {
      const headers = { Origin: origin };
      const discovery = await fetch(base + '/.well-known/oauth-authorization-server', { headers });
      assert.equal(discovery.status, 200);
      const rootResource = await fetch(base + '/.well-known/oauth-protected-resource', { headers });
      assert.equal(rootResource.status, 200); assert.equal((await rootResource.json()).resource, base + '/mcp');
      const pathAuthorization = await fetch(base + '/.well-known/oauth-authorization-server/mcp', { headers });
      assert.equal(pathAuthorization.status, 200); assert.equal((await pathAuthorization.json()).issuer, base + '/');
      const preflight = await fetch(base + '/mcp', { method: 'OPTIONS', headers: { ...headers,
        'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,mcp-protocol-version' } });
      assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
      assert.match(preflight.headers.get('access-control-allow-headers')!, /MCP-Protocol-Version/);
      const unauthorized = await fetch(base + '/mcp', { headers });
      assert.equal(unauthorized.status, 401); assert.equal(unauthorized.headers.get('access-control-allow-origin'), origin);
      assert.match(unauthorized.headers.get('access-control-expose-headers')!, /WWW-Authenticate/);
      assert.equal((await call('/api/projects', { headers })).status, 403);
      assert.equal((await fetch(base + '/oauth/approve', { method: 'POST', headers })).status, 403);
    }
    for (const origin of ['https://other.example', 'https://chatgpt.com.attacker.example', 'null']) {
      assert.equal((await fetch(base + '/mcp', { headers: { Origin: origin } })).status, 403);
    }
    const wrongUrl = await fetch(base + '/', { headers: { Origin: 'https://chatgpt.com' } });
    const diagnostic = await wrongUrl.json(); assert.equal(diagnostic.origin, 'https://chatgpt.com');
    assert.equal(diagnostic.endpoint, 'site'); assert.ok(diagnostic.hint.includes(base + '/mcp'));
    assert.throws(() => serverConfig({ QURANVID_API_KEY: key, QURANVID_MCP_ALLOWED_ORIGINS: 'https://example.com/path' }), /QURANVID_MCP_ALLOWED_ORIGINS/);
  });

  it('uses Cloudflare visitor addresses only in the explicitly enabled tunnel mode', async () => {
    assert.equal(service.app.get('trust proxy'), false);
    assert.throws(() => serverConfig({ QURANVID_API_KEY: key, QURANVID_PROXY_MODE: 'trust-anything' }), /QURANVID_PROXY_MODE/);
    const probe = net.createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as net.AddressInfo).port; await new Promise<void>(resolve => probe.close(() => resolve()));
    const origin = `http://127.0.0.1:${port}`;
    const proxy = await createApp(serverConfig({ QURANVID_API_KEY: key, QURANVID_PUBLIC_URL: origin,
      QURANVID_PORT: String(port), QURANVID_DATA_DIR: path.join(directory, 'proxy-test'), QURANVID_PROXY_MODE: 'cloudflare-tunnel' }));
    proxy.app.get('/proxy-check', (req, res) => res.json({ ip: req.ip }));
    const listener = proxy.app.listen(port, '127.0.0.1');
    await new Promise<void>(resolve => listener.once('listening', resolve));
    const url = `${origin}/proxy-check`;
    const headers = { 'X-Forwarded-For': '192.0.2.123' };
    try {
      for (const visitor of ['198.51.100.23', '203.0.113.42', '2001:db8::23']) {
        const response = await fetch(url, { headers: { ...headers, 'CF-Connecting-IP': visitor } });
        assert.equal(response.status, 200); assert.equal((await response.json()).ip, visitor);
      }
      assert.equal((await fetch(url, { headers: { ...headers, 'CF-Connecting-IP': 'not-an-address' } })).status, 400);
    } finally { await new Promise<void>(resolve => listener.close(() => resolve())); }
  });

  it('creates verified drafts, edits with revision checks and makes revocable snapshot links', async () => {
    const response = await call('/api/projects', { method: 'POST', body: JSON.stringify({ chapter: 49, from: 13, to: 14, name: 'Server test' }) });
    assert.equal(response.status, 201); const record = await response.json();
    assert.equal(record.project.verses[0].key, '49:13'); assert.equal(record.project.audio.length, 0); assert.equal(validateProject(record.project), true);
    const edited = await call(`/api/projects/${record.id}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: 1, background: { motion: 'zoom-in', motionStrength: 6 }, layers: [{ id: 'translation', patch: { fontFamily: 'serif', animation: { effect: 'line-reveal', duration: 2 } } }] }) });
    assert.equal(edited.status, 200); assert.equal((await edited.json()).revision, 2);
    assert.equal((await call(`/api/projects/${record.id}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: 1, name: 'Stale overwrite' }) })).status, 409);
    assert.equal((await call(`/api/projects/${record.id}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: 2, layers: [{ id: 'arabic', patch: { text: 'Invented Arabic' } }] }) })).status, 400);
    const link = await (await call(`/api/projects/${record.id}/links`, { method: 'POST', body: '{}' })).json();
    const token = new URLSearchParams(new URL(link.url).hash.slice(1)).get('draft')!;
    await call(`/api/projects/${record.id}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: 2, name: 'Later edit' }) });
    const snapshot = await (await fetch(`${base}/api/handoffs/${token}`)).json(); assert.equal(snapshot.project.name, 'Server test');
    assert.equal((await fetch(`${base}/api/handoffs/${token}/media/unrelated`)).status, 404);
    assert.equal((await call(`/api/links/${link.linkId}`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/api/handoffs/${token}`)).status, 410);
  });

  it('uploads actual media, mixes audio and scopes media downloads to the project link', async () => {
    const photo = await readFile('public/backgrounds/forest.jpg');
    const imageResponse = await call('/api/media/upload?type=image&name=Forest', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: photo });
    assert.equal(imageResponse.status, 201); const image = await imageResponse.json(); assert.equal(image.mime, 'image/jpeg');
    const audioResponse = await call('/api/media/upload?type=audio&name=Recitation', { method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, body: await readFile('public/audio/al-fatihah-alafasy.mp3') });
    assert.equal(audioResponse.status, 201); const audio = await audioResponse.json(); assert.ok(audio.duration > 46);
    const record = await (await call('/api/projects', { method: 'POST', body: JSON.stringify({ chapter: 1, from: 1, to: 2, duration: 12, backgroundAssetId: image.id }) })).json();
    const edited = await (await call(`/api/projects/${record.id}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: 1, audio: [{ assetId: audio.id, start: 0, offset: 4, duration: 12, volume: .2, fadeIn: .5, fadeOut: .5 }] }) })).json();
    assert.equal(edited.project.audio[0].offset, 4); assert.equal(edited.project.audio[0].volume, .2);
    const link = await service.projects.createLink(record.id, 1); const token = new URLSearchParams(new URL(link.url).hash.slice(1)).get('draft')!;
    const handoff = await (await fetch(`${base}/api/handoffs/${token}`)).json(); assert.equal(handoff.media.length, 2);
    const file = await fetch(base + handoff.media.find((item: { id: string }) => item.id === image.id).url); assert.equal(file.status, 200); assert.equal((await file.arrayBuffer()).byteLength, photo.length);
    assert.equal((await fetch(`${base}/api/assets/${image.id}/file`)).status, 401);
    assert.equal((await call('/api/media/upload?type=image', { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: '<html>not an image</html>' })).status, 400);
    assert.equal((await call('/api/media/upload?type=audio', { method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, body: '#EXTM3U\nhttps://127.0.0.1/private.mp3' })).status, 400);
  });

  it('blocks loopback, metadata, mapped IPv6 and non-HTTPS imports before download', async () => {
    assert.equal(publicAddress('8.8.8.8'), true); assert.equal(publicAddress('::ffff:127.0.0.1'), false); assert.equal(publicAddress('169.254.169.254'), false);
    for (const url of ['http://example.com/a.mp3', 'https://127.0.0.1/a.jpg', 'https://0x7f000001/a.jpg', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://192.168.1.1/x', 'https://host.local/x', 'https://user:pass@example.com/a.jpg']) await assert.rejects(() => publicTarget(url));
    const response = await call('/api/media/import', { method: 'POST', body: JSON.stringify({ url: 'https://127.0.0.1/private', type: 'image' }) }); assert.equal(response.status, 400);
    const redirect = mock.method(https, 'get', ((_url: URL, _options: unknown, callback: (response: unknown) => void) => {
      const response = new PassThrough(); Object.assign(response, { statusCode: 302, headers: { location: 'https://127.0.0.1/private' } });
      queueMicrotask(() => callback(response)); return Object.assign(new EventEmitter(), { setTimeout() { return this; } });
    }) as unknown as typeof https.get);
    try { await assert.rejects(() => publicResponse('https://8.8.8.8/file')); } finally { redirect.mock.restore(); }
  });

  it('downloads and extracts a real remote audio fixture without trusting its filename', async () => {
    const bytes = await readFile('public/audio/al-fatihah-alafasy.mp3');
    const request = mock.method(https, 'get', ((_url: URL, options: { lookup: (host: string, options: object, callback: (...args: unknown[]) => void) => void }, callback: (response: unknown) => void) => {
      options.lookup('ignored-host', {}, (_error, address) => assert.equal(address, '8.8.8.8'));
      const response = new PassThrough(); Object.assign(response, { statusCode: 200, headers: { 'content-length': String(bytes.length) } });
      queueMicrotask(() => { callback(response); response.end(bytes); }); return Object.assign(new EventEmitter(), { setTimeout() { return this; } });
    }) as unknown as typeof https.get);
    try {
      const response = await call('/api/media/import', { method: 'POST', body: JSON.stringify({ url: 'https://8.8.8.8/recording', type: 'audio', start: 4, end: 6, name: 'Two seconds', sourceUrl: 'https://example.com/recording', license: 'CC BY 4.0', creator: 'Test' }) });
      assert.equal(response.status, 201); const asset = await response.json(); assert.ok(asset.duration >= 2 && asset.duration < 2.1); assert.equal(asset.attribution.creator, 'Test');
    } finally { request.mock.restore(); }
  });

  it('serves tools to a real MCP client and creates an editable draft through tools', async () => {
    const client = new Client({ name: 'QuranVid integration test', version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${key}`, Origin: 'https://chatgpt.com' } } });
    try {
      await client.connect(transport); const tools = await client.listTools(); assert.ok(tools.tools.some(tool => tool.name === 'search_media')); assert.ok(tools.tools.some(tool => tool.name === 'get_edit_schema'));
      const response = await client.callTool({ name: 'create_project', arguments: { chapter: 1, from: 1, to: 2 } }); assert.equal(response.isError, undefined);
      const record = JSON.parse((response.content as { text: string }[])[0].text); assert.equal(record.project.verses.length, 2);
      const link = await client.callTool({ name: 'create_project_link', arguments: { projectId: record.id } }); assert.equal(link.isError, undefined);
      assert.ok(JSON.parse((link.content as { text: string }[])[0].text).url.includes('#draft='));
    } finally { await client.close(); }
  });

  it('exposes solid colors and templates to private clients and creates them without importing media', async () => {
    const catalog = await (await call('/api/catalog')).json();
    assert.ok(catalog.backgrounds.includes('dark-gray')); assert.equal(catalog.templates.length, 10);
    const before = await service.store.list('assets');
    for (const settings of [{ background: 'dark-gray' }, { backgroundColor: '#223344' }, { template: 'charcoal' }]) {
      const response = await call('/api/projects', { method: 'POST', body: JSON.stringify({ chapter: 1, from: 2, to: 3, ...settings }) });
      assert.equal(response.status, 201); const { project, id } = await response.json();
      assert.equal(project.background.type, 'color'); assert.equal(project.background.motion, 'none'); assert.equal(project.background.dim, 0);
      assert.equal(project.background.source, 'backgroundColor' in settings ? '#223344' : '#272727');
      assert.equal(project.verses[0].key, '1:2'); assert.equal(project.audio.length, 0);
      if ('template' in settings) {
        assert.equal(project.autoFitText, true);
        const manual = await call(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: 1, layers: [{ id: 'arabic', patch: { y: 35 } }] }) });
        assert.equal(manual.status, 200); const edited = await manual.json();
        assert.equal(edited.project.autoFitText, false); assert.equal(edited.project.layers.find((layer: { id: string }) => layer.id === 'arabic').y, 35);
        const fitted = await call(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: 2, autoFitText: true }) });
        assert.equal(fitted.status, 200); assert.equal((await fitted.json()).project.autoFitText, true);
      }

    }
    assert.deepEqual(await service.store.list('assets'), before);
  });

  it('generates anonymous recipe links without touching private projects, media, handoffs or OAuth storage', async t => {
    const snapshot = async () => Promise.all(['projects', 'assets', 'files', 'handoffs', 'oauth'].map(async bucket =>
      Promise.all((await readdir(path.join(directory, bucket))).sort().map(async file => [bucket, file, createHash('sha256').update(await readFile(path.join(directory, bucket, file))).digest('hex')]))));
    const before = await snapshot();
    const client = new Client({ name: 'Anonymous ChatGPT recipe test', version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp/public'), { requestInit: { headers: { Origin: 'https://chatgpt.com' } } });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['create_video_link', 'get_catalog']);
      assert.ok(tools.tools.every(tool => tool.annotations?.readOnlyHint && tool.annotations?.openWorldHint === false));
      const catalog = await client.callTool({ name: 'get_catalog', arguments: {} });
      assert.equal(catalog.isError, undefined);
      const recordingCatalog = (catalog.structuredContent as { result: { recitations: { reciters: { id: number; chapters: number[] }[] } } }).result;
      await t.test('optional production and Islam Sobhi catalog', { skip: ![9001, 174].every(id => recordingCatalog.recitations.reciters.some(reciter => reciter.id === id)) ? 'Requires the optional complete recitation pack' : false }, async () => {
        const sobhi = recordingCatalog.recitations.reciters.find(reciter => reciter.id === 9001)!;
        assert.equal(sobhi.chapters.length, 105); assert.ok(sobhi.chapters.includes(94)); assert.ok(!sobhi.chapters.includes(109));
        assert.equal(recordingCatalog.recitations.reciters.find(reciter => reciter.id === 174)!.chapters.length, 114);
        const externalFetch = mock.method(service.media, 'importUrl', async () => { throw new Error('Public recipes must not download audio'); });
        try {
          const link = await client.callTool({ name: 'create_video_link', arguments: { recipe: { chapter: 94, from: 1, to: 8, reciterId: 9001, background: 'dark-gray' } } });
          assert.equal(link.isError, undefined);
          const result = (link.structuredContent as { result: { url: string; reciter: string; duration: number } }).result;
          assert.equal(result.reciter, 'Islam Sobhi'); assert.ok(result.duration > 0 && result.duration < 600);
          assert.equal(decodeRecipeFragment(new URL(result.url).hash).reciterId, 9001);
          const production = await client.callTool({ name: 'create_video_link', arguments: { recipe: { chapter: 15, from: 1, to: 2, reciterId: 174 } } });
          assert.equal(production.isError, undefined);
          assert.match((production.structuredContent as { result: { reciter: string } }).result.reciter, /Yasser/);
          const missing = await client.callTool({ name: 'create_video_link', arguments: { recipe: { chapter: 109, from: 1, to: 6, reciterId: 9001 } } });
          assert.equal(missing.isError, true); assert.equal(externalFetch.mock.callCount(), 0);
        } finally { externalFetch.mock.restore(); }
      });
      assert.equal((catalog.structuredContent as { result: { chapters: unknown[] } }).result.chapters.length, 114);
      const publicCatalog = (catalog.structuredContent as { result: { backgrounds: string[]; templates: unknown[]; customColor: { example: string } } }).result;
      assert.ok(publicCatalog.backgrounds.includes('dark-gray')); assert.equal(publicCatalog.templates.length, 10); assert.equal(publicCatalog.customColor.example, '#272727');
      const response = await client.callTool({ name: 'create_video_link', arguments: { recipe: { chapter: 1, from: 2, to: 3, name: 'Anonymous recipe' } } });
      assert.equal(response.isError, undefined);
      const result = (response.structuredContent as { result: { url: string; duration: number } }).result;
      assert.equal(result.duration, 10.21);
      const url = new URL(result.url); assert.equal(url.origin, base); assert.equal(url.pathname, '/'); assert.equal(url.search, '');
      assert.equal(decodeRecipeFragment(url.hash).name, 'Anonymous recipe');
      assert.ok(result.url.length < 180);
      const resource = response.content as { type: string; uri?: string }[];
      assert.equal(resource[0].type, 'resource_link'); assert.equal(resource[0].uri, result.url);
      for (const settings of [{ background: 'dark-gray' }, { backgroundColor: '#445566' }, { template: 'ivory' }, { template: 'charcoal', translationFont: 'monospace', showTitle: false }]) {
        const response = await client.callTool({ name: 'create_video_link', arguments: { recipe: { chapter: 1, from: 2, to: 3, ...settings } } });
        assert.equal(response.isError, undefined);
        const url = new URL((response.structuredContent as { result: { url: string } }).result.url);
        const recipe = decodeRecipeFragment(url.hash);
        assert.equal(recipe.motion, 'none'); assert.equal(recipe.dim, 0);
        if ('backgroundColor' in settings) assert.equal(recipe.backgroundColor, '#445566');
        if ('template' in settings) assert.equal(recipe.template, settings.template);
        if ('translationFont' in settings) { assert.equal(recipe.translationFont, 'monospace'); assert.equal(recipe.showTitle, false); }
      }
      for (const recipe of [{ chapter: 109, from: 1, to: 6, reciterId: 9001 }, { chapter: 1, from: 1, to: 8 }, { chapter: 1, from: 1, to: 2, url: 'https://example.com/a.mp3' }, { chapter: 2, from: 1, to: 100 }]) {
        const invalid = await client.callTool({ name: 'create_video_link', arguments: { recipe } }); assert.equal(invalid.isError, true);
      }
      const denied = await client.callTool({ name: 'list_projects', arguments: {} }); assert.equal(denied.isError, true);
      assert.equal((await fetch(base + '/mcp')).status, 401);
      assert.equal((await fetch(base + '/api/projects')).status, 401);
      assert.deepEqual(await snapshot(), before);
    } finally { await client.close(); }
    assert.equal((await fetch(base + '/mcp/public', { method: 'OPTIONS', headers: { Origin: 'https://chatgpt.com' } })).status, 204);
    assert.equal((await fetch(base + '/mcp/public', { headers: { Origin: 'https://other.example' } })).status, 403);
    assert.equal((await fetch(base + '/mcp/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ large: 'a'.repeat(33000) }) })).status, 413);
  });

  it('keeps Openverse search credits and re-fetches provider metadata before import', async () => {
    const id = '10000000-0000-4000-8000-000000000001'; const urls: string[] = [];
    const source = { id, title: 'Forest rain', creator: 'Example creator', url: 'https://8.8.8.8/rain.mp3', foreign_landing_url: 'https://example.com/rain', license: 'by', license_url: 'https://creativecommons.org/licenses/by/4.0/', duration: 12000 };
    const media = new MediaService(service.store, serverConfig({ QURANVID_API_KEY: key, QURANVID_PUBLIC_URL: base }), async url => { urls.push(url); return url.includes(`/${id}/`) ? source : { results: [source] }; });
    const results = await media.search('audio', 'rain', 3); assert.equal(results[0].creator, source.creator); assert.equal(results[0].sourceUrl, source.foreign_landing_url);
    assert.equal(new URL(urls[0]).searchParams.get('license'), 'cc0,pdm,by,by-sa');
    const imported = mock.method(media, 'importUrl', async (request: ImportRequest) => { assert.equal(request.attribution?.license, 'by'); assert.equal(request.attribution?.creator, source.creator); assert.equal(request.start, 2); return { id } as never; });
    try { await media.importOpenverse('audio', id, 2, 4); assert.ok(urls[1].endsWith(`/${id}/`)); } finally { imported.mock.restore(); }
  });

  it('imports a prepared reciter with exact verse timings and no sample audio left over', async () => {
    const bytes = await readFile('public/audio/al-fatihah-alafasy.mp3');
    const request = mock.method(https, 'get', ((_url: URL, _options: unknown, callback: (response: unknown) => void) => {
      const response = new PassThrough(); Object.assign(response, { statusCode: 200, headers: { 'content-length': String(bytes.length) } });
      queueMicrotask(() => { callback(response); response.end(bytes); }); return Object.assign(new EventEmitter(), { setTimeout() { return this; } });
    }) as unknown as typeof https.get);
    const original = service.media.importUrl.bind(service.media);
    const download = mock.method(service.media, 'importUrl', (input: ImportRequest) => original({ ...input, url: 'https://8.8.8.8/recitation.mp3' }));
    try {
      const response = await call('/api/projects', { method: 'POST', body: JSON.stringify({ chapter: 1, from: 2, to: 3, reciterId: 7 }) });
      assert.equal(response.status, 201); const record = await response.json();
      assert.equal(record.project.verses[0].start, 0); assert.equal(record.project.verses[0].key, '1:2');
      assert.ok(Math.abs(record.project.duration - (16.3 - 6.09)) < .001);
      assert.equal(record.project.audio.length, 1); assert.equal(record.project.audio[0].recitation, true);
      assert.notEqual(record.project.audio[0].assetId, 'sample-alafasy');
      const edited = await call(`/api/projects/${record.id}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: 1, audio: record.project.audio }) });
      assert.equal(edited.status, 200); const next = await edited.json(); assert.equal(next.project.audio[0].id, record.project.audio[0].id); assert.equal(next.project.audio[0].recitation, true);
    } finally { download.mock.restore(); request.mock.restore(); }
  });

  it('completes OAuth PKCE, rejects bad verifiers/replay and rotates refresh tokens', async () => {
    const client = await (await fetch(base + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://chatgpt.com' }, body: JSON.stringify({ client_name: 'Test connection', redirect_uris: ['https://example.com/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })).json();
    assert.ok(client.client_id);
    const verifier = 'A'.repeat(50), challenge = createHash('sha256').update(verifier).digest('base64url');
    const query = new URLSearchParams({ client_id: client.client_id, response_type: 'code', redirect_uri: 'https://example.com/callback', code_challenge: challenge, code_challenge_method: 'S256', state: 'test-state', scope: 'quranvid', resource: base + '/mcp' });
    const authorizationPage = await fetch(base + '/authorize?' + query, { headers: { Origin: 'https://chatgpt.com' } });
    assert.equal(authorizationPage.headers.get('referrer-policy'), 'same-origin');
    assert.equal(authorizationPage.headers.get('cache-control'), 'no-store');
    assert.ok(authorizationPage.headers.get('content-security-policy')?.includes("form-action 'self' https://example.com;"));
    const html = await authorizationPage.text(); assert.ok(!html.includes(key));
    const request = html.match(/name="request" value="([^"]+)"/)![1];
    const approved = await fetch(base + '/oauth/approve', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base }, body: new URLSearchParams({ request, key }) });
    assert.equal(approved.status, 303); const redirect = new URL(approved.headers.get('location')!); assert.equal(redirect.searchParams.get('state'), 'test-state');
    const exchange = (values: Record<string, string>) => fetch(base + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://chatgpt.com' }, body: new URLSearchParams({ client_id: client.client_id, ...values }) });
    const code = redirect.searchParams.get('code')!;
    assert.equal((await exchange({ grant_type: 'authorization_code', code, code_verifier: 'B'.repeat(50), redirect_uri: 'https://example.com/callback' })).status, 400);
    const response = await exchange({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: 'https://example.com/callback' }); assert.equal(response.status, 200); const tokens = await response.json();
    assert.equal((await call('/api/projects', { headers: { Authorization: `Bearer ${tokens.access_token}` } })).status, 200);
    assert.equal((await exchange({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: 'https://example.com/callback' })).status, 400);
    const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }); assert.equal(refreshed.status, 200);
    assert.equal((await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).status, 400);
  });
});
