import express, { type Request, type Response, type NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import * as z from 'zod/v4';
import path from 'node:path';
import { isIP } from 'node:net';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ServerConfig } from './config';
import { ApiError, Store, type StoredAsset } from './store';
import { ProjectService } from './projects';
import { MediaService } from './media';
import { AuthProvider } from './auth';
import { createMcp, importMedia } from './mcp';
import { createPublicMcp, publicRecipes } from './public-mcp';
import { createInput, editInput, importInput, linkInput, searchInput } from './schemas';

const discoveryAliases: Record<string, string> = {
  '/.well-known/oauth-protected-resource': '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server/mcp': '/.well-known/oauth-authorization-server',
};

export async function createApp(config: ServerConfig) {
  const store = new Store(config.dataDir); await store.initialize();
  const media = new MediaService(store, config), projects = await ProjectService.initialize(store, config, media);
  const recipes = await publicRecipes(config.root, config.publicUrl.origin);
  const auth = new AuthProvider(store, config), app = express(); app.disable('x-powered-by');
  let originLogWindow = 0, originLogCount = 0;
  // These modes require a private listener behind exactly one trusted reverse proxy.
  // Tunnel requests carry Cloudflare's authoritative visitor IP even when Traefik
  // replaces the original forwarding chain with the tunnel's local address.
  if (config.proxyMode !== 'none') app.set('trust proxy', 1);
  if (config.proxyMode === 'cloudflare-tunnel') app.use((req, res, next) => {
    const visitor = req.headers['cf-connecting-ip'];
    if (visitor !== undefined) {
      if (typeof visitor !== 'string' || !isIP(visitor)) return res.status(400).json({ error: 'Invalid proxy client address.' });
      req.headers['x-forwarded-for'] = visitor;
    }
    next();
  });
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    if (req.headers.host !== config.publicUrl.host && req.headers.host !== `localhost:${config.port}` && req.headers.host !== `127.0.0.1:${config.port}`) return res.status(421).json({ error: 'Unexpected server hostname.' });
    const origin = req.headers.origin;
    const requestPath = req.path.replace(/\/$/, '');
    const protocolEndpoint = ['/mcp', '/mcp/public', '/authorize', '/token', '/register', '/revoke', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp', ...Object.keys(discoveryAliases)].includes(requestPath);
    if (origin && origin !== config.publicUrl.origin) {
      if (!protocolEndpoint || !config.mcpOrigins.includes(origin)) {
        let safeOrigin = 'invalid-origin';
        try { safeOrigin = new URL(origin).origin; } catch { /* Do not echo malformed header contents. */ }
        const endpoint = protocolEndpoint ? 'mcp-oauth' : requestPath.startsWith('/api') ? 'editor-api' : 'site';
        // Exclude paths, query strings, authorization headers and project-link tokens.
        if (Date.now() - originLogWindow >= 60000) { originLogWindow = Date.now(); originLogCount = 0; }
        if (originLogCount++ < 20) console.warn('Rejected request origin:', JSON.stringify({ origin: safeOrigin, endpoint }));
        return res.status(403).json({ error: 'This origin is not allowed.', origin: safeOrigin, endpoint,
          hint: protocolEndpoint ? 'This browser origin is not in QURANVID_MCP_ALLOWED_ORIGINS.' : `Use ${config.publicUrl.origin}/mcp as the MCP server URL.` });
      }
      res.vary('Origin');
      res.set({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID',
        'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Session-Id, MCP-Protocol-Version' });
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });
  app.use(['/api', '/mcp', '/oauth'], rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use('/mcp/public', express.json({ limit: '32kb' }));
  app.use(express.json({ limit: '2mb' })); app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.get('/health', (_req, res) => res.json({ service: 'QuranVid', status: 'ok', version: 1 }));
  app.post('/oauth/approve', (req, res) => auth.approve(req, res));
  app.use((req, _res, next) => {
    const target = discoveryAliases[req.path.replace(/\/$/, '')];
    if (target) req.url = target + req.url.slice(req.path.length);
    next();
  });
  app.use(mcpAuthRouter({ provider: auth, issuerUrl: config.publicUrl, resourceServerUrl: new URL('/mcp', config.publicUrl), scopesSupported: ['quranvid'], resourceName: 'QuranVid projects and media' }));
  const protect = requireBearerAuth({ verifier: auth, requiredScopes: ['quranvid'], expectedResource: new URL('/mcp', config.publicUrl), resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', config.publicUrl).href });
  const sendMedia = (res: Response, asset: StoredAsset) => {
    res.type(asset.mime); res.set('Cache-Control', 'private, no-store'); res.sendFile(asset.filename, { root: path.join(config.dataDir, 'files') });
  };
  app.get('/api/handoffs/:token', async (req, res) => {
    const handoff = await projects.handoff(req.params.token);
    const assets = await Promise.all(handoff.assetIds.map(id => store.get<StoredAsset>('assets', id)));
    res.set('Cache-Control', 'no-store').json({ project: handoff.project.project, revision: handoff.project.revision, expiresAt: new Date(handoff.expiresAt).toISOString(),
      media: assets.map(({ id, name, type, duration, bytes, attribution }) => ({ id, name, type, duration, bytes, attribution, url: `/api/handoffs/${req.params.token}/media/${id}` })) });
  });
  app.get('/api/handoffs/:token/media/:id', async (req, res) => { const handoff = await projects.handoff(req.params.token); if (!handoff.assetIds.includes(req.params.id)) throw new ApiError(404, 'This media is not part of the project link.'); sendMedia(res, await store.get('assets', req.params.id)); });
  app.use('/api', protect, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/catalog', (_req, res) => res.json(projects.catalog()));
  app.get('/api/schema', (_req, res) => res.json({ create: z.toJSONSchema(createInput), edit: z.toJSONSchema(editInput), import: z.toJSONSchema(importInput), search: z.toJSONSchema(searchInput) }));
  app.get('/api/projects', async (_req, res) => res.json({ projects: await projects.list() }));
  app.post('/api/projects', async (req, res) => res.status(201).json(await projects.create(createInput.parse(req.body))));
  app.get('/api/projects/:id', async (req, res) => { const record = await projects.get(req.params.id); res.json({ ...record, assets: await projects.assets(record.project) }); });
  app.patch('/api/projects/:id', async (req, res) => res.json(await projects.edit(editInput.parse({ ...req.body, projectId: req.params.id }))));
  app.post('/api/projects/:id/links', async (req, res) => { const input = linkInput.parse({ ...req.body, projectId: req.params.id }); res.status(201).json(await projects.createLink(input.projectId, input.hours)); });
  app.delete('/api/links/:id', async (req, res) => { const link = await store.get('handoffs', req.params.id); await store.put('handoffs', req.params.id, { ...(link as object), expiresAt: 0 }); res.json({ revoked: true }); });
  app.get('/api/media/search', async (req, res) => { const input = searchInput.parse({ ...req.query, limit: req.query.limit === undefined ? undefined : Number(req.query.limit) }); res.json({ results: await media.search(input.type, input.query, input.limit) }); });
  app.post('/api/media/import', async (req, res) => res.status(201).json(await importMedia(media, importInput.parse(req.body))));
  app.post('/api/media/upload', async (req, res) => {
    const type = z.enum(['image', 'audio', 'video']).parse(req.query.type);
    if (req.is('json') || req.is('urlencoded')) throw new ApiError(400, 'Send the raw file body with its media Content-Type.');
    res.status(201).json(await media.upload(req, type, typeof req.query.name === 'string' ? req.query.name : undefined));
  });
  app.get('/api/assets/:id', async (req, res) => res.json(await store.get('assets', req.params.id)));
  app.get('/api/assets/:id/file', async (req, res) => sendMedia(res, await store.get('assets', req.params.id)));
  app.all('/mcp/public', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const server = createPublicMcp(recipes);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport); await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', protect, async (req, res) => {
    const server = createMcp(projects, media);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport); await transport.handleRequest(req, res, req.body);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use(express.static(path.join(config.root, 'out'), { dotfiles: 'deny', index: 'index.html' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) { res.end(); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Invalid request parameters.', issues: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) }); return; }
    if (error instanceof ApiError) { res.status(error.status).json({ error: error.message }); return; }
    const status = (error as { status?: number })?.status;
    res.status(status === 413 ? 413 : 500).json({ error: status === 413 ? 'Request too large.' : 'The operation failed. Check the request and server setup.' });
  });
  return { app, store, media, projects, auth };
}
