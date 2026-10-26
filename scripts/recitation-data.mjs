// Keep provider data intact. Small boundary overlaps are tolerated; larger
// overlaps cannot be repaired reliably without reviewing the source recording.
export const MAX_BOUNDARY_OVERLAP_SECONDS = .1;

export function normalizeRecording(audio, reciterId, chapter, expected) {
  const url = new URL(audio.audio_url);
  if (url.protocol !== 'https:' || url.search || url.username || url.password || !/\.mp3$/i.test(url.pathname)) throw new Error('No public MP3 recording available.');
  if (audio.chapter_id !== chapter) throw new Error('The recording belongs to another chapter.');
  if (!Array.isArray(audio.timestamps) || audio.timestamps.some(t => !t || typeof t.timestamp_from !== 'number' || typeof t.timestamp_to !== 'number')) throw new Error('Complete, ordered verse timings are unavailable.');
  const timings = (audio.timestamps ?? []).map(t => ({ key: t.verse_key, start: t.timestamp_from / 1000, end: t.timestamp_to / 1000 }));
  if (timings.length !== expected || timings.some((t, i) => t.key !== `${chapter}:${i + 1}`
      || !Number.isFinite(t.start) || !Number.isFinite(t.end) || t.start < 0 || t.end <= t.start
      || (i > 0 && (t.start < timings[i - 1].start || t.end < timings[i - 1].end
        || timings[i - 1].end - t.start > MAX_BOUNDARY_OVERLAP_SECONDS + .000001)))) {
    throw new Error('Complete, ordered verse timings without significant overlaps are unavailable.');
  }
  return { version: 1, reciterId, chapter, audioUrl: url.href, timings };
}
