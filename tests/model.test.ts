import { exportDimensions } from '../lib/export-settings';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeVerse, audioGain, getLineHeight, resizeProject, splitAudio, validateProject, withEditableReference } from '../lib/model';
import { createProject } from '../lib/sample';
import { applyTimedRecitation, recitationAttribution, selectRecitationRange, type RecitationCatalog, type TimedRecitation } from '../lib/recitations';
import { parseTimecode } from '../lib/media-audio';
import { backgroundMotionAt, horizontalTransitionAt, transitionAt } from '../lib/transitions';
import { getLayerFont } from '../lib/fonts';
import { readFileSync } from 'node:fs';
import { estimatePartTimes, mergeVerseParts, retimeVerse, splitVerse, suggestVerseBreaks, verseSections, verseWords } from '../lib/verse-split';
import { animatedLines, lineRevealOpacity, lineWipeProgress, revealProgress } from '../lib/text-animation';
import { hexToHsv, hsvToHex, normalizeHex } from '../lib/color';
import { layerText } from '../lib/renderer';
import { buildRecipeProject, decodeRecipe, decodeRecipeFragment, encodeRecipe, normalizeRecipe, recipeFragment, recipeSchema, recipeSelection, type RecipeLibrary } from '../lib/video-recipe';
import { applyVideoTemplate, SOLID_BACKGROUNDS, VIDEO_TEMPLATES, TEMPLATE_IDS } from '../lib/templates';

const preparedCatalog: RecitationCatalog = JSON.parse(readFileSync('public/data/recitations/catalog.json', 'utf8'));

describe('production recitation coverage', { skip: preparedCatalog.environment !== 'production' ? 'Requires the separately prepared production catalog' : false }, () => {
  it('bundles complete public metadata across production voices without audio credentials', () => {
    const catalog: RecitationCatalog = JSON.parse(readFileSync('public/data/recitations/catalog.json', 'utf8'));
    const chapters = JSON.parse(readFileSync('public/data/chapters.json', 'utf8')) as { id: number; count: number }[];
    assert.equal(catalog.environment, 'production');
    assert.ok(catalog.reciters.length >= 22);
    for (const id of [6, 159, 174]) assert.equal(catalog.reciters.find(reciter => reciter.id === id)!.chapters.length, 114);
    assert.ok(catalog.reciters.find(reciter => reciter.id === 7)!.chapters.includes(15));
    for (const reciter of catalog.reciters) for (const chapter of reciter.chapters) {
      const recording: TimedRecitation = JSON.parse(readFileSync(`public/data/recitations/${reciter.id}/${chapter}.json`, 'utf8'));
      assert.deepEqual(Object.keys(recording).sort(), ['audioUrl', 'chapter', 'reciterId', 'timings', 'version']);
      assert.equal(recording.reciterId, reciter.id); assert.equal(recording.chapter, chapter);
      const url = new URL(recording.audioUrl); assert.equal(url.protocol, 'https:');
      assert.equal(url.search + url.username + url.password, '');
      assert.equal(url.hostname, reciter.id === 9001 ? 'cdn.mp3quran.net' : 'download.quranicaudio.com');
      assert.equal(recording.timings.length, chapters.find(item => item.id === chapter)!.count);
      recording.timings.forEach((timing, index, timings) => {
        assert.equal(timing.key, `${chapter}:${index + 1}`);
        assert.ok(Number.isFinite(timing.start) && Number.isFinite(timing.end) && timing.start >= 0 && timing.end > timing.start);
        if (index) { assert.ok(timing.start >= timings[index - 1].start && timing.end >= timings[index - 1].end); assert.ok(timings[index - 1].end - timing.start <= .100001); }
      });
    }
  });
});

