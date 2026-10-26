import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_CONTENT } from './content-files.mjs';
export async function missingContent(root) {
  return (await Promise.all(REQUIRED_CONTENT.map(async name => { try { await access(path.join(root, name)); return null; } catch { return name; } }))).filter(Boolean);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const missing = await missingContent(root);
  if (missing.length) {
    console.error('QuranVid needs locally prepared content. Public source releases intentionally omit third-party text, timing catalogs and audio.');
    console.error('Missing files:\n' + missing.map(name => `  ${name}`).join('\n'));
    console.error('See docs/CONTENT-SETUP.md. Use npm run prepare:content -- --from=/path/to/permitted-content, or --download after reviewing provider terms.');
    process.exitCode = 1;
  } else {
    const catalog = JSON.parse(await readFile(path.join(root, 'public/data/recitations/catalog.json'), 'utf8'));
    console.log(`Prepared content found (${catalog.reciters?.length ?? 0} reciters). Provider rights remain separate from the MIT code license.`);
  }
}
