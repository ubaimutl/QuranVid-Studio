import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRecording } from './recitation-data.mjs';

// This script runs locally or in CI. It must never be imported by application code.
try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const environment = process.env.QF_ENV || 'prelive';
if (!['prelive', 'production'].includes(environment)) throw new Error('QF_ENV must be prelive or production.');
const clientId = process.env.QF_CLIENT_ID;
const secret = process.env.QF_CLIENT_SECRET_FILE ? (await fs.readFile(process.env.QF_CLIENT_SECRET_FILE, 'utf8')).trim() : process.env.QF_CLIENT_SECRET;
if (!clientId || !secret) throw new Error('Set QF_CLIENT_ID and QF_CLIENT_SECRET, or QF_CLIENT_SECRET_FILE.');
const auth = environment === 'production' ? 'https://oauth2.quran.foundation' : 'https://prelive-oauth2.quran.foundation';
const api = environment === 'production' ? 'https://apis.quran.foundation' : 'https://apis-prelive.quran.foundation';
const chapters = JSON.parse(await fs.readFile('public/data/chapters.json', 'utf8'));
const chapterOption = process.argv.find(arg => arg.startsWith('--chapters='))?.split('=')[1];
const requested = chapterOption ? chapterOption.split(',').map(Number) : environment === 'prelive' ? [1, 2] : chapters.map(c => c.id);
if (requested.some(id => !chapters.some(c => c.id === id))) throw new Error('Invalid chapter selection.');
const reciterOption = process.argv.find(arg => arg.startsWith('--reciters='))?.split('=')[1];
const wantedReciters = reciterOption?.split(',').map(Number);
const output = process.argv.find(arg => arg.startsWith('--output-dir='))?.slice('--output-dir='.length) || 'public/data/recitations';

async function request(url, options = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(45000) });
    if (response.ok) return response.json();
    if (attempt >= 3 || ![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`Quran Foundation returned HTTP ${response.status}. Check the selected environment and app permissions.`);
    const retryAfter = Number(response.headers.get('retry-after'));
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, Math.min(60000, Math.max(1000 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0))));
  }
}

try {
  const token = await request(`${auth}/oauth2/token`, {
    method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=content',
  });
  if (typeof token.access_token !== 'string') throw new Error('Authentication did not return an access token.');
  const headers = { 'x-auth-token': token.access_token, 'x-client-id': clientId };
  const { reciters } = await request(`${api}/content/api/v4/resources/chapter_reciters?language=en`, { headers });
  const selected = reciters.filter(r => (!wantedReciters || wantedReciters.includes(r.id)) && (!r.qirat?.name || /^hafs$/i.test(r.qirat.name)));
  const catalog = { version: 1, generatedAt: new Date().toISOString(), environment, reciters: [] };
  for (const reciter of selected) {
    const entry = { id: reciter.id, name: reciter.name, style: reciter.style?.name ?? '', chapters: [] };
    for (const chapter of requested) {
      try {
        const { audio_file: audio } = await request(`${api}/content/api/v4/chapter_recitations/${reciter.id}/${chapter}?segments=true`, { headers });
        const expected = chapters.find(c => c.id === chapter).count;
        const recording = normalizeRecording(audio, reciter.id, chapter, expected);
        await fs.mkdir(path.join(output, String(reciter.id)), { recursive: true });
        await fs.writeFile(path.join(output, String(reciter.id), `${chapter}.json`), JSON.stringify(recording));
        entry.chapters.push(chapter);
        console.log(`Prepared ${reciter.name}, chapter ${chapter}: ${recording.timings.length} verse timings.`);
      } catch (error) {
        // Only our controlled status messages are printed. Never print responses or auth headers.
        console.log(`Skipped reciter ${reciter.id}, chapter ${chapter}: ${error instanceof Error && !error.message.includes('fetch') ? error.message : 'Connection failed.'}`);
      }
    }
    if (entry.chapters.length) catalog.reciters.push(entry);
  }
  if (!catalog.reciters.length) throw new Error('No recordings with complete timings were found. The existing catalog was preserved.');
  await fs.mkdir(output, { recursive: true });
  // Keep independently prepared providers (and unselected reciters) when refreshing QF.
  let previous;
  try { previous = JSON.parse(await fs.readFile(path.join(output, 'catalog.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  catalog.reciters = [...new Map([...(previous?.reciters ?? []), ...catalog.reciters].map(reciter => [reciter.id, reciter])).values()];
  const temporary = path.join(output, 'catalog.json.tmp');
  await fs.writeFile(temporary, JSON.stringify(catalog));
  await fs.rename(temporary, path.join(output, 'catalog.json'));
  console.log(`Catalog ready: ${catalog.reciters.length} reciters. Only public metadata was written; credentials and tokens were not saved.`);
} catch (error) {
  console.error(error instanceof Error && !error.message.includes('fetch') ? error.message : 'The Quran Foundation connection failed. No credential values were logged.');
  process.exitCode = 1;
}
