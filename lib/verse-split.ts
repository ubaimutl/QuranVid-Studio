import { uid, type Project, type VerseClip } from './model';

// Keep each Arabic token intact, including its combining marks and Quran signs.
export function verseWords(text: string) {
  return Array.from(text.matchAll(/\S+/gu), match => ({ text: match[0], start: match.index! }));
}

export function verseSections(text: string, breaks: number[]) {
  const words = verseWords(text);
  return [0, ...breaks].map((word, index, starts) =>
    text.slice(words[word]?.start ?? text.length, words[starts[index + 1]]?.start ?? text.length).trim());
}

export function suggestVerseBreaks(verse: VerseClip, requested: number) {
  const count = Math.min(16, verseWords(verse.arabic).length, Math.floor((verse.end - verse.start + 1e-8) / .1), requested);
  return count < 2 ? [] : Array.from({ length: count - 1 }, (_, i) => Math.round(verseWords(verse.arabic).length * (i + 1) / count));
}

export function estimatePartTimes(verse: VerseClip, breaks: number[]) {
  const total = verseWords(verse.arabic).length;
  // Reserve 100 ms per part even when a short clip has very uneven word counts.
  const spare = Math.max(0, verse.end - verse.start - (breaks.length + 1) * .1);
  return breaks.map((word, i) => verse.start + (i + 1) * .1 + spare * word / total);
}

export function splitVerse(project: Project, id: string, breaks: number[], times: number[], translations?: string[]): Project {
  const verse = project.verses.find(v => v.id === id);
  if (!verse || verse.part) throw new Error('Choose a full verse. Merge existing parts before splitting again.');
  const wordCount = verseWords(verse.arabic).length;
  if (!breaks.length || breaks.length > 15 || times.length !== breaks.length
    || breaks.some((word, i) => !Number.isInteger(word) || word < 1 || word >= wordCount || (i > 0 && word <= breaks[i - 1]))) {
    throw new Error('Choose up to 15 different breaks between Arabic words.');
  }
  if (project.verses.length + breaks.length > 1000) throw new Error('This project has reached the limit of 1,000 verse clips.');
  const edges = [verse.start, ...times, verse.end];
  if (edges.some((time, i) => !Number.isFinite(time) || (i > 0 && time - edges[i - 1] < .1 - 1e-8))) {
    throw new Error('Keep part times in order, with at least 0.1 seconds for each part.');
  }
  if (translations && (translations.length !== breaks.length + 1 || translations.some(t => typeof t !== 'string' || !t.trim() || t.length >= 100000))) {
    throw new Error('Add a translation for every part, or keep the full translation.');
  }
  const groupId = uid();
  const parts = verseSections(verse.arabic, breaks).map((arabic, index) => ({
    ...verse, id: index === 0 ? verse.id : uid(), arabic,
    translation: translations?.[index] ?? verse.translation,
    start: edges[index], end: edges[index + 1],
    part: { groupId, originalId: verse.id, arabic: verse.arabic, translation: verse.translation, index: index + 1, count: breaks.length + 1 },
  }));
  return { ...project, verses: project.verses.flatMap(v => v.id === id ? parts : [v]) };
}

export function mergeVerseParts(project: Project, id: string): Project {
  const verse = project.verses.find(v => v.id === id);
  if (!verse?.part) throw new Error('Choose a split verse to merge.');
  const original = verse.part;
  const parts = project.verses.filter(v => v.part?.groupId === original.groupId);
  if (parts.length !== original.count || parts.some(v => v.key !== verse.key || v.part?.arabic !== original.arabic || v.part?.translation !== original.translation)
    || new Set(parts.map(v => v.part!.index)).size !== original.count) {
    throw new Error('Some parts are missing or changed. Undo the deletion before merging this verse.');
  }
  const merged: VerseClip = { id: original.originalId, key: verse.key, arabic: original.arabic, translation: original.translation,
    start: Math.min(...parts.map(v => v.start)), end: Math.max(...parts.map(v => v.end)) };
  let inserted = false;
  return { ...project, verses: project.verses.flatMap(v => {
    if (v.part?.groupId !== original.groupId) return [v];
    if (inserted) return [];
    inserted = true; return [merged];
  }) };
}

// Shared edges between consecutive parts stay joined when an edge is trimmed.
export function retimeVerse(project: Project, id: string, requestedStart: number, requestedEnd: number): Project {
  const verse = project.verses.find(v => v.id === id);
  if (!verse) return project;
  const previous = verse.part && project.verses.find(v => v.part?.groupId === verse.part!.groupId && v.part.index === verse.part!.index - 1 && Math.abs(v.end - verse.start) < .001);
  const next = verse.part && project.verses.find(v => v.part?.groupId === verse.part!.groupId && v.part.index === verse.part!.index + 1 && Math.abs(v.start - verse.end) < .001);
  const start = previous ? Math.max(requestedStart, previous.start + .1) : requestedStart;
  const end = next ? Math.min(requestedEnd, next.end - .1) : requestedEnd;
  if (end - start < .1 - 1e-8) return project;
  return { ...project, verses: project.verses.map(v => v.id === id ? { ...v, start, end }
    : previous && v.id === previous.id ? { ...v, end: start }
    : next && v.id === next.id ? { ...v, start: end } : v) };
}

export const verseLabel = (verse: VerseClip) => `${verse.key}${verse.part ? ` · Part ${verse.part.index}/${verse.part.count}` : ''}`;
