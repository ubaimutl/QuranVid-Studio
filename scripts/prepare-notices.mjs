import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
const output = new URL('public/licenses/', root); await mkdir(output, { recursive: true });
const rows = [];
for (const [location, info] of Object.entries(lock.packages)) {
  if (!location || !location.startsWith('node_modules/')) continue;
  const name = location.split('node_modules/').at(-1), directory = new URL(location + '/', root);
  const row = { name, version: info.version, license: info.license ?? 'Not declared in lockfile', source: `https://www.npmjs.com/package/${name}/v/${info.version}`, notice: null };
  try {
    const files = await readdir(directory); const file = files.find(name => /^(?:LICENSE|LICENCE|COPYING)(?:\.[\w-]+)?$/i.test(name));
    if (file) { const dest = name.replaceAll('/', '__') + '-' + info.version + '.txt'; await copyFile(new URL(file, directory), new URL(dest, output)); row.notice = dest; }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  rows.push(row);
}
rows.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(new URL('dependencies.json', output), JSON.stringify(rows, null, 2) + '\n');
await copyFile(new URL('THIRD_PARTY_NOTICES.md', root), new URL('THIRD_PARTY_NOTICES.md', output));
for (const file of await readdir(new URL('third-party/licenses/', root))) await copyFile(new URL('third-party/licenses/' + file, root), new URL(file, output));
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
await writeFile(new URL('index.html', output), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QuranVid third-party licenses</title><body style="max-width:900px;margin:32px auto;padding:0 20px;font:16px/1.6 system-ui"><h1>Third-party licenses</h1><p><a href="THIRD_PARTY_NOTICES.md">Materials, source locations and codec notices</a>. Fonts retain their licenses in <code>/fonts/</code>. Content and imported media have separate rights.</p><ul>${rows.map(row => `<li>${escape(row.name)} ${escape(row.version)} — ${escape(row.license)} · <a href="${escape(row.source)}">Upstream package/source</a>${row.notice ? ` · <a href="${escape(row.notice)}">License text</a>` : ''}</li>`).join('')}</ul></body></html>`);
console.log(`Prepared notices for ${rows.length} locked dependencies. Missing platform-package text remains available from its upstream package.`);
