import { readFile, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { excludedFromPublicSource } from './content-files.mjs';

const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const issues = [];
const known = [];
for (const argument of process.argv.filter(arg => arg.startsWith('--secrets-from='))) {
  const file = argument.slice(15);
  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|KEY)[A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (match) { const value = match[2].replace(/^['"]|['"]$/g, ''); if (value.length >= 12) known.push(value); }
  }
}
for (const argument of process.argv.filter(arg => arg.startsWith('--secret-file='))) {
  const value = (await readFile(argument.slice(14), 'utf8')).trim(); if (value.length >= 12) known.push(value);
}
const patterns = [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bgithub_pat_[A-Za-z0-9_]{40,}\b/, /\bAKIA[A-Z0-9]{16}\b/];
const inspect = (name, data, location) => {
  if (excludedFromPublicSource(name)) issues.push(`${location}: excluded path ${name}`);
  const text = data.toString('utf8');
  if (patterns.some(pattern => pattern.test(text)) || known.some(value => text.includes(value))) issues.push(`${location}: possible credential in ${name} (value hidden)`);
};
try {
  const names = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))];
  for (const name of names) {
    try { const stat = await lstat(name); if (stat.isSymbolicLink()) issues.push(`Working tree: symlink ${name}`); else if (stat.isFile()) inspect(name, await readFile(name), 'Working tree'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  let commits = [];
  try { commits = git(['rev-list', '--all']).trim().split('\n').filter(Boolean); } catch {}
  const seen = new Set();
  for (const commit of commits) inspect('<commit metadata>', execFileSync('git', ['cat-file', 'commit', commit]), 'History');
  for (const commit of commits) for (const entry of git(['ls-tree', '-rz', commit]).split('\0').filter(Boolean)) {
    const [metadata, name] = entry.split('\t'), [, kind, hash] = metadata.split(' ');
    if (kind !== 'blob') { issues.push(`History: unexpected Git object ${name}`); continue; }
    if (seen.has(`${name}:${hash}`)) continue; seen.add(`${name}:${hash}`);
    inspect(name, execFileSync('git', ['cat-file', 'blob', hash], { maxBuffer: 32 * 1024 * 1024 }), 'History');
  }
  if (issues.length) { console.error([...new Set(issues)].join('\n')); console.error('Public-source audit failed. No credential values were printed.'); process.exitCode = 1; }
  else console.log(`Public-source audit passed: ${names.length} files, ${commits.length} commits, ${known.length} known secret values checked. Pattern scanning is not a guarantee; GitHub secret scanning is also recommended.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
