# Mobile editor preview

The `feat/mobile-editor` branch adapts the existing editor for compact screens. Desktop editing uses the existing sidebars. No separate project format, server rendering or media upload service is introduced.

## Editing on a phone

- The preview and timeline stay on screen above a bottom toolbar.
- Quran, Templates, Media, Audio and Text open a sheet. Done, the backdrop or the active toolbar button closes it.
- Tap a timeline clip, then Edit to adjust its properties. Text and verse styles chosen in the library open the settings sheet directly.
- Swipe the timeline to navigate. Enable the hand button (Move clips) to drag clips and trim handles. Turn it off to scroll again.
- Use timing fields for precise edits, and Editor controls in the header to reveal Undo/Redo and canvas options. The extra toolbar stays hidden until requested.
- Drag the divider above the timeline to resize it in portrait. Landscape puts the preview beside the timeline and disables the vertical divider.
- Export stays on the device. Supported formats and the optional 720p output work as before.

## Verification

`tests/browser/mobile-editor.spec.ts` uses isolated Chromium contexts with touch emulation, including native touch events for swiping and dragging. It covers 320–932 pixel viewports, rotation, library sheets, templates, text editing, undo, persistence, splitting, color controls and a real MP4 export with recitation. Existing editor and panel tests cover desktop regressions.

Run with the local development server on port 3000:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/quranvid-browsers npx playwright test tests/browser/mobile-editor.spec.ts
```

This is browser emulation, not validation on physical iOS/Android hardware. A real-device check should cover the software keyboard, Safari's file picker and codec availability, long exports, memory use and backgrounding. Physical-device access needs HTTPS (or a localhost port-forward); ordinary HTTP over a LAN does not provide all the secure browser APIs used by the editor.

## Install on a phone or desktop

Open the project menu beside the project name and choose **Install QuranVid**. Supporting browsers show their install prompt; other browsers show instructions. On iPhone/iPad, use Safari → Share → Add to Home Screen. The manifest includes standalone display mode and home-screen icons based on the existing logo.

This is an online PWA: there is no service worker or offline cache. An internet connection loads the editor and online media. Projects and imported assets remain in the same browser storage; installing does not upload or back them up. Keep project backups before clearing site data. Installation and codec support still require verification on physical devices.
