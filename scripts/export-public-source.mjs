import { mkdir, readdir, copyFile, lstat, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { excludedFromPublicSource } from './content-files.mjs';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const RELEASE_FOLDERS = ['app', 'components', 'lib', 'public', 'scripts', 'server', 'tests', 'docs', 'third-party'];
export const RELEASE_FILES = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'SECURITY.md', '.gitignore', '.gitattributes', '.env.example', '.dockerignore', 'Dockerfile', 'compose.yaml', 'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'next-env.d.ts', 'playwright.config.ts'];
export async function exportPublicSource(destination, root = ROOT) {
  const output = path.resolve(destination);
  if (output === path.resolve(root) || output.startsWith(path.resolve(root) + path.sep)) throw new Error('Export to a new directory outside the working repository.');
  try { await access(output); throw new Error('Destination already exists; nothing was overwritten.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(output, { recursive: true });
  const copy = async name => {
    if (excludedFromPublicSource(name)) return;
    const source = path.join(root, name), dest = path.join(output, name), stat = await lstat(source);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not permitted in a source release: ${name}`);
    if (stat.isDirectory()) { await mkdir(dest, { recursive: true }); for (const entry of await readdir(source)) await copy(`${name}/${entry}`); }
    else if (stat.isFile()) { await mkdir(path.dirname(dest), { recursive: true }); await copyFile(source, dest); }
  };
  for (const name of [...RELEASE_FOLDERS, ...RELEASE_FILES]) { try { await copy(name); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  console.log(`Clean source exported to ${output}. No Git history, local content or secrets were copied. Run audit:public before publishing.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
  if (!output) { console.error('Usage: npm run export:public -- --output=/new/absolute/directory'); process.exitCode = 1; }
  else try { await exportPublicSource(output); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
