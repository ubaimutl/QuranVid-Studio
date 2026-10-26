import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecording } from '../scripts/recitation-data.mjs';

const audio = { chapter_id: 1, audio_url: 'https://download.quranicaudio.com/test/1.mp3', timestamps: [
  { verse_key: '1:1', timestamp_from: 0, timestamp_to: 5000 },
  { verse_key: '1:2', timestamp_from: 5000, timestamp_to: 10000 },
] };
describe('Quran Foundation recording validation', () => {
  it('converts milliseconds without changing the provider recording or minor boundary overlaps', () => {
    const input = structuredClone(audio); input.timestamps[1].timestamp_from = 4920;
    const recording = normalizeRecording(input, 7, 1, 2);
    assert.equal(recording.audioUrl, audio.audio_url); assert.equal(recording.timings[1].start, 4.92);
    assert.equal(recording.timings[0].end, 5);
  });
  it('rejects missing, repeated or out-of-order verse references', () => {
    for (const key of ['1:1', '1:3', '2:2']) {
      const input = structuredClone(audio); input.timestamps[1].verse_key = key;
      assert.throws(() => normalizeRecording(input, 7, 1, 2), /ordered verse timings/);
    }
    assert.throws(() => normalizeRecording(audio, 7, 1, 3), /ordered verse timings/);
  });
  it('rejects large overlaps, reversed boundaries and invalid numeric values', () => {
    for (const [start, end] of [[1000, 10000], [5000, 4999], [NaN, 10000], [5000, Infinity]]) {
      const input = structuredClone(audio); Object.assign(input.timestamps[1], { timestamp_from: start, timestamp_to: end });
      assert.throws(() => normalizeRecording(input, 7, 1, 2), /ordered verse timings/);
    }
    const typo = structuredClone(audio); typo.timestamps[0].timestamp_to = 5_201_000;
    assert.throws(() => normalizeRecording(typo, 7, 1, 2), /ordered verse timings/);
    const missing = structuredClone(audio); missing.timestamps[0].timestamp_from = null;
    assert.throws(() => normalizeRecording(missing, 7, 1, 2), /ordered verse timings/);
  });
  it('rejects mismatched chapters and URLs containing credentials or tokens', () => {
    assert.throws(() => normalizeRecording(audio, 7, 2, 2), /another chapter/);
    for (const url of ['http://example.com/1.mp3', 'https://example.com/1.mp3?token=private', 'https://user:password@example.com/1.mp3']) {
      assert.throws(() => normalizeRecording({ ...audio, audio_url: url }, 7, 1, 2), /public MP3/);
    }
  });
});
