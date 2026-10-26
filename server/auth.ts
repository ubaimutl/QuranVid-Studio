import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidGrantError, InvalidTokenError, InvalidRequestError, InvalidScopeError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { ApiError, Store } from './store';
import type { ServerConfig } from './config';
import { tokenHash } from './projects';

const secret = () => randomBytes(32).toString('base64url');
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
type Grant = { type: 'code' | 'access' | 'refresh'; clientId: string; scopes: string[]; expiresAt: number; used?: boolean; params?: AuthorizationParams & { resource?: never } };
export class AuthProvider implements OAuthServerProvider {
  private pending = new Map<string, { clientId: string; params: AuthorizationParams; expiresAt: number }>();
  constructor(private store: Store, private config: ServerConfig) {}
  matchesKey(key: string) {
    const digest = (value: string) => createHash('sha256').update(value).digest();
    return timingSafeEqual(digest(key), digest(this.config.apiKey));
  }
  get clientsStore() {
    return {
      getClient: async (id: string): Promise<OAuthClientInformationFull | undefined> => {
        if (!/^[a-f\d-]{36}$/.test(id)) return undefined;
        try { return await this.store.get<OAuthClientInformationFull>('oauth', id); } catch { return undefined; }
      },
      registerClient: async (input: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>): Promise<OAuthClientInformationFull> => {
        if (!input.redirect_uris.length || input.redirect_uris.length > 10 || input.redirect_uris.some(uri => {
          const url = new URL(uri); return url.hash || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
        })) throw new InvalidRequestError('Use HTTPS redirect URLs or localhost HTTP.');
        const client = { ...input, client_id: randomUUID(), client_id_issued_at: Math.floor(Date.now() / 1000), token_endpoint_auth_method: 'none', client_secret: undefined };
        await this.store.exclusive(async () => { if ((await this.store.list('oauth')).length >= 10000) throw new InvalidRequestError('Registration storage is full.'); await this.store.put('oauth', client.client_id, client); });
        return client;
      },
    };
  }
  private resource(resource?: URL) {
    if (resource && resource.href.replace(/\/$/, '') !== `${this.config.publicUrl.origin}/mcp`) throw new InvalidRequestError('This authorization is only valid for QuranVid MCP.');
  }
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    this.resource(params.resource);
    if (params.scopes?.some(scope => scope !== 'quranvid')) throw new InvalidScopeError('Only the quranvid scope is supported.');
    for (const [key, value] of this.pending) if (value.expiresAt < Date.now()) this.pending.delete(key);
    if (this.pending.size >= 200) throw new InvalidRequestError('Too many pending connections.');
    const id = secret(); this.pending.set(id, { clientId: client.client_id, params, expiresAt: Date.now() + 600000 });
    // Some browsers apply form-action to the post-approval redirect too. This
    // destination was already checked against the client's registered URI.
    const callbackOrigin = new URL(params.redirectUri).origin;
    res.setHeader('Content-Security-Policy', `default-src 'none'; form-action 'self' ${callbackOrigin}; frame-ancestors 'none'; base-uri 'none'`);
    // A navigate-mode form POST under no-referrer sends Origin: null. Preserve
    // same-origin form provenance without disclosing this URL to the callback.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect QuranVid</title><main><h1>Connect QuranVid</h1><p><strong>${escape(client.client_name ?? 'This client')}</strong> requests access to your projects and media.</p><p>It will be able to create and edit drafts, import external media, and make project links.</p><form method="post" action="/oauth/approve"><input type="hidden" name="request" value="${id}"><label>Server access key <input type="password" name="key" required autocomplete="off" maxlength="512"></label><button type="submit">Connect</button></form><p>Only continue if you requested this connection. Closing this page cancels it.</p></main></html>`);
  }
  async approve(req: Request, res: Response) {
    const request = String(req.body.request ?? ''), pending = this.pending.get(request); this.pending.delete(request);
    if (!pending || pending.expiresAt < Date.now()) throw new ApiError(400, 'The connection request expired. Start the connection again.');
    if (!this.matchesKey(String(req.body.key ?? ''))) throw new ApiError(403, 'The server access key is incorrect.');
    const code = secret(); const { resource: _resource, ...params } = pending.params;
    await this.store.put('oauth', tokenHash(code), { type: 'code', clientId: pending.clientId, scopes: ['quranvid'], params, expiresAt: Date.now() + 120000 } satisfies Grant);
    const destination = new URL(pending.params.redirectUri); destination.searchParams.set('code', code);
    if (pending.params.state) destination.searchParams.set('state', pending.params.state);
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(303, destination.href);
  }
  private async grant(token: string, type: Grant['type'], clientId?: string) {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new InvalidGrantError('Invalid credential.');
    let grant: Grant;
    try { grant = await this.store.get('oauth', tokenHash(token)); } catch { throw new InvalidGrantError('Invalid credential.'); }
    if (grant.type !== type || grant.used || grant.expiresAt < Date.now() || (clientId && grant.clientId !== clientId)) throw new InvalidGrantError('Expired or invalid credential.');
    return grant;
  }
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string) { return (await this.grant(code, 'code', client.client_id)).params!.codeChallenge; }
  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string, resource?: URL) {
    this.resource(resource);
    return this.store.exclusive(async () => {
      const grant = await this.grant(code, 'code', client.client_id);
      if (redirectUri !== grant.params?.redirectUri) throw new InvalidGrantError('Redirect URL mismatch.');
      await this.store.put('oauth', tokenHash(code), { ...grant, used: true });
      return this.tokens(client.client_id);
    });
  }
  private async tokens(clientId: string): Promise<OAuthTokens> {
    const access = secret(), refresh = secret();
    await this.store.put('oauth', tokenHash(access), { type: 'access', clientId, scopes: ['quranvid'], expiresAt: Date.now() + 3600000 } satisfies Grant);
    await this.store.put('oauth', tokenHash(refresh), { type: 'refresh', clientId, scopes: ['quranvid'], expiresAt: Date.now() + 30 * 86400000 } satisfies Grant);
    return { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh, scope: 'quranvid' };
  }
  async exchangeRefreshToken(client: OAuthClientInformationFull, token: string, scopes?: string[], resource?: URL) {
    this.resource(resource); if (scopes?.some(scope => scope !== 'quranvid')) throw new InvalidScopeError('Invalid scope.');
    return this.store.exclusive(async () => { const grant = await this.grant(token, 'refresh', client.client_id); await this.store.put('oauth', tokenHash(token), { ...grant, used: true }); return this.tokens(client.client_id); });
  }
  async verifyAccessToken(token: string) {
    if (this.matchesKey(token)) return { token, clientId: 'owner', scopes: ['quranvid'], expiresAt: Math.floor(Date.now() / 1000) + 3600, resource: new URL('/mcp', this.config.publicUrl) };
    try { const grant = await this.grant(token, 'access'); return { token, clientId: grant.clientId, scopes: grant.scopes, expiresAt: Math.floor(grant.expiresAt / 1000), resource: new URL('/mcp', this.config.publicUrl) }; }
    catch { throw new InvalidTokenError('Invalid or expired access token.'); }
  }
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    try { const record = await this.store.get<Grant>('oauth', tokenHash(request.token)); if (record.clientId === client.client_id) await this.store.put('oauth', tokenHash(request.token), { ...record, used: true }); } catch { /* Unknown tokens are already revoked. */ }
  }
}