describe('Islam Sobhi prepared recordings', { skip: !preparedCatalog.reciters.some(reciter => reciter.id === 9001) ? 'Requires the optional Islam Sobhi dataset' : false }, () => {
  const catalog: RecitationCatalog = JSON.parse(readFileSync('public/data/recitations/catalog.json', 'utf8'));
  const reciter = catalog.reciters.find(reciter => reciter.id === 9001)!;
  const chapters = JSON.parse(readFileSync('public/data/chapters.json', 'utf8')) as { id: number; count: number }[];
  it('publishes only complete ordered chapters using the matching external audio', () => {
    assert.equal(reciter.name, 'Islam Sobhi'); assert.equal(reciter.chapters.length, 105);
    assert.deepEqual(chapters.filter(chapter => !reciter.chapters.includes(chapter.id)).map(chapter => chapter.id), [4, 7, 9, 37, 39, 40, 45, 65, 109]);
    for (const chapter of reciter.chapters) {
      const recording: TimedRecitation = JSON.parse(readFileSync(`public/data/recitations/9001/${chapter}.json`, 'utf8'));
      assert.equal(recording.reciterId, 9001); assert.equal(recording.chapter, chapter);
      assert.equal(recording.audioUrl, `https://cdn.mp3quran.net/audio/islam-sobhi/r1/${String(chapter).padStart(3, '0')}.mp3`);
      assert.equal(recording.timings.length, chapters.find(item => item.id === chapter)!.count);
      recording.timings.forEach((timing, index, timings) => {
        assert.equal(timing.key, `${chapter}:${index + 1}`);
        assert.ok(Number.isFinite(timing.start) && Number.isFinite(timing.end) && timing.end > timing.start);
        assert.ok(timing.start >= (timings[index - 1]?.end ?? 0));
      });
    }
    assert.ok(catalog.reciters.find(reciter => reciter.id === 7)?.chapters.includes(1));
  });
  it('includes the first attempt and repeat when selecting a repeated verse', () => {
    const recording = JSON.parse(readFileSync('public/data/recitations/9001/2.json', 'utf8'));
    const verses = JSON.parse(readFileSync('public/data/quran.json', 'utf8'));
    const range = selectRecitationRange(recording, verses, 2, 36, 36);
    assert.equal(range.start, 715.562); assert.equal(range.end, 739.203);
    assert.equal(range.clips.length, 1); assert.equal(range.clips[0].start, 0);
    assert.ok(Math.abs(range.clips[0].end - 23.641) < .001);
  });
  it('keeps audio and timing licenses separate and preserves legacy credits', () => {
    const credit = recitationAttribution(reciter, 'Al-Fatihah 2–3');
    assert.equal(credit.provider, 'MP3Quran'); assert.equal(credit.creator, 'Islam Sobhi');
    assert.equal(credit.sourceUrl, 'https://www.mp3quran.net/eng/islam');
    assert.equal(credit.license, undefined); assert.equal(credit.timing?.license, 'CC BY 4.0');
    assert.match(credit.timing!.sourceUrl, /\/v4\.0\.0$/);
    assert.equal(recitationAttribution(catalog.reciters.find(reciter => reciter.id === 7)!, 'Al-Fatihah').provider, 'Quran Foundation');
  });
});

