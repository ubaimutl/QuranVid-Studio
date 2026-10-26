# QuranVid

A local-first Quran video editor built with Next.js and TypeScript. Editing, playback, local project storage, audio processing, and video export happen in the browser. The editor can run as a standalone static site. An optional authenticated companion service adds a project API, MCP tools, external media search/import and editable draft links; it serves the same static editor.

For server setup, agent/ChatGPT connections, media imports and Docker deployment, see [the API and MCP guide](docs/AGENT-API.md).

Deployment and Dokploy setup are documented in [the hosting guide](docs/HOSTING.md).

## Development

```sh
npm ci
# First obtain content you are permitted to use; see docs/CONTENT-SETUP.md.
npm run prepare:content -- --from=/absolute/path/to/content-installation
npm run dev
```

Public source releases omit prepared third-party text, timing data and sample audio. [Content setup](docs/CONTENT-SETUP.md) also documents an explicit provider-download option and its limitations. Fonts and photographs retain their separate licenses.

Open http://localhost:3000. A current Node.js LTS release is recommended.

```sh
npm run build
```

Deploy the generated `out/` directory to an HTTPS static host. Serve the fonts, photographs and locally prepared content along with it only with appropriate provider permissions. WebCodecs requires HTTPS or localhost.

## Editing

- Start with the included Al-Fatihah project and Mishary Alafasy recitation, with verse timings from Quran.com.
- Select from all 114 surahs and 6,236 verses, bundled as local JSON. Replacing the verse range removes its previous library recitation (including the sample) and creates evenly spaced placeholder timings for manual adjustment. Separately added audio is retained. Undo restores the previous verses and recitation together.
- Upload audio, images, or a background video. Files are stored in this browser's IndexedDB.
- Drag text on the canvas; resize using its bottom-right handle. Adjust typography, line height as a percentage, alignment, position, width, opacity and layer timing in the properties panel.
- Replace the background directly from the canvas toolbar or background properties without visiting the media library.
- Drag the end handle in the timeline ruler (or the background’s right edge) to resize the video. A final verse anchored to the old end and full-length text layers follow the new end. Shortening stops before other verse or audio content. Extending a verse or moving audio beyond the current end grows the project automatically.
- Move and trim audio and verse clips on the timeline. Audio supports source offsets, volume, fades, splitting and duplication. Multiple audio clips mix together.
- Play a custom recording and use tap-to-sync in the Quran panel to mark consecutive verse starts. Fine-tune the boundaries afterward.
- Choose portrait, square, 4:5 or landscape output. Customize background framing, zoom, blur and darkening.
- Projects save automatically on this device. The project menu downloads a portable JSON backup containing the current project and all its referenced uploaded files. The same menu opens backups.

## Recitation library and audio extraction

In the Quran panel, choose a surah and verse range, select a reciter, then choose **Add verses & recitation**. This downloads the selected audio range, stores it locally, and updates the verse track using the recording's verified timestamps. Previously imported library recitation is replaced; uploaded audio is retained. The project fits the recitation and any remaining audio or independently timed text. Imported ranges are cached on this device and included in project backups.

The prepared production catalog includes 21 Quran Foundation recitation entries (2,374 chapter recordings), plus Islam Sobhi for 105 complete surahs. Only recordings with complete, ordered timings are selectable; other reciters remain visible as unavailable for that surah. Changing the surah, range or verse track cancels a pending import before it can replace the new selection. The full timing library is about 6.3 MB, split by reciter and chapter; browsers load only the selected recording's metadata. Audio downloads directly from the source CDN, with no VPS proxy or bundled recitation files beyond the existing sample. Audio and timing credits are retained separately. See [recitation coverage and preparation](docs/RECITATIONS.md) for unavailable recordings and source details.

In Audio, choose **Extract from audio or video**, open a local file, and select its start and end using timestamps or waveform handles. Click or drag the waveform, or use the playback slider, to listen from any point without changing the extraction range. Play resumes at the playhead; Play selection starts at the selected beginning and stops at the selected end. Set to playhead beneath either timestamp marks that boundary at the current listening position. Download the range as a 192 kbps MP3, or add it to the timeline as uncompressed audio. Video imports use the file's audio track; they do not require decoding the video frames. Codec support depends on the browser. The included MP3 encoder runs locally in WebAssembly.

Prepare or refresh the static recitation catalog locally:

```sh
npm run prepare:recitations
```

