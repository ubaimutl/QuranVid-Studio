import path from 'node:path';

export type ServerConfig = {
  root: string; dataDir: string; publicUrl: URL; apiKey: string; host: string; port: number;
  maxAssetBytes: number; maxStorageBytes: number; openverseToken?: string;
  proxyMode: 'none' | 'reverse-proxy' | 'cloudflare-tunnel';
  mcpOrigins: string[];
};
export function serverConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const publicUrl = new URL(env.QURANVID_PUBLIC_URL ?? 'http://localhost:4310');
  if ((publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(publicUrl.hostname)))
    || publicUrl.pathname !== '/' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) throw new Error('QURANVID_PUBLIC_URL must be an HTTPS origin (localhost HTTP is allowed).');
  const apiKey = env.QURANVID_API_KEY ?? '';
  if (apiKey.length < 32) throw new Error('Set QURANVID_API_KEY to a random value of at least 32 characters. Run npm run server:setup.');
  const proxyMode = env.QURANVID_PROXY_MODE ?? 'none';
  if (!['none', 'reverse-proxy', 'cloudflare-tunnel'].includes(proxyMode)) throw new Error('QURANVID_PROXY_MODE must be none, reverse-proxy or cloudflare-tunnel.');
  const mcpOrigins = [...new Set((env.QURANVID_MCP_ALLOWED_ORIGINS ?? 'https://chatgpt.com,https://chat.openai.com').split(',').map(value => value.trim()).filter(Boolean).map(value => {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('QURANVID_MCP_ALLOWED_ORIGINS must contain HTTPS origins (localhost HTTP is allowed).');
    return url.origin;
  }))];
  const dataDir = path.resolve(env.QURANVID_DATA_DIR ?? './.quranvid-server');
  for (const exposed of ['out', 'public']) {
    const relative = path.relative(path.resolve(exposed), dataDir);
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error('QURANVID_DATA_DIR must be outside the public and out directories.');
  }
  const number = (value: string | undefined, fallback: number) => {
    const result = value === undefined ? fallback : Number(value);
    if (!Number.isSafeInteger(result) || result <= 0) throw new Error('Server limits must be positive integers.');
    return result;
  };
  return { root: process.cwd(), dataDir, publicUrl, apiKey, proxyMode: proxyMode as ServerConfig['proxyMode'], mcpOrigins,
    host: env.QURANVID_HOST ?? '127.0.0.1', port: number(env.QURANVID_PORT, 4310),
    maxAssetBytes: number(env.QURANVID_MAX_ASSET_MB, 200) * 1024 ** 2,
    maxStorageBytes: number(env.QURANVID_MAX_STORAGE_MB, 2048) * 1024 ** 2,
    openverseToken: env.OPENVERSE_ACCESS_TOKEN || undefined };
}