describe('public video recipes', () => {
  const library: RecipeLibrary = {
    chapters: JSON.parse(readFileSync('public/data/chapters.json', 'utf8')),
    verses: JSON.parse(readFileSync('public/data/quran.json', 'utf8')),
    recitations: JSON.parse(readFileSync('public/data/recitations/catalog.json', 'utf8')),
  };
  const recording = JSON.parse(readFileSync('public/data/recitations/7/1.json', 'utf8'));
  it('builds exact static colors, including custom hex values, without inherited dimming or image motion', () => {
    for (const color of SOLID_BACKGROUNDS) {
      const recipe = normalizeRecipe({ chapter: 1, from: 2, to: 3, background: color.id, motion: 'zoom-in', dim: .8 });
      const project = buildRecipeProject(recipe, library, recording, 'local-audio');
      assert.equal(project.background.type, 'color'); assert.equal(project.background.source, color.color);
      assert.equal(project.background.motion, 'none'); assert.equal(project.background.motionStrength, 0);
      assert.equal(project.background.dim, 0); assert.equal(project.background.blur, 0);
      assert.deepEqual(decodeRecipeFragment(recipeFragment(recipe)), recipe);
    }
    const recipe = normalizeRecipe({ chapter: 1, from: 2, to: 3, backgroundColor: '#AbCdEf' });
    const project = buildRecipeProject(recipe, library, recording, 'local-audio');
    assert.equal(project.background.source, '#AbCdEf'); assert.equal(project.background.type, 'color');
    const light = buildRecipeProject(normalizeRecipe({ chapter: 1, from: 2, to: 3, backgroundColor: '#ffffff' }), library, recording, 'local-audio');
    assert.equal(light.layers.find(layer => layer.kind === 'arabic')!.color, '#252925');
    assert.throws(() => normalizeRecipe({ chapter: 1, from: 2, to: 3, backgroundColor: 'url(https://example.com)' }));
  });
  it('shares all ten templates across formats and gives explicit settings precedence over template defaults', () => {
    assert.deepEqual(VIDEO_TEMPLATES.map(template => template.id), [...TEMPLATE_IDS]);
    for (const template of VIDEO_TEMPLATES) for (const format of ['portrait', 'square', 'landscape', 'post']) {
      const recipe = normalizeRecipe({ chapter: 1, from: 2, to: 3, template: template.id, format });
      const project = buildRecipeProject(recipe, library, recording, 'local-audio');
      assert.ok(validateProject(project)); assert.equal(project.autoFitText, true); assert.equal(project.duration, 10.21);
      assert.equal(project.verses[0].key, '1:2'); assert.equal(project.verses[0].start, 0);
      assert.equal(project.audio[0].assetId, 'local-audio');
      assert.equal(project.layers.find(layer => layer.kind === 'arabic')!.fontFamily, template.arabicFont);
      assert.equal(project.layers.find(layer => layer.kind === 'translation')!.fontFamily, template.translationFont);
      assert.equal(project.layers.find(layer => layer.kind === 'arabic')!.color, template.arabicColor);
      assert.deepEqual(decodeRecipeFragment(recipeFragment(recipe)), recipe);
    }
    const recipe = normalizeRecipe({ chapter: 1, from: 2, to: 3, template: 'ivory', arabicFont: 'Amiri Quran', translationFont: 'monospace',
      showTranslation: false, showTitle: false, background: 'forest', dim: 0, motion: 'none', layout: { arabic: { color: '#123456', x: 40 } } });
    const project = buildRecipeProject(recipe, library, recording, 'local-audio');
    assert.equal(project.autoFitText, false);
    assert.equal(project.background.type, 'image'); assert.equal(project.background.dim, 0);
    assert.equal(project.background.motion, 'none');
    assert.equal(project.layers.find(layer => layer.kind === 'arabic')!.fontFamily, 'Amiri Quran');
    assert.equal(project.layers.find(layer => layer.kind === 'arabic')!.color, '#123456');
    assert.equal(project.layers.find(layer => layer.kind === 'translation')!.visible, false);
    assert.equal(project.layers.find(layer => layer.id === 'title')!.visible, false);
  });
  it('applies editor templates without changing audio, split parts, custom text or timeline placement', () => {
    let original = createProject();
    const verse = original.verses[0]; original = splitVerse(original, verse.id, [2], [verse.start + 2]);
    original.layers.push({ ...original.layers[0], kind: 'text', id: 'custom-text', name: 'My note', text: 'Keep my note', start: 2, end: 5 });
    const snapshot = structuredClone(original);
    for (const template of VIDEO_TEMPLATES) {
      const project = applyVideoTemplate(original, template.id);
      assert.equal(project.duration, original.duration); assert.deepEqual(project.audio, snapshot.audio); assert.deepEqual(project.verses, snapshot.verses);
      assert.deepEqual(project.layers.find(layer => layer.id === 'custom-text'), snapshot.layers.find(layer => layer.id === 'custom-text'));
      assert.deepEqual(project.layers.map(layer => [layer.id, layer.start, layer.end]), snapshot.layers.map(layer => [layer.id, layer.start, layer.end]));
      assert.ok(validateProject(project));
    }
    assert.deepEqual(original, snapshot);
  });
  it('validates optional auto-fit settings while preserving older manual projects', () => {
    const legacy = createProject();
    assert.equal(legacy.autoFitText, undefined); assert.ok(validateProject(legacy));
    for (const value of [true, false]) assert.ok(validateProject({ ...legacy, autoFitText: value }));
    for (const value of ['true', 1, null, {}]) assert.equal(validateProject({ ...legacy, autoFitText: value }), false);
  });
  it('uses short readable links, preserves all overrides and still opens legacy base64 links', () => {
    assert.equal(recipeFragment({ chapter: 1, from: 2, to: 3 }), '#create=1&chapter=1&from=2&to=3');
    const input = { chapter: 1, from: 2, to: 3, name: 'الفاتحة 🌿 & reflection + peace #1', arabicAnimation: 'word-reveal',
      animationDuration: 1.8, motionStrength: 4, dim: .5, showTitle: false, showTranslation: false,
      layout: { arabic: { x: 45, color: '#ffffff', fontSize: 90 } } };
    const expected = recipeSchema.parse(input);
    assert.deepEqual(decodeRecipeFragment(recipeFragment(input)), expected);
    assert.deepEqual(decodeRecipeFragment('#recipe=' + encodeRecipe(input)), expected);
    assert.deepEqual(decodeRecipeFragment(recipeFragment({ ...input, motionStrength: 1e-7 })), recipeSchema.parse({ ...input, motionStrength: 1e-7 }));
    for (const fragment of ['#create=2&chapter=1&from=2&to=3', '#create=1&chapter=1&from=2&to=3&chapter=2',
      '#create=1&chapter=1&from=2&to=3&showTitle=1', '#create=1&chapter=1&from=2&to=3&dim=null',
      '#create=1&chapter=1&from=2&to=3&audioUrl=https://example.com/file.mp3', '#create=1&chapter=1&from=2&to=3&layout=%7B',
      '#recipe=' + encodeRecipe(input) + '&create=1', '#create=1&chapter=1&from=2&to=3&version=1',
      '#create=1&chapter=1&from=2&to=3&__proto__=bad', '#' + 'a'.repeat(12001)]) assert.throws(() => decodeRecipeFragment(fragment));
  });
  it('round trips Unicode settings and rejects unsupported, oversized and unsafe recipes', () => {
    const input = { chapter: 1, from: 2, to: 3, name: 'الفاتحة · Reflection 🌿' };
    assert.deepEqual(decodeRecipe(encodeRecipe(input)), recipeSchema.parse(input));
    for (const invalid of [{ ...input, audioUrl: 'https://example.com/file.mp3' }, { ...input, arabic: 'Replacement text' },
      { ...input, autoExport: true }, { ...input, version: 2 }, { ...input, to: 1 }, { ...input, to: 102 },
      { ...input, layout: { arabic: { text: 'Replacement text' } } }, { ...input, layout: { arabic: { color: 'url(https://example.com)' } } }]) {
      assert.throws(() => encodeRecipe(invalid));
    }
    for (const invalid of ['a'.repeat(12000), '%%%invalid', btoa('{"chapter":1,"from":1,"to":2}'), btoa('{"version":2}'), btoa('{')]) assert.throws(() => decodeRecipe(invalid));
  });
  it('uses exact canonical text and normalized timings across supported formats', () => {
    for (const format of ['portrait', 'square', 'landscape', 'post']) {
      const recipe = recipeSchema.parse({ chapter: 1, from: 2, to: 3, format, showReference: false, showTitle: false,
        layout: { arabic: { color: '#ddffdd', y: 40 } } });
      const project = buildRecipeProject(recipe, library, recording, 'local-audio');
      assert.ok(validateProject(project)); assert.equal(project.autoFitText, false); assert.equal(project.duration, 10.21);
      assert.equal(project.verses[0].start, 0); assert.equal(project.verses[1].end, 10.21);
      assert.equal(project.verses[0].arabic, library.verses.find(verse => verse.key === '1:2')!.arabic);
      assert.equal(project.audio.length, 1); assert.equal(project.audio[0].assetId, 'local-audio');
      assert.equal(project.layers.find(layer => layer.kind === 'reference')!.visible, false);
      assert.equal(project.layers.find(layer => layer.id === 'title')!.visible, false);
      assert.equal(project.layers.find(layer => layer.kind === 'arabic')!.color, '#ddffdd');
      assert.equal(project.layers.find(layer => layer.kind === 'translation')!.fontFamily, 'serif');
    }
  });
  it('rejects unavailable recordings, invalid verses, mismatched metadata and overlong timing ranges', () => {
    assert.throws(() => recipeSelection(recipeSchema.parse({ chapter: 109, from: 1, to: 6, reciterId: 9001 }), library), /unavailable/);
    assert.throws(() => recipeSelection(recipeSchema.parse({ chapter: 1, from: 1, to: 8 }), library), /valid verses/);
    const recipe = recipeSchema.parse({ chapter: 1, from: 1, to: 2 });
    assert.throws(() => recipeSelection(recipe, library, { ...recording, reciterId: 6 }), /does not match/);
    const timings = recording.timings.map((timing: { end: number }, index: number) => index === 1 ? { ...timing, end: 601 } : timing);
    assert.throws(() => recipeSelection(recipe, library, { ...recording, timings }), /shorter range/);
  });
});

