'use client';
import { useEffect, useState } from 'react';
import { ArrowDownToLine, AudioLines, Check, ChevronRight, FileUp, ImageIcon, Music2, Plus, Search, Type, Upload, X } from 'lucide-react';
import { BACKGROUNDS, clamp, formatTime, uid, type Chapter, type MediaAsset, type Project, type Verse, type VerseClip } from '@/lib/model';
import { SAMPLE_AUDIO } from '@/lib/sample';
import RecitationPicker from './recitation-picker';
import { verseLabel } from '@/lib/verse-split';
import { backgroundForChoice, SOLID_BACKGROUNDS, VIDEO_TEMPLATES, type TemplateId } from '@/lib/templates';
import { fontStack } from '@/lib/fonts';

export type LibraryTab = 'quran' | 'media' | 'audio' | 'text' | 'templates';
type Props = { tab: LibraryTab; project: Project; assets: MediaAsset[]; change: (p: Project) => void; markTiming: (p: Project) => void; select: (id: string) => void; seek: (t: number) => void; upload: (accept: string) => void; addAudio: (asset: MediaAsset) => void; addText: (text?: string) => void; notify: (s: string) => void; applyTemplate: (id: TemplateId) => void; time: number; importRecitation: (asset: MediaAsset, clips: VerseClip[], chapterName: string, signal?: AbortSignal) => Promise<void>; extractAudio: () => void };
export default function Library({ tab, project, assets, change, markTiming, select, seek, upload, addAudio, addText, notify, applyTemplate, time, importRecitation, extractAudio }: Props) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [quran, setQuran] = useState<Verse[]>([]);
  const [chapter, setChapter] = useState(1);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(7);
  const [search, setSearch] = useState('');
  const [choosingChapter, setChoosingChapter] = useState(false);
  const [syncIndex, setSyncIndex] = useState<number | null>(null);
  useEffect(() => {
    Promise.all([fetch('/data/chapters.json').then(r => r.json()), fetch('/data/quran.json').then(r => r.json())]).then(([c, v]) => { setChapters(c); setQuran(v); }).catch(() => notify('The Quran library could not load. Refresh to try again.'));
  }, [notify]);
  const currentChapter = chapters.find(c => c.id === chapter);
  const useRange = () => {
    const verses = quran.filter(v => { const [c, n] = v.key.split(':').map(Number); return c === chapter && n >= from && n <= to; });
    if (!verses.length) return;
    if (verses.length > 100) { notify('Choose up to 100 verses for one project.'); return; }
    const duration = Math.max(project.duration, verses.length * 5);
    change({ ...project, duration, name: `${currentChapter?.name} · A moment of reflection`,
      verses: verses.map((v, i) => ({ ...v, id: uid(), start: i * duration / verses.length, end: (i + 1) * duration / verses.length })),
      audio: project.audio.filter(a => a.recitation !== true && a.assetId !== SAMPLE_AUDIO.id),
      layers: project.layers.map(l => ({ ...l, end: l.end === project.duration ? duration : l.end, ...(l.id === 'title' ? { text: currentChapter?.name } : {}) })),
    });
    setSyncIndex(null); seek(0); notify('Verses added. Add your recording and adjust verse timings, or use tap-to-sync.');
  };
  const tap = () => {
    const index = syncIndex ?? 0;
    const clip = project.verses[index]; if (!clip) return;
    const previous = project.verses[index - 1];
    if (previous && time <= previous.start + .05) { notify('Move the playhead forward before marking the next verse.'); return; }
    if (time >= project.duration - .1) { notify('There is no time left for another verse.'); return; }
    markTiming({ ...project, verses: project.verses.map((v, i) => i === index ? { ...v, start: time, end: Math.max(time + .1, v.end) } : i === index - 1 ? { ...v, end: time } : v) });
    select(clip.id);
    if (index === project.verses.length - 1) { setSyncIndex(null); notify('Verse starts marked. Check the last verse’s end time.'); }
    else setSyncIndex(index + 1);
  };
  const headings = { quran: 'Quran', media: 'Media library', audio: 'Audio', text: 'Text & layers', templates: 'Templates' };
  return <aside className="library-panel">
    <div className="panel-heading"><h2>{headings[tab]}</h2><span className="panel-caption">{tab === 'quran' ? 'Your starting point' : 'Make it yours'}</span></div>
    <div className="library-scroll">
      {tab === 'quran' ? <>
        <div className="intro-copy"><h3>A verse worth sharing.</h3><p>Choose your verses. Give them a space of their own.</p></div>
        <label className="form-field">Surah<button className="chapter-select" onClick={() => setChoosingChapter(v => !v)}><span className="chapter-number">{chapter}</span><span><strong>{currentChapter?.name ?? 'Al-Fatihah'}</strong><small>{currentChapter?.count ?? 7} verses</small></span><ChevronRight size={15} /></button></label>
        {choosingChapter && <div className="chapter-picker"><div className="search-field"><Search size={14} /><input aria-label="Search chapters" placeholder="Find a surah…" value={search} onChange={e => setSearch(e.target.value)} /><button className="icon-btn" onClick={() => setChoosingChapter(false)} aria-label="Close chapter picker"><X size={13} /></button></div><div className="chapter-results">{chapters.filter(c => `${c.id} ${c.name} ${c.arabic}`.toLowerCase().includes(search.toLowerCase())).map(c => <button key={c.id} onClick={() => { setChapter(c.id); setFrom(1); setTo(Math.min(c.count, 7)); setChoosingChapter(false); setSearch(''); }}><span>{c.id}</span>{c.name}<small dir="rtl">{c.arabic}</small></button>)}</div></div>}
        <div className="field-pair verse-range"><label className="form-field">From verse<input aria-label="From verse" type="number" min={1} max={currentChapter?.count ?? 7} value={from} onChange={e => { const v = clamp(+e.target.value || 1, 1, currentChapter?.count ?? 7); setFrom(v); setTo(n => Math.max(v, n)); }} /></label><span className="range-dash">—</span><label className="form-field">To verse<input aria-label="To verse" type="number" min={from} max={currentChapter?.count ?? 7} value={to} onChange={e => setTo(clamp(+e.target.value || from, from, currentChapter?.count ?? 7))} /></label></div>
        <button className="primary-button full" onClick={useRange} disabled={!quran.length}><Plus size={15} />Add verses to timeline</button>
        <p className="field-note">Replaces the verses and removes their recitation. Other audio stays in place.</p>
        <RecitationPicker chapter={chapter} chapterName={currentChapter?.name ?? `Surah ${chapter}`} from={from} to={to} verses={quran} verseTrack={project.verses} assets={assets} onImport={importRecitation} />
        <div className="section-divider" />
        <div className="library-section-title"><h3>In your video</h3><span>{new Set(project.verses.map(v => v.part?.groupId ?? v.id)).size} verses</span></div>
        <div className="verse-list">{project.verses.map((v, i) => <button className={`verse-card ${time >= v.start && time < v.end ? 'current' : ''}`} key={v.id} onClick={() => { select(v.id); seek(v.start); }}><div className="verse-card-top"><span className="verse-number">{verseLabel(v)}</span><span>{formatTime(v.start)} – {formatTime(v.end)}</span>{time >= v.start && time < v.end && <AudioLines size={12} />}</div><p dir="rtl">{v.arabic}</p><small>{v.translation}</small></button>)}</div>
        <div className="sync-card"><AudioLines size={18} /><h4>Using your own recitation?</h4><p>Play your recording and mark the beginning of each verse or part.</p><button className="subtle-button full" onClick={tap}>{syncIndex === null ? 'Start tap-to-sync' : `Mark ${project.verses[syncIndex] ? verseLabel(project.verses[syncIndex]) : 'next verse'}`}</button>{syncIndex !== null && <button className="text-button" onClick={() => setSyncIndex(null)}>Stop marking</button>}</div>
        <p className="source-note">Quran text · Quran.com<br />Translation · Saheeh International</p>
      </> : tab === 'media' ? <>
        <button className="upload-zone" onClick={() => upload('image/*,video/*')}><span><Upload size={20} /></span><strong>Bring your own backdrop</strong><small>Choose images or videos</small></button>
        <div className="library-section-title"><h3>Nature, quietly.</h3><span>3 backgrounds</span></div>
        <div className="background-gallery">{BACKGROUNDS.map(bg => <button key={bg.source} aria-label={bg.name} className={`background-card ${project.background.source === bg.source ? 'selected' : ''}`} onClick={() => { change({ ...project, background: { ...project.background, type: 'image', source: bg.source, name: bg.name } }); select('background'); }}><img src={bg.source} alt="" /><span>{bg.name}</span>{project.background.source === bg.source && <i><Check size={12} /></i>}</button>)}</div>
        <div className="library-section-title"><h3>Solid colors</h3><span>Always still</span></div><div className="color-swatches">{SOLID_BACKGROUNDS.map(color => <button key={color.id} title={`${color.name} · ${color.color}`} aria-label={`Use ${color.name.toLowerCase()} background`} aria-pressed={project.background.type === 'color' && project.background.source === color.color} style={{ background: color.color }} onClick={() => { change({ ...project, background: backgroundForChoice(color.id, project.duration) }); select('background'); }} />)}</div><p className="field-note">Choose a color, then adjust its hex value in the background inspector.</p>
        <div className="library-section-title"><h3>Your uploads</h3></div>{assets.filter(a => a.type !== 'audio').length ? assets.filter(a => a.type !== 'audio').map(asset => <button key={asset.id} className="uploaded-media" onClick={() => { change({ ...project, background: { ...project.background, type: asset.type as 'image' | 'video', source: asset.id, name: asset.name } }); select('background'); }}>{asset.type === 'image' ? <img src={asset.url} alt="" /> : <ImageIcon size={22} />}<span>{asset.name}</span><Plus size={14} /></button>) : <p className="field-note">Your uploaded images and videos will live here.</p>}
      </> : tab === 'audio' ? <>
        <div className="intro-copy"><h3>Let the recitation lead.</h3><p>Place your recording exactly where you want it.</p></div><button className="upload-zone" onClick={() => upload('audio/*')}><span><Music2 size={20} /></span><strong>Upload a recording</strong><small>MP3, WAV, M4A and more</small></button>
        <button className="subtle-button full extract-shortcut" onClick={extractAudio}><AudioLines size={15} />Extract from audio or video</button>
        <RecitationPicker chapter={Number(project.verses[0]?.key.split(':')[0] ?? chapter)} chapterName={chapters.find(c => c.id === Number(project.verses[0]?.key.split(':')[0] ?? chapter))?.name ?? `Surah ${chapter}`} from={Number(project.verses[0]?.key.split(':')[1] ?? from)} to={Number(project.verses.at(-1)?.key.split(':')[1] ?? to)} verses={quran} verseTrack={project.verses} assets={assets} onImport={importRecitation} />
        <div className="library-section-title"><h3>Included recitation</h3></div><button className="audio-asset" onClick={() => addAudio(assets.find(a => a.id === SAMPLE_AUDIO.id) ?? SAMPLE_AUDIO)}><span className="audio-asset-icon"><AudioLines size={20} /></span><span><strong>Al-Fatihah</strong><small>Mishary Alafasy · 46 seconds</small></span><Plus size={16} /></button><p className="field-note">The sample project includes matching verse timings. Choose a timed recitation above, or upload your own recording and adjust the timings.</p>
        <div className="library-section-title"><h3>Your recordings</h3></div>{assets.filter(a => a.type === 'audio' && a.id !== SAMPLE_AUDIO.id).map(a => <button key={a.id} className="audio-asset" onClick={() => addAudio(a)}><span className="audio-asset-icon"><Music2 size={18} /></span><span><strong>{a.name}</strong><small>{formatTime(a.duration ?? 0)}</small></span><Plus size={15} /></button>)}
      </> : tab === 'text' ? <>
        <div className="intro-copy"><h3>Every word, considered.</h3><p>Adjust your verse styles or add a personal title.</p></div><button className="primary-button full" onClick={() => addText()}><Plus size={15} />Add a text layer</button><div className="text-presets"><button onClick={() => addText('A moment of reflection')}><strong>A moment of reflection</strong><span>Add a heading</span></button><button onClick={() => addText('Pause. Listen. Reflect.')}><p>Pause. Listen. Reflect.</p><span>Add a subtitle</span></button></div><div className="library-section-title"><h3>Quran layers</h3></div><button className="reference-library-card subtle-button full" onClick={() => { const reference = project.layers.find(l => l.kind === 'reference'); if (reference) select(reference.id); }}><Type size={15} />Style verse number<ChevronRight size={14} /></button><button className="layer-library-card" onClick={() => select('arabic')}><span className="arabic-example">بِسْمِ ٱللَّهِ</span><span>Arabic verse<ChevronRight size={14} /></span></button><button className="layer-library-card" onClick={() => select('translation')}><span>In the name of Allah</span><span>English translation<ChevronRight size={14} /></span></button>
      </> : <>
        <div className="intro-copy"><h3>A beautiful place to begin.</h3><p>{VIDEO_TEMPLATES.length} starting styles. Every detail is still yours.</p></div><div className="template-gallery">{VIDEO_TEMPLATES.map(template => {
          const background = backgroundForChoice(template.background, project.duration);
          return <button className="template-card" key={template.id} aria-label={`Apply ${template.name} template`} onClick={() => applyTemplate(template.id)}><div style={{ backgroundColor: background.type === 'color' ? background.source : undefined, backgroundImage: background.type === 'image' ? `linear-gradient(#0003,#0007),url(${background.source})` : undefined }}><span dir="rtl" style={{ color: template.arabicColor, fontFamily: fontStack(template.arabicFont) }}>بِسْمِ ٱللَّهِ</span><small style={{ color: template.translationColor, fontFamily: fontStack(template.translationFont) }}>In the name of Allah</small></div><strong>{template.name}</strong><span>{template.subtitle}</span></button>;
        })}</div>
      </>}
    </div>
    <div className="library-bottom"><span className="status-dot" />{tab === 'quran' ? '114 surahs. Always within reach.' : 'Your media. Your creative space.'}</div>
  </aside>;
}
