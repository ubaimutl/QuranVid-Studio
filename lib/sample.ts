import verses from './sample-data.json' with { type: 'json' };
import { withEditableReference, type MediaAsset, type Project } from './model';
export const SAMPLE_AUDIO: MediaAsset = {
  id: 'sample-alafasy', name: 'Al-Fatihah · Mishary Alafasy', type: 'audio',
  url: '/audio/al-fatihah-alafasy.mp3', duration: 46.49,
};
export function createProject(): Project {
  return withEditableReference({
    version: 1, id: crypto.randomUUID(), name: 'Al-Fatihah · A moment of reflection',
    width: 1080, height: 1920, duration: 46.49, showReference: true,
    background: { type: 'image', source: '/backgrounds/mountains.jpg', name: 'Alpine stillness', dim: .43, blur: 0, scale: 1, positionX: 50, positionY: 50 },
    verses: structuredClone(verses),
    audio: [{ id: 'audio-sample', assetId: SAMPLE_AUDIO.id, name: SAMPLE_AUDIO.name, start: 0, offset: 0, duration: 46.49, sourceDuration: 46.49, volume: 1, fadeIn: 0, fadeOut: 0 }],
    layers: [
      { id: 'arabic', kind: 'arabic', name: 'Arabic verse', x: 50, y: 43, width: 84, fontSize: 74, color: '#ffffff', align: 'center', opacity: 1, visible: true, start: 0, end: 46.49 },
      { id: 'translation', kind: 'translation', name: 'English translation', x: 50, y: 59, width: 76, fontSize: 33, color: '#f2ede3', align: 'center', opacity: .92, visible: true, start: 0, end: 46.49 },
      { id: 'title', kind: 'text', name: 'Chapter title', text: 'Al-Fatihah', x: 50, y: 18, width: 80, fontSize: 30, color: '#ffffff', align: 'center', opacity: .82, visible: true, start: 0, end: 46.49 },
    ],
  });
}
