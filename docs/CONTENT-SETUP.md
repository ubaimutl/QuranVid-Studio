# Local content setup

The public source release contains the editor, fonts and background images with their notices. It omits prepared Quran/translation datasets, sample verses, recitation metadata and the sample MP3. These materials have separate provider terms and are not covered by the code's MIT license. Source notes identify where the existing local content came from; they are not permission grants.

## Import a permitted local content pack

If you already have a QuranVid content installation you are permitted to use, keep its directory structure and run:

```sh
npm ci
npm run prepare:content -- --from=/absolute/path/to/content-installation
npm run dev
```

The source must contain:

- `public/data/chapters.json`: 114 chapter records `{id, name, arabic, count}`.
- `public/data/quran.json`: 6,236 ordered `{key, arabic, translation}` records. Obtain permission for the translation and the particular digital text source.
- `public/data/recitations/catalog.json` and `public/data/recitations/7/1.json`: catalog entry and exact recording timings for the starter Al-Fatihah recording.
- `lib/sample-data.json`: seven matching `{key, arabic, translation, id, start, end}` starter clips.
- `public/audio/al-fatihah-alafasy.mp3`: the matching recording, with permission for your intended use.

The importer validates the staged files before installing them. It never executes code from a content pack or copies `.env`, credentials, project backups or arbitrary directories. Existing content is preserved unless you explicitly pass `--force`. The current starter project expects the Alafasy Al-Fatihah timing version ending at 46.49 seconds.

Additional numeric per-reciter/chapter JSON files are copied for an existing catalog. Audio is downloaded directly by the browser when the user imports an additional recitation. A complete catalog must include every file it advertises.

## Explicit provider download

After reviewing the relevant providers' terms and establishing permission for your intended use, you can explicitly request the legacy public Quran.com v4 content:

```sh
npm ci
npm run prepare:content -- --download
npm run dev
```

This fetches the full Arabic text, chapter metadata, resource 20 (Saheeh International) translation, starter Alafasy Al-Fatihah timing metadata and its MP3. It creates a minimal catalog containing that recording. It does not silently download content during installation or build. It does not embed credentials. Provider availability or access requirements can change; on a provider error, import a permitted prepared pack instead. Fetching content separately is not a substitute for usage/redistribution permission.

To add your own Quran Foundation recitation catalog, see `docs/RECITATIONS.md`. `npm run prepare:islam-sobhi` optionally prepares the separately attributed CC BY 4.0 timings; the referenced audio has its own rights. Neither expands your rights to the original recordings.

## Build and test

```sh
npm run check:content
npm run build
npm test
npm run test:server
```

The build guard explains missing content before Next.js starts. Docker also needs a locally prepared content pack in its build context; prepare it before building. Do not put API credentials in the image. Runtime browser exports and private local projects work as before.

Tests requiring the full production voice collection or the optional Islam Sobhi timing dataset are reported as skipped when those datasets are absent. They still run with the full production pack. Browser tests require Chromium and a running development server; individual reciter-dependent scenarios may require the complete prepared catalog.

Generated data, catalogs and audio are ignored by Git and excluded by `npm run export:public`. They are included in your own local build output, so publishing `out/` still distributes those materials: resolve their rights before deploying. Your existing deployment is not changed by preparing the source release.
