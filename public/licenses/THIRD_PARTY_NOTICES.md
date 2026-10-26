# Third-party materials

The root MIT license covers QuranVid's original application code. It does not relicense dependencies, fonts, photographs, Quran datasets, translations, recordings, provider APIs or timing datasets.

## Application dependencies

The exact versions and dependency graph are recorded in `package-lock.json`. Install packages with `npm ci`; preserve their bundled license files. Unmodified dependencies are referenced through npm, not copied into QuranVid's original source.

| Dependency | License | Upstream source |
| --- | --- | --- |
| Next.js | MIT | https://github.com/vercel/next.js |
| React, React DOM | MIT | https://github.com/facebook/react |
| Mediabunny, AAC encoder, MP3 encoder | MPL-2.0 | https://github.com/Vanilagy/mediabunny |
| Model Context Protocol TypeScript SDK | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| Express | MIT | https://github.com/expressjs/express |
| express-rate-limit | MIT | https://github.com/express-rate-limit/express-rate-limit |
| idb | ISC | https://github.com/jakearchibald/idb |
| ipaddr.js | MIT | https://github.com/whitequark/ipaddr.js |
| Lucide React | ISC | https://github.com/lucide-icons/lucide |
| tsx | MIT | https://github.com/privatenumber/tsx |
| Zod | MIT | https://github.com/colinhacks/zod |

Mediabunny copyright: 2026-present Vanilagy and contributors, as recorded in its source headers. MPL-covered source remains under MPL-2.0. QuranVid has not modified those package source files. Package source is included in the upstream repository and npm package at the exact installed version. Preserve notices and provide the corresponding source location when distributing a compiled build. The MPL does not replace the license of QuranVid's separate original files.

The AAC extension embeds a WebAssembly build of FFmpeg's native AAC encoder. The MP3 extension embeds LAME 3.100 under LGPL. These embedded libraries retain their own licenses independently of the MPL JavaScript wrapper. LAME source: https://sourceforge.net/projects/lame/files/lame/3.100/ . FFmpeg source: https://ffmpeg.org/download.html . Source and bridge build instructions are in each extension's upstream README under `packages/aac-encoder` and `packages/mp3-encoder`. Preserve applicable LGPL notices and corresponding-source/relinking rights when distributing the compiled WebAssembly. An upstream source link by itself is not a blanket compliance guarantee. Review the exact shipped binary/source pairing before publishing downloadable compiled distributions.

Sharp's optional libvips packages have LGPL-3.0-or-later components. They are platform dependencies, not QuranVid code. The Docker image installs FFmpeg from Debian; Debian's package copyright and source-package notices also apply. A generated dependency/license inventory and available installed license texts are provided under `public/licenses/` for the web build. It supplements, rather than replaces, upstream package notices.

## Fonts

DM Sans, Noto Naskh Arabic, Amiri Quran, Amiri, Scheherazade New and Lateef are bundled unmodified under SIL Open Font License 1.1. Original copyright and license files are preserved in `public/fonts/`. See `public/fonts/SOURCES.md`. The fonts are not MIT-licensed by this project.

## Photographs

The three bundled photographs were obtained from Unsplash; their source URLs and the Unsplash license link are preserved in `public/backgrounds/SOURCES.md`. They are not public domain and are not covered by QuranVid's MIT license. The Unsplash license has its own restrictions, including on competing image collections and selling unmodified copies.

## Quran content and recordings

Public source snapshots exclude prepared Quran/translation JSON, recitation catalogs/timing JSON, generated sample verses and the sample recording. Their original availability through Quran.com/Quran Foundation does not grant an MIT license. See `docs/CONTENT-SETUP.md`, `public/data/SOURCES.md` and `public/audio/SOURCES.md`. Operators must establish permission for their particular data, recordings and use. Downloading separately does not remove those obligations.

Quran.com's frontend/editor source is not vendored. This application uses API response data and has its own editor implementation. No Quran.com trademarks or logos are included or licensed by this project.

The optional Islam Sobhi timing importer adapts Quranic Universal Audio v4.0.0, CC BY 4.0, crediting the Quranic Universal Audio contributors. Conversion changes and the pinned release are documented in `public/data/recitations/SOURCES.md`. That timing license does not license the referenced MP3 recordings.

User-imported media and generated project exports retain their respective rights. A project's media credit is provenance information, not proof of permission.
