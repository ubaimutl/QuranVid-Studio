# Public video recipe links

Connect ChatGPT or another Streamable HTTP MCP client to:

```
https://quranvid.example.com/mcp/public
```

Choose **No authentication**. No API key, OAuth approval or account is needed for this endpoint. Custom MCP availability depends on the ChatGPT account and workspace. The existing `/mcp` endpoint remains authenticated and can access the owner's server drafts; do not share its credentials.

Example request:

> Use QuranVid to make a portrait video of Al-Fatihah, verses 2–3, with Alafasy, a forest background, gentle zoom, smooth Arabic reveal and a serif English translation. Return the video recipe link.

The public tools are:

- `get_catalog`: verified chapter metadata, prepared reciter/chapter combinations, background names, styles, formats and limits.
- `create_video_link`: validates settings against the prepared catalog and exact verse timings, then returns a URL. For example:

```json
{
  "recipe": {
    "chapter": 1,
    "from": 2,
    "to": 3,
    "reciterId": 7,
    "format": "portrait",
    "background": "forest",
    "arabicAnimation": "typewriter",
    "translationFont": "serif",
    "motion": "zoom-in",
    "motionStrength": 6
  }
}
```

The tool's input schema also exposes fonts, translation/title/reference visibility, reference format, text reveals, image movement, dimming, design templates, solid backgrounds and bounded typography/position overrides. `version` currently defaults to `1`. Unsupported fields are rejected: recipes cannot supply Quran text, arbitrary media URLs, HTML, script, server asset IDs or an automatic export command.

## Solid colors and templates

Static solid backgrounds need no imported image. Use `"background": "dark-gray"` for `#272727`, or `"backgroundColor": "#343434"` for any six-digit hex color. Named colors are dark-gray, black, midnight, deep-olive, parchment, ivory, slate, emerald and warm-brown. Solid backgrounds automatically disable dimming and background movement, even if a previous recipe used a zoom. Text can still animate. Custom hex colors take precedence over a named background or a template background.

Ten templates are shared by the editor and MCP: Stillness, Forest, Coast, Charcoal, Midnight, Olive, Parchment, Ivory, Black & gold and Slate. Choose the corresponding `template` ID from `get_catalog`; for example:

```json
{
  "recipe": {
    "chapter": 1,
    "from": 1,
    "to": 7,
    "reciterId": 7,
    "template": "charcoal"
  }
}
```

Templates set background, typography, colors, layout and text reveal defaults. Explicit recipe settings override those defaults, including `false`, `0`, a specific font or custom layout color. Parchment and Ivory include dark ink for their light backgrounds. Template IDs are stillness, forest, coast, charcoal, midnight, olive, parchment, ivory, black-gold and slate. Applying a template in the editor preserves the project duration, Quran text, split parts, all audio and timeline placement, and custom text layers; undo restores the previous style.

In the editor, choose a solid swatch under **Media → Solid colors**, then use **Background color** in the inspector for a custom hex value. The picker stays inside the window. If an existing client still advertises only the old three backgrounds, refresh its tool definitions and read `get_catalog` again.

## Opening a link

1. New URLs use short, readable fragment settings, such as `#create=1&chapter=1&from=2&to=3`. Default settings are omitted. Nested layout overrides use URL encoded JSON. Valid older `#recipe=` base64url links remain supported. Recipes contain settings, not media, tokens or a private project identifier, and are capped at 8 KiB of settings and 12,000 fragment characters. Anyone holding a link can read and reuse its settings; there is no server record to expire or revoke. The MCP returns a direct resource link and instructs clients to pass the URL through unchanged rather than recreating encoded data.
2. The browser validates the recipe and loads bundled Quran text, chapter names and timing metadata. A review dialog appears without replacing the current project or downloading the remote recitation.
3. Clicking **Prepare video** fetches recitation directly from the audio CDN and extracts the selected range locally. The browser creates an editable timeline using canonical text and verified verse boundaries. The new project, its audio and the previous project are saved together in one IndexedDB transaction.
4. The user previews or edits, then clicks **Export video**. Rendering and audio mixing happen on the device. MP4/WebM support and speed depend on the browser. There is no automatic download or server rendering.

Failed preparation and cancellation preserve the current project. If a CDN blocks cross-origin access or goes offline, preparation reports an error and can be retried. A valid recipe can also be canceled before downloading audio.

## Scope and hosting cost

The public MCP has no access to the private store, media importer or authorization provider. Calls read only bundled metadata and perform no server project, media, handoff or OAuth writes. They do not download recitations or external images. The website still serves its static code, fonts, bundled photographs and metadata; the VPS still handles small MCP requests. Existing request rate limits apply, and public MCP JSON bodies are limited to 32 KiB.

The initial catalog has prepared recordings for Al-Fatihah and Al-Baqarah; reciter availability varies. Use `get_catalog` rather than assuming all 114 surahs have audio. Ranges are limited to 100 verses and 10 minutes. Production catalog preparation can expand this later without putting Quran Foundation credentials in the browser.

Public recipes use bundled photographs or static colors, with shared templates. Users can replace the background or add their own recordings in the editor after opening. Arbitrary URL imports and server editing remain part of the private API/MCP workflow. Existing private drafts and share links continue to work.

The URL fragment is not included in the HTTP request to the server. It remains visible to anyone receiving the full link and to code running on the page. Projects and uploaded media remain in browser storage; users should download a project backup before clearing site data.

## Local development

With the companion service running at `http://localhost:4310`, connect to `http://localhost:4310/mcp/public` with no authentication. Generated links use `QURANVID_PUBLIC_URL`. The static editor also opens recipe fragments when served without the companion; only generating links via MCP needs the service.

Run `npm test`, `npm run test:server`, and `npx playwright test tests/browser/recipe.spec.ts` to verify recipe validation, anonymous MCP isolation, actual local preparation and MP4 export, persistence, failure and cancellation.
