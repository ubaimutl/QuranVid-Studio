# Prepared recitations

## Quran Foundation production catalog

The catalog prepared on 2026-10-25 contains 21 Quran Foundation recitation entries and 2,374 chapter recordings. Sixteen entries have all 114 surahs; five have the omissions below. With the separately prepared Islam Sobhi entry, the editor and MCP expose 22 recitation options and 2,479 timed chapter recordings. Different styles from the same reader are separate entries.

| Entry | ID | Unavailable surahs |
| --- | --- | --- |
| Mishari Rashid al-Afasy, Murattal | 7 | 37, 38, 40, 42, 60 |
| Mishari Rashid al-Afasy, Streaming | 173 | 1 |
| Abdul Basit Abdul Samad, Murattal | 2 | 2 |
| Khalifah Al Tunaiji | 161 | 13 |
| Muhammad Siddiq al-Minshawi, with kids | 168 | 2, 11, 19, 33, 36, 37, 41, 43, 62, 75, 101, 113 |

These 20 recordings have incomplete, out-of-order or significantly overlapping verse boundaries. They are excluded, not guessed or substituted. The validator permits up to 100 ms of overlap already present in source metadata and does not rewrite those boundaries. Source labels such as beta and kids repeat are retained. Structural validation does not replace listening review of every recording.

The combined static timing files total about 6.3 MB before compression. The browser loads one recording's small timing file when selected and fetches audio directly from its public CDN. No Quran Foundation secret or access token is required by the deployed site or sent to the audio CDN. Production credentials are used only during developer-side metadata preparation.

To refresh, set `QF_ENV=production`, `QF_CLIENT_ID`, and either `QF_CLIENT_SECRET` or `QF_CLIENT_SECRET_FILE`, then run `npm run prepare:recitations`. A secret file must contain just the secret value. Use `--output-dir` to inspect a separate destination; initialize that directory from the current catalog when preserving independently prepared providers in a staging build. No preparation runs at application startup or build time.

## Islam Sobhi

Islam Sobhi uses QuranVid reciter ID **9001**, independently of Quran Foundation's numeric IDs. It is advertised in the existing editor picker and both MCP catalogs. Public recipes must explicitly set `reciterId: 9001`; existing links keep their current reciter.

The bundled data covers 105 complete surahs. Surahs **4, 7, 9, 37, 39, 40, 45, 65 and 109** are unavailable in this pinned release. Never substitute another recording or estimate missing verse timings.

Islam Sobhi adds about 255 KB of verse metadata, split into one small JSON file per surah. The browser fetches only the selected surah's metadata. Clicking Prepare video or Add verses & recitation opens the matched MP3Quran URL directly, decodes the chosen range locally and saves the clip in IndexedDB. Audio requests do not pass through the VPS. Existing browser range fetching is used where supported by the CDN. Public MCP calls read local metadata and generate a link; they do not download audio or save projects.

The existing private project's audio import remains a separate, server-based workflow. Use `/mcp/public` for the stateless browser workflow with the least VPS load.

## Regenerating the data

Run `npm run prepare:islam-sobhi` with Python 3 (standard library only). This is a developer preparation step, never a runtime/build/startup task. No credentials are needed. The importer pins the v4.0.0 package and verifies its SHA-256 before writing any files. For offline regeneration, use `npm run prepare:islam-sobhi -- --archive /absolute/path/islam_sobhi_mp3quran.zip`.

The importer requires complete canonical coverage, finite ordered non-overlapping timestamps, the known source URL for each surah and the expected Hafs schema. Adjacent repetitions are combined; backtracking or invalid timing excludes the surah. Existing reciters are preserved. `npm run prepare:recitations` also preserves the external entry when refreshing Quran Foundation data.

Credits and license details are in [the bundled sources](../public/data/recitations/SOURCES.md) and the editor's Media credits. The timing license does not apply to the audio recordings.

## Validation

Run `npm run test:recitations`, `npm test`, `npm run test:server`, and `npm run typecheck`. The browser suite includes a deterministic import test. To check the actual CDN download and a short MP4 export, run `QURANVID_TEST_LIVE_RECITATION=1 npx playwright test tests/browser/islam-sobhi.spec.ts` with the local editor running on port 3000. That check requires network access and browser MP4 encoding support.
