# Recitation sources

## Islam Sobhi

Audio is fetched directly by the user's browser from [MP3Quran](https://www.mp3quran.net/eng/islam), using the exact recording URLs supplied with the timing dataset. QuranVid does not bundle or proxy these recordings. The audio is not covered by the timing data's license.

Verse timings are adapted from [Quranic Universal Audio, v4.0.0](https://github.com/QUD-Technologies/quranic-universal-audio/releases/tag/v4.0.0), by the Quranic Universal Audio contributors, licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).

Changes: converted milliseconds to seconds, combined consecutive repetitions of the same verse into one display interval, omitted word/letter timing data, and excluded incomplete surahs. Attribution is preserved in imported audio credits and portable project backups.

The pinned `islam_sobhi_mp3quran.zip` has SHA-256 `6d2eea9e86c30bb4fdf685a1999f1258f4e54a6b8180ece9f0eb2b2a0966c88d`.

## Quran Foundation

The 21 production recitation entries come from the [Quran Foundation / Quran.com](https://quran.com) Content API, prepared on 2026-10-25. Metadata contains public CDN URLs and the matching verse boundaries. Twenty recordings with missing or invalid timings are excluded; minor source overlaps up to 100 ms are retained. Audio is fetched directly from QuranicAudio by the browser. Preparation credentials and tokens are not included in the application. Refreshing these recordings preserves the independently imported Islam Sobhi catalog entry.
