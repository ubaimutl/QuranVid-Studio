import { readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

let source = '';
try { source = await readFile('.env', 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!/^QURANVID_API_KEY=.+$/m.test(source)) {
  source = source.replace(/^QURANVID_API_KEY=.*\n?/m, '');
  source += `\nQURANVID_API_KEY=${randomBytes(32).toString('base64url')}\n`;
}
if (!/^QURANVID_PUBLIC_URL=/m.test(source)) source += 'QURANVID_PUBLIC_URL=http://localhost:4310\n';
await writeFile('.env', source, { mode: 0o600 }); await chmod('.env', 0o600);
console.log('Server access key configured in .env. Existing credentials were preserved. No credential values were printed.');
