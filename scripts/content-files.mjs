export const REQUIRED_CONTENT = [
  'public/data/quran.json', 'public/data/chapters.json',
  'public/data/recitations/catalog.json', 'public/data/recitations/7/1.json',
  'lib/sample-data.json', 'public/audio/al-fatihah-alafasy.mp3',
];
// This is a source-release boundary, not a claim about any provider's rights.
export function excludedFromPublicSource(name) {
  const parts = name.replaceAll('\\', '/').split('/');
  const base = parts.at(-1);
  return parts.some(part => ['.git', '.private', '.public-release', 'node_modules', '.next', 'out', '.quranvid-server', '__pycache__', 'test-results', 'playwright-report'].includes(part))
    || (base.startsWith('.env') && base !== '.env.example')
    || /\.(?:key|pem|log|zip|pyc|tsbuildinfo)$/.test(base)
    || name === 'lib/sample-data.json'
    || /^public\/data\/.*\.json$/.test(name)
    || (name.startsWith('public/audio/') && name !== 'public/audio/SOURCES.md');
}