The script reads `QF_CLIENT_ID`, `QF_CLIENT_SECRET`, and `QF_ENV` from the ignored `.env` file or the process environment. Alternatively, set `QF_CLIENT_SECRET_FILE` to a private file containing just the secret; this takes precedence over an inline secret. `QF_ENV` is `prelive` by default; use `production` with production credentials. Pre-live preparation defaults to chapters 1 and 2. Production preparation defaults to all chapters. Optional `--chapters=1,2` and `--reciters=6,7,12` arguments limit the preparation run; `--output-dir=/absolute/path` prepares metadata separately for review. Existing entries in the destination catalog are preserved when refreshing other reciters. Only names, public recording URLs and normalized verse timestamps are written. Missing verses, reversed clocks or overlaps greater than 100 ms exclude the recording; minor source overlaps are retained without inventing replacement timings. Transient API errors are retried with backoff. Tokens remain in memory; credentials are never used by application components or sent to the audio CDN. Preparation is separate from `npm run build`, so hosting never requires Quran Foundation credentials.

Space plays/pauses. S opens the word-break editor when a verse is selected; otherwise it splits audio at the playhead. Delete removes the selection. Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z redoes. Arrow keys move a frame; Shift+arrows move a second.

## Long verse parts

Select a verse in the Quran list or timeline, then choose **Split verse into parts** in the inspector. Choose breaks between Arabic words, or suggest two, three or four balanced parts. Up to 16 parts are supported. Arabic words and their diacritics stay intact. Listen to the recitation, mark each part's end at the playhead, or enter the end times in seconds. Initial timings are word-count estimates, not automatic speech alignment. Each part needs at least 0.1 seconds.

Keep the full translation on every part, or manually enter the corresponding translation for each part. Changing word breaks resets estimated times and part translations. Creating parts leaves the project's duration, audio, background and layer styles unchanged. Text transitions repeat per part in both preview and export.

Drag a shared part edge to adjust both neighboring timings together. Drag a part's body to move the whole verse's parts together. **Merge verse parts** restores the exact original verse and translation over the parts' current combined time range. Merge requires all parts to remain present; undo a part deletion before merging. Splitting and merging support undo/redo, local saves and portable project backups. Existing projects remain compatible.

## Fonts and visual transitions

Select an Arabic verse layer to choose Noto Naskh Arabic, Amiri Quran, Amiri, Scheherazade New or Lateef. The fonts are bundled locally with their original Open Font License notices. These choices render the same verified Unicode Quran text; they do not change the text, recitation or script edition. Translation, title and reference layers can also choose DM Sans or system sans-serif, serif and monospace. System choices use the browser's installed fonts; preview and export use the same font on that device. Preview and export explicitly wait for downloadable fonts to load.

In **Text → Style verse number**, change the live reference's font, color, size, position, opacity, visibility and timing. Choose a full reference (`Quran 49:14`), chapter and verse (`49:14`), or verse number alone (`14`). The layer follows the active verse, including split parts. Existing saved projects and backups automatically gain an editable reference while preserving its previous visibility. The existing surah title remains a regular editable text layer.

The text color control opens an in-page picker with saturation/brightness, hue, hex input and presets. It stays within the viewport, including on mobile. Escape closes it and returns keyboard focus to the color control.

Optional text reveals include Typewriter, Word by word and Line by line, with duration from 0.1–10 seconds. They reveal the fully laid-out text without changing wrapping or position. Typewriter reveals complete graphemes in Latin text; Arabic smoothly uncovers fully shaped text from right to left with a soft edge. Line by line uses overlapping fades instead of sudden appearances. Word by word remains available as a distinct stepped effect. Reveals restart at each verse or split part; custom titles reveal once at their own start. Short clips shorten the reveal to leave time for reading. Preview and export calculate the effect from the same timeline time.

Text transitions are optional and default to None. Each layer has separate entrance and exit choices (Fade, Slide up, Slide down, Slide left, Slide right or Soft zoom), with an adjustable duration of 0.1–3 seconds. Arabic, translation and reference transitions repeat at each verse or part's timing boundaries; titles use their own layer timings. Very short clips automatically shorten the effect so the text can reach full visibility. Preview transition starts playback near the relevant boundary.

Select the background and use **Image animations** (or **Background animations** for video/color) for optional entrance/exit effects at the project's beginning and end. The **Try gentle zoom in** button starts a gentle zoom preview; **Apply gentle zoom preset** restores the preset while another motion is selected. The gentle preset enlarges the image by 6% across the full project, without repeating; it keeps the text still. Background motion also offers zoom in/out, horizontal and vertical pans, Zoom & drift, and Zoom in & out. Adjust Motion strength and Motion duration; enable Repeat back and forth for smooth continuous movement. New selections start with up to 12 seconds of motion, then hold the final framing. Existing saved motion without these settings keeps its original full-project duration. Text stays in place while the image moves. This applies to the current full-project background; transitions between multiple background shots are not included. The same canvas renderer draws these effects in the preview and exported video. Existing saved projects retain their original fonts and still appearance unless effects are selected.

## Browser export