describe('timeline and project integrity', () => {
  it('upgrades the legacy verse reference without changing other layers or duplicating it', () => {
    const p = createProject();
    const legacy = { ...p, showReference: false, layers: p.layers.filter(l => l.kind !== 'reference') };
    const upgraded = withEditableReference(legacy);
    assert.equal(upgraded.layers.length, legacy.layers.length + 1);
    assert.deepEqual(upgraded.layers.slice(0, -1), legacy.layers);
    assert.equal(upgraded.layers.at(-1)?.visible, false);
    assert.equal(validateProject(upgraded), true);
    assert.strictEqual(withEditableReference(upgraded), upgraded);
    const layer = upgraded.layers.at(-1)!;
    assert.equal(layerText(upgraded, layer, 0), 'Quran 1:1');
    assert.equal(layerText(upgraded, { ...layer, referenceFormat: 'key' }, 6.09), '1:2');
    assert.equal(layerText(upgraded, { ...layer, referenceFormat: 'number' }, 6.09), '2');
    assert.equal(layerText(upgraded, layer, upgraded.duration), '');
  });
  it('keeps Arabic shaping and line layout intact while retaining Latin grapheme typing', () => {
    const typewriter = { effect: 'typewriter', duration: 3 } as const;
    assert.deepEqual(animatedLines(['e\u0301👩‍💻B'], typewriter, 1.01, 0, 10), ['e\u0301']);
    assert.deepEqual(animatedLines(['e\u0301👩‍💻B'], typewriter, 2.01, 0, 10), ['e\u0301👩‍💻']);
    assert.deepEqual(animatedLines(['بِسْمِ ٱللَّهِ'], { ...typewriter, duration: 2 }, 1.01, 0, 10, true), ['بِسْمِ ٱللَّهِ']);
    const lines = ['First line', 'Second line'];
    assert.deepEqual(animatedLines(lines, { effect: 'line-reveal', duration: 2 }, 1.01, 0, 10), lines);
    assert.deepEqual(animatedLines(lines, { effect: 'word-reveal', duration: 4 }, 1.01, 0, 10), ['First', '']);
    assert.deepEqual(animatedLines(lines, typewriter, 10, 10, 12), ['', '']);
    assert.deepEqual(animatedLines(lines, typewriter, 11.2, 10, 12), lines);
    assert.deepEqual(animatedLines(lines, undefined, 0, 0, 12), lines);
  });
  it('continuously fades overlapping lines and reveals Arabic at a consistent pixel speed', () => {
    assert.equal(lineRevealOpacity(0, 0, 3), 0);
    assert.equal(lineRevealOpacity(1, 2, 3), 1);
    assert.ok(lineRevealOpacity(.3, 0, 3) > 0 && lineRevealOpacity(.3, 0, 3) < 1);
    assert.ok(lineRevealOpacity(.3, 1, 3) > 0 && lineRevealOpacity(.3, 1, 3) < 1);
    let previous = 0;
    for (let frame = 1; frame < 24; frame++) {
      const opacity = lineRevealOpacity(frame / 30, 0, 1);
      assert.ok(opacity > previous && opacity < 1); previous = opacity;
    }
    assert.equal(lineWipeProgress([100, 200], 0, .2), .6);
    assert.equal(lineWipeProgress([100, 200], 1, .2), 0);
    assert.equal(lineWipeProgress([100, 200], 1, .5), .25);
    assert.equal(lineWipeProgress([100, 200], 1, 1), 1);
    assert.equal(revealProgress({ effect: 'typewriter', duration: 3 }, 10, 10, 12), 0);
  });
  it('validates saved reference formats, system fonts and optional reveal settings', () => {
    const p = createProject();
    for (const fontFamily of ['sans-serif', 'serif', 'monospace'] as const) {
      p.layers[1].fontFamily = fontFamily;
      p.layers[1].animation = { effect: 'typewriter', duration: 2 };
      assert.equal(validateProject(JSON.parse(JSON.stringify(p))), true);
    }
    assert.equal(validateProject({ ...p, layers: [{ ...p.layers[1], animation: { effect: 'unknown', duration: 2 } }] }), false);
    assert.equal(validateProject({ ...p, layers: [{ ...p.layers[1], animation: { effect: 'typewriter', duration: NaN } }] }), false);
    assert.equal(validateProject({ ...p, layers: [{ ...p.layers[3], referenceFormat: 'invalid' }] }), false);
  });
  it('keeps horizontal image and text transitions bounded and deterministic', () => {
    const settings = { enter: 'slide-left', exit: 'slide-right', duration: 1 } as const;
    assert.equal(horizontalTransitionAt(settings, 0, 0, 10), .05);
    assert.equal(horizontalTransitionAt(settings, 5, 0, 10), 0);
    assert.equal(horizontalTransitionAt(settings, 10, 0, 10), .05);
    assert.equal(horizontalTransitionAt(undefined, 0, 0, 10), 0);
    assert.equal(validateProject({ ...createProject(), background: { ...createProject().background, transition: settings } }), true);
  });
  it('converts color picker values without corrupting hex colors', () => {
    for (const hex of ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#f2ede3', '#d8aa44']) assert.equal(hsvToHex(hexToHsv(hex)), hex);
    assert.equal(normalizeHex('AbC'), '#aabbcc');
    assert.equal(normalizeHex(' #AABBCC '), '#aabbcc');
    assert.equal(normalizeHex('#xyzxyz'), null);
    assert.equal(normalizeHex('#1234'), null);
  });
  it('splits only at Arabic word boundaries, preserves audio and restores the exact original verse', () => {
    const project = createProject(), verse = project.verses[6];
    const original = JSON.stringify(project);
    const breaks = suggestVerseBreaks(verse, 3);
    const next = splitVerse(project, verse.id, breaks, estimatePartTimes(verse, breaks));
    const parts = next.verses.filter(v => v.part);
    assert.equal(parts.length, 3);
    assert.deepEqual(parts.flatMap(v => verseWords(v.arabic).map(w => w.text)), verseWords(verse.arabic).map(w => w.text));
    assert.equal(parts[0].start, verse.start); assert.equal(parts[2].end, verse.end);
    assert.equal(parts[0].end, parts[1].start); assert.equal(parts[1].end, parts[2].start);
    assert.equal(activeVerse(next, parts[1].start)?.id, parts[1].id);
    assert.ok(parts.every(v => v.key === verse.key && v.translation === verse.translation));
    assert.strictEqual(next.audio, project.audio); assert.strictEqual(next.layers, project.layers);
    assert.strictEqual(next.background, project.background); assert.equal(next.duration, project.duration);
    assert.equal(JSON.stringify(project), original);
    assert.deepEqual(mergeVerseParts(next, parts[1].id), project);
  });
  it('keeps manual translations per part and restores the original translation when merged', () => {
    const project = createProject(), verse = project.verses[0];
    const split = splitVerse(project, verse.id, [2], [2], ['First meaning', 'Second meaning']);
    assert.equal(split.verses[0].translation, 'First meaning');
    assert.equal(split.verses[1].translation, 'Second meaning');
    assert.deepEqual(mergeVerseParts(split, verse.id), project);
    assert.equal(validateProject(JSON.parse(JSON.stringify(split))), true);
    assert.equal(validateProject({ ...split, verses: [{ ...split.verses[0], part: { ...split.verses[0].part, index: 0 } }] }), false);
    assert.equal(validateProject({ ...split, verses: [{ ...split.verses[0], part: null }] }), false);
  });
  it('rejects invalid word breaks, unordered or nonfinite times, and incomplete translations', () => {
    const p = createProject(), id = p.verses[6].id, v = p.verses[6];
    for (const breaks of [[], [0], [10000], [1.5], [2, 2], [2, 1]]) assert.throws(() => splitVerse(p, id, breaks, breaks.map(() => v.start + 1)));
    for (const times of [[NaN], [Infinity], [v.start], [v.end], [v.end + 1]]) assert.throws(() => splitVerse(p, id, [1], times));
    assert.throws(() => splitVerse(p, id, [1, 2], [v.start + 2, v.start + 1]));
    assert.throws(() => splitVerse(p, id, [1], [v.start + 1], ['Only one']));
    assert.throws(() => splitVerse(p, id, [1], [v.start + 1], ['One', '']));
    const split = splitVerse(p, id, [1], [v.start + 1]);
    assert.throws(() => splitVerse(split, id, [1], [v.start + 1]));
    assert.throws(() => mergeVerseParts({ ...split, verses: split.verses.filter(clip => clip.id === id) }, id));
  });
  it('retimes joined part edges without overlaps or changing recitation placement', () => {
    const p = createProject(), verse = p.verses[6];
    const split = splitVerse(p, verse.id, [1, 2], [35, 39]);
    const middle = split.verses[7];
    const timed = retimeVerse(split, middle.id, 36, 40);
    assert.equal(timed.verses[6].end, 36); assert.equal(timed.verses[7].start, 36);
    assert.equal(timed.verses[7].end, 40); assert.equal(timed.verses[8].start, 40);
    assert.deepEqual(timed.audio, p.audio);
    const clamped = retimeVerse(timed, middle.id, 1, 100);
    assert.ok(clamped.verses[6].end - clamped.verses[6].start >= .1 - 1e-8);
    assert.ok(clamped.verses[8].end - clamped.verses[8].start >= .1 - 1e-8);
    assert.equal(validateProject(clamped), true);
  });
  it('suggests bounded parts and estimates ordered times even for very short or uneven clips', () => {
    const verse = { ...createProject().verses[6], start: 0, end: .31 };
    const breaks = suggestVerseBreaks(verse, 16);
    assert.equal(breaks.length, 2);
    const times = estimatePartTimes(verse, [1, 2]);
    const p = { ...createProject(), verses: [verse] };
    assert.doesNotThrow(() => splitVerse(p, verse.id, [1, 2], times));
    assert.deepEqual(verseSections('  أَحَدٌ   ٱللَّهُ  ٱلصَّمَدُ ', [1]), ['أَحَدٌ', 'ٱللَّهُ  ٱلصَّمَدُ']);
    assert.deepEqual(suggestVerseBreaks({ ...verse, end: .15 }, 3), []);
  });
  it('preserves every word and combining mark when splitting and merging the full Quran corpus', () => {
    const verses = JSON.parse(readFileSync(new URL('../public/data/quran.json', import.meta.url), 'utf8'));
    const base = createProject();
    for (const original of verses) {
      const verse = { ...original, id: 'corpus-verse', start: 0, end: 30 };
      const breaks = suggestVerseBreaks(verse, 3);
      if (!breaks.length) continue;
      const p = { ...base, verses: [verse] };
      const split = splitVerse(p, verse.id, breaks, estimatePartTimes(verse, breaks));
      assert.deepEqual(split.verses.flatMap(v => verseWords(v.arabic).map(w => w.text)), verseWords(verse.arabic).map(w => w.text), verse.key);
      assert.deepEqual(mergeVerseParts(split, split.verses[1].id).verses, [verse], verse.key);
    }
  });
  it('splits audio without losing source offsets or duplicating fades', () => {
    const clip = { ...createProject().audio[0], start: 3, offset: 10, duration: 8, fadeIn: 1, fadeOut: 2 };
    const [left, right] = splitAudio(clip, 6);
    assert.equal(left.duration, 3); assert.equal(left.offset, 10); assert.equal(left.fadeIn, 1); assert.equal(left.fadeOut, 0);
    assert.equal(right.start, 6); assert.equal(right.offset, 13); assert.equal(right.duration, 5); assert.equal(right.fadeIn, 0); assert.equal(right.fadeOut, 2);
    assert.notEqual(right.id, left.id);
  });
  it('does not create empty clips when splitting on an edge', () => {
    const clip = createProject().audio[0];
    assert.equal(splitAudio(clip, 0).length, 1);
    assert.equal(splitAudio(clip, clip.duration).length, 1);
  });
  it('calculates gain at the actual local clip time', () => {
    const clip = { ...createProject().audio[0], duration: 10, volume: .8, fadeIn: 2, fadeOut: 2 };
    assert.equal(audioGain(clip, 0), 0); assert.equal(audioGain(clip, 1), .4);
    assert.equal(audioGain(clip, 5), .8); assert.equal(audioGain(clip, 9), .4);
    assert.equal(audioGain(clip, 10), 0); assert.equal(audioGain(clip, -1), 0);
  });
  it('changes verses precisely at a shared boundary', () => {
    const project = createProject();
    assert.equal(activeVerse(project, 6.089)?.key, '1:1');
    assert.equal(activeVerse(project, 6.09)?.key, '1:2');
    assert.equal(activeVerse(project, project.duration), undefined);
  });
  it('extends the final verse and end-anchored layers when the project end is dragged', () => {
    const project = createProject();
    project.layers.push({ ...project.layers[2], id: 'short-title', end: 5 });
    const next = resizeProject(project, 70, true);
    assert.equal(next.duration, 70);
    assert.equal(next.verses.at(-1)?.end, 70);
    assert.equal(next.layers[0].end, 70);
    assert.equal(next.layers.at(-1)?.end, 5);
    assert.deepEqual(next.audio, project.audio);
    assert.equal(project.duration, 46.49);
  });
  it('preserves manual verse boundaries and does not trim away audio', () => {
    const project = createProject();
    assert.equal(resizeProject(project, 10, true).duration, project.duration);
    project.audio = [];
    const next = resizeProject(project, 40, true);
    assert.equal(next.duration, 40);
    assert.equal(next.verses.at(-1)?.end, 40);
    project.verses[6].end = 45;
    assert.equal(resizeProject(project, 60, true).verses.at(-1)?.end, 45);
    assert.equal(resizeProject(project, 800).duration, 600);
  });
  it('retains legacy line spacing and validates percentage overrides', () => {
    const project = createProject();
    assert.equal(getLineHeight(project.layers[0]), 185);
    assert.equal(getLineHeight(project.layers[1]), 155);
    project.layers[0].lineHeight = 120;
    assert.equal(getLineHeight(project.layers[0]), 120);
    assert.equal(validateProject(project), true);
    project.layers[0].lineHeight = 0;
    assert.equal(validateProject(project), false);
  });
  it('round-trips a project and rejects corrupt or oversized imported values', () => {
    const project = JSON.parse(JSON.stringify(createProject()));
    assert.equal(validateProject(project), true);
    assert.equal(validateProject({ ...project, duration: Infinity }), false);
    assert.equal(validateProject({ ...project, width: 20000 }), false);
    assert.equal(validateProject({ ...project, audio: [{ ...project.audio[0], offset: 100 }] }), false);
    assert.equal(validateProject({ ...project, layers: [{ ...project.layers[0], fontSize: -10 }] }), false);
    assert.equal(validateProject({ ...project, verses: [{ ...project.verses[0], end: -1 }] }), false);
  });
  it('parses range timestamps without accepting malformed or overflowing fields', () => {
    assert.equal(parseTimecode('04:02'), 242);
    assert.equal(parseTimecode('5:34.25'), 334.25);
    assert.equal(parseTimecode('1:02:03'), 3723);
    assert.equal(parseTimecode('4:2'), 242);
    for (const invalid of ['', '-1', '1:60', '1:02:99', 'abc', 'Infinity']) assert.equal(parseTimecode(invalid), null);
  });
  it('normalizes selected verse timings to the start of the extracted audio', () => {
    const project = createProject();
    const recording = { version: 1 as const, reciterId: 7, chapter: 1, audioUrl: '', timings: project.verses.map(v => ({ key: v.key, start: v.start, end: v.end })) };
    const range = selectRecitationRange(recording, project.verses, 1, 2, 3);
    assert.equal(range.start, 6.09); assert.equal(range.end, 16.3);
    assert.equal(range.clips[0].start, 0);
    assert.equal(range.clips[1].start, 11.68 - 6.09);
    assert.equal(range.clips[1].end, 16.3 - 6.09);
    assert.throws(() => selectRecitationRange(recording, project.verses, 1, 2, 8));
  });
  it('fits a timed recitation to the project while retaining uploaded audio and styles', () => {
    const project = createProject();
    project.audio.push({ ...project.audio[0], id: 'uploaded', assetId: 'custom', start: 4, duration: 20 });
    const clips = project.verses.slice(0, 2);
    const next = applyTimedRecitation(project, clips, 'library-clip', 'Alafasy', 11.68, 0);
    assert.equal(next.duration, 24);
    assert.equal(next.audio.length, 2);
    assert.equal(next.audio[0].assetId, 'custom');
    assert.equal(next.audio[1].recitation, true);
    assert.equal(next.layers[0].fontSize, project.layers[0].fontSize);
    assert.equal(next.layers[0].end, 24);
    const replaced = applyTimedRecitation(next, clips, 'another-library-clip', 'Husary', 11.68, 0);
    assert.equal(replaced.audio.length, 2);
    assert.equal(replaced.audio[1].assetId, 'another-library-clip');
  });
  it('keeps legacy fonts and transitions unchanged and validates new saved settings', () => {
    const project = createProject();
    assert.equal(getLayerFont(project.layers[0]), 'Noto Naskh Arabic');
    assert.equal(getLayerFont(project.layers[1]), 'DM Sans');
    assert.deepEqual(transitionAt(undefined, 0, 0, 4), { opacity: 1, y: 0, scale: 1 });
    project.layers[0].fontFamily = 'Amiri Quran';
    project.layers[0].transition = { enter: 'fade', exit: 'slide-up', duration: .5 };
    project.background.motion = 'zoom-in';
    project.background.transition = { enter: 'zoom', exit: 'fade', duration: 1 };
    assert.equal(validateProject(JSON.parse(JSON.stringify(project))), true);
    assert.equal(validateProject({ ...project, layers: [{ ...project.layers[0], fontFamily: 'unknown-font' }] }), false);
    assert.equal(validateProject({ ...project, background: { ...project.background, motion: 'unknown-motion' } }), false);
    assert.equal(validateProject({ ...project, layers: [{ ...project.layers[0], transition: { enter: 'fade', exit: 'none', duration: 0 } }] }), false);
  });
  it('applies entrance and exit effects within each segment, including short verses', () => {
    const settings = { enter: 'slide-up', exit: 'zoom', duration: .5 } as const;
    const beginning = transitionAt(settings, 6, 6, 10);
    assert.equal(beginning.opacity, 0); assert.equal(beginning.y, .035);
    assert.deepEqual(transitionAt(settings, 8, 6, 10), { opacity: 1, y: 0, scale: 1 });
    const ending = transitionAt(settings, 10, 6, 10);
    assert.equal(ending.opacity, 0); assert.equal(ending.scale, 1.08);
    assert.equal(transitionAt(settings, 12, 12, 15).opacity, 0);
    assert.equal(transitionAt(settings, .1, 0, .2).opacity, 1);
    for (const time of [0, .01, .1, .19, .2]) {
      const state = transitionAt(settings, time, 0, .2);
      assert.ok(Number.isFinite(state.opacity) && state.opacity >= 0 && state.opacity <= 1);
    }
  });
  it('keeps optional background motion deterministic and bounded', () => {
    assert.deepEqual(backgroundMotionAt(undefined, 5, 10), { scale: 1, x: 0 });
    assert.equal(backgroundMotionAt('zoom-in', 0, 10).scale, 1);
    assert.equal(backgroundMotionAt('zoom-in', 10, 10).scale, 1.12);
    assert.equal(backgroundMotionAt('zoom-out', 0, 10).scale, 1.12);
    const left = backgroundMotionAt('pan-left', 0, 10);
    const right = backgroundMotionAt('pan-left', 10, 10);
    assert.ok(left.x > right.x);
    assert.ok(left.scale > 1);
  });
  it('scales image motion strength, holds its end and repeats without jumps', () => {
    assert.equal(backgroundMotionAt('zoom-in', 4, 40, 30, 4).scale, 1.3);
    assert.equal(backgroundMotionAt('zoom-in', 30, 40, 30, 4).scale, 1.3);
    assert.equal(backgroundMotionAt('zoom-in', 8, 40, 30, 4, true).scale, 1);
    const early = backgroundMotionAt('zoom-in', 3, 36.4, 12, 36.4, true).scale;
    const oldEarly = 1 + .12 * (1 - Math.cos(Math.PI * 3 / 36.4)) / 2;
    assert.ok(early - 1 > (oldEarly - 1) * 3);
    for (const motion of ['pan-up', 'pan-down', 'zoom-drift', 'breathe'] as const) {
      const before = backgroundMotionAt(motion, 4 - .001, 40, 20, 4, true);
      const after = backgroundMotionAt(motion, 4 + .001, 40, 20, 4, true);
      assert.ok(Math.abs(before.scale - after.scale) < .001);
      assert.ok(Math.abs(before.x - after.x) < .001);
      assert.ok(before.scale >= 1 && before.scale <= 1.2);
    }
    assert.ok(backgroundMotionAt('pan-up', 0, 10).y! > backgroundMotionAt('pan-up', 10, 10).y!);
    assert.equal(backgroundMotionAt('breathe', 5, 10, 20).scale, 1.2);
    const p = createProject();
    p.background = { ...p.background, motion: 'zoom-drift', motionStrength: 20, motionDuration: 8, motionRepeat: true };
    assert.equal(validateProject(JSON.parse(JSON.stringify(p))), true);
    assert.equal(validateProject({ ...p, background: { ...p.background, motionStrength: 90 } }), false);
    assert.equal(validateProject({ ...p, background: { ...p.background, motionDuration: 0 } }), false);
  });
});


describe('export resolution', () => {
  it('keeps original sizes and scales portrait, landscape, square and posts without upscaling', () => {
    for (const [width, height, targetWidth, targetHeight] of [[1080, 1920, 720, 1280], [1920, 1080, 1280, 720], [1080, 1080, 720, 720], [1080, 1350, 720, 900], [360, 640, 360, 640]]) {
      assert.deepEqual(exportDimensions(width, height, 'original'), { width, height });
      assert.deepEqual(exportDimensions(width, height, '720p'), { width: targetWidth, height: targetHeight });
    }
  });
});
