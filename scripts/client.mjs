import { readFile } from 'node:fs/promises';

try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const base = process.env.QURANVID_PUBLIC_URL ?? 'http://localhost:4310';
const key = process.env.QURANVID_API_KEY;
if (!key) throw new Error('Set QURANVID_API_KEY or run npm run server:setup.');
const [command, ...args] = process.argv.slice(2);
let endpoint, method = 'GET', body, contentType = 'application/json';
if (command === 'catalog') endpoint = '/api/catalog';
else if (command === 'list') endpoint = '/api/projects';
else if (command === 'get') endpoint = `/api/projects/${encodeURIComponent(args[0])}`;
else if (command === 'create') { endpoint = '/api/projects'; method = 'POST'; body = args[0]; }
else if (command === 'edit') { endpoint = `/api/projects/${encodeURIComponent(args[0])}`; method = 'PATCH'; body = args[1]; }
else if (command === 'search') endpoint = `/api/media/search?${new URLSearchParams({ type: args[0], query: args.slice(1).join(' ') })}`;
else if (command === 'import') { endpoint = '/api/media/import'; method = 'POST'; body = args[0]; }
else if (command === 'link') { endpoint = `/api/projects/${encodeURIComponent(args[0])}/links`; method = 'POST'; body = '{}'; }
else if (command === 'upload') { endpoint = `/api/media/upload?${new URLSearchParams({ type: args[0], name: args[1]?.split('/').at(-1) ?? 'Upload' })}`; method = 'POST'; body = await readFile(args[1]); contentType = 'application/octet-stream'; }
else { console.log('Commands: catalog | list | get ID | create JSON | edit ID JSON | search image|audio QUERY | import JSON | upload image|audio|video FILE | link ID'); process.exit(1); }
try {
  const response = await fetch(new URL(endpoint, base), { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': contentType }, body, signal: AbortSignal.timeout(300000) });
  console.log(JSON.stringify(await response.json(), null, 2)); if (!response.ok) process.exitCode = 1;
} catch { console.error('Could not reach the companion service. Check QURANVID_PUBLIC_URL and that npm run server is running.'); process.exitCode = 1; }