Public ChatGPT/MCP connections can use `https://quranvid.example.com/mcp/public` with **No authentication** to generate editable video recipe links. The browser reviews settings, downloads prepared recitation directly from the audio library and exports locally. This endpoint cannot access private server projects or import external media. See [Public video recipes](docs/PUBLIC-RECIPES.md) for setup and an example prompt.

The editor and both MCP endpoints share ten templates and nine named solid backgrounds. Public recipes accept `background: "dark-gray"`, any custom `backgroundColor: "#272727"`, or a template such as `template: "charcoal"`. Solid backgrounds are static and need no image import. Explicit recipe settings override template defaults. Templates enable **Auto-fit text**: Arabic and translation use measured font bounds, maintain a gap, and use the space between the title and reference before reducing font sizes (up to 25%). Layout stays fixed throughout each verse’s animations; preview and export share the same fitting. Very long verses show a suggestion to split them into parts. The Text layout switch is available in the inspector, including for older projects; moving either text block switches to manual positioning while keeping the current fitted placement. Existing saved projects stay manual until you enable fitting or apply a template. In the editor, apply a template from Templates or choose a Media color swatch and adjust its hex value in the background inspector; verses, audio, split parts and timings are preserved.

The preview and final video use the same Canvas 2D renderer. Mediabunny encodes frames through WebCodecs and muxes the output. Web Audio mixes recordings with their timeline placement, source trim, gain and fades.

MP4 uses H.264 + AAC; WebM uses VP9 + Opus, with VP8 as a fallback when VP9 is unavailable. A locally bundled, lazily loaded Mediabunny AAC encoder supplies AAC when the browser lacks native encoding. H.264/VP9 support still depends on the browser and OS. The export dialog checks codecs at the selected output resolution, selects a supported default (WebM when H.264 is unavailable), and disables unavailable formats before export. An optional 720p output reduces encoding work without changing the editable canvas, layout, frame rate or timings. No frames are intentionally skipped, and audio is retained. Keep the export tab open. Performance and available memory depend on the device.

## Current boundaries

- One background image/video fills the project; a background video loops and its original audio is muted. Multiple background shots and image/logo overlays are future work.
- The bundled offline sample recording is Al-Fatihah. Additional timed recitations are available through the prepared catalog and require an internet connection on first import. Other recordings use manual timing. No automatic alignment of uploaded recordings or word-by-word highlighting is included.
- The Quran range picker replaces the current verse track and supports up to 100 verses at a time. Projects support durations up to 10 minutes; long full-resolution exports can use substantial browser memory.
- Automatic saves are local to this browser. Clearing site storage removes them. Download a backup to transfer projects or retain a separate copy.
- The mobile editor uses bottom tools, editing sheets and a compact header. Desktop offers more room for precise timeline editing. PWA installation is available; it requires a connection to load the editor and online media.
- No runtime Quran API credentials are needed. The bundled text does not automatically update; source provenance is recorded in `public/data/SOURCES.md`.

## Verification

```sh
npm run typecheck
npm test
npm run test:server
npx playwright install chromium
npm run test:e2e
```

Browser tests expect the development server at http://localhost:3000. They check editing, undo/redo, persistence, the local Quran library, audio placement/trimming/splitting, portable backups, responsive layout and real browser video exports. Export tests write `/tmp/quranvid-export-verification.webm` and `/tmp/quranvid-export-verification.mp4` for independent inspection.

## Sources and dependencies

- Quran text, Saheeh International translation, chapter metadata and sample timings: Quran.com public API. See the data provenance file for endpoints and retrieval date. Content and recordings have their own applicable rights, separate from application dependencies.
- Recitation: Mishary Rashid Alafasy via QuranicAudio/Quran.com.
- Background photos: Unsplash. See `public/backgrounds/SOURCES.md`.
- DM Sans, Noto Naskh Arabic, Amiri Quran, Amiri, Scheherazade New and Lateef: Google Fonts, SIL Open Font License. License files are included in `public/fonts/`.
- Next.js, React, Mediabunny, its AAC and MP3 encoder extensions, idb and Lucide are used under their respective package licenses. Quran.com frontend/editor source is not vendored; the editor uses API data with separate provider rights. See [Third-party notices](THIRD_PARTY_NOTICES.md).

## License and public source

Original application code: [MIT](LICENSE). Dependencies, fonts, photographs, datasets and recordings retain their own licenses and rights; see [Third-party notices](THIRD_PARTY_NOTICES.md). The code license does not grant rights to recitation recordings or translations. Prepared builds expose dependency notices at `/licenses/`.

Use the [clean public-release workflow](docs/PUBLIC-RELEASE.md) to export a source checkout without private history, credentials or prepared content. Do not make the original private repository public: its history contains data and sample media omitted from the clean release. Preparation does not deploy or publish anything.
