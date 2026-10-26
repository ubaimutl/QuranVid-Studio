# Public-source release

QuranVid's original code is offered under the root MIT license. `THIRD_PARTY_NOTICES.md` describes separately licensed dependencies, fonts, photographs and optional data sources. A public source release is not a blanket license for media or a clearance of every possible compiled distribution.

## Create a clean checkout

The original private repository's first commit includes third-party data and sample audio. Do not change that repository's visibility to public: removing files in a new commit does not remove their historical copies. Keep it private as your deployment/work archive.

```sh
npm run export:public -- --output=/absolute/path/to/new-public-source
cd /absolute/path/to/new-public-source
git init -b main
npm run audit:public
```

The export uses an explicit source-directory/file allowlist. It excludes original Git history, credentials, generated Quran/translation/timing JSON, the sample MP3, server data, private operations notes, build artifacts and project exports. It preserves all current editor features, content preparation scripts and applicable font/photo notices. It never changes the private working tree or a GitHub repository's visibility.

Review the exported files, then create a new root commit. Publish only this checkout to a new public repository. Do not add/fetch/push branches or tags from the original private repository. Do not push with `--mirror`. A rewrite of the existing remote's entire history and refs would be a separate, destructive operation; this workflow avoids it.

## Before publication

- Check that the chosen application license and contributor copyright line are appropriate.
- Run `npm run audit:public` before and after the initial commit. Enable available GitHub secret scanning.
- Review `THIRD_PARTY_NOTICES.md`, font/photo source records and codec source/licensing requirements. The installed dependency inventory is served at `/licenses/` in prepared builds.
- Follow `docs/CONTENT-SETUP.md` to set up content locally. Keep those files out of Git. Complete production/optional-dataset tests require the corresponding permitted pack.
- Build and test the clean checkout. Review skipped tests and external provider access requirements.
- Publish source separately from compiled app downloads. WebAssembly codec distribution and provider content have additional obligations; the MIT label does not replace them.

Preparing or publishing source does not deploy the app or change the existing VPS, Dokploy settings, OAuth clients, MCP URLs or user data.
