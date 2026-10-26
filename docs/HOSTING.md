# Hosting QuranVid

Prepare permitted content first using `docs/CONTENT-SETUP.md`. Build with `npm ci` and `npm run build`, then serve `out/` on an HTTPS static host. Rendering, local uploads and video export run in the browser. Codec support depends on the browser and OS.

## Optional companion service

The Dockerfile builds the static editor and serves it through the companion API on port 4310. Prepare the content in your private build context first. `compose.yaml` binds port 4310 to loopback and stores server data in the `quranvid-data` volume. Do not commit that volume or any content packs.

Run `npm run server:setup` to generate your own ignored `.env`. Set `QURANVID_PUBLIC_URL` to your HTTPS origin and keep `QURANVID_API_KEY` private. Browser editing does not require that key. See `docs/AGENT-API.md` for the single-owner authentication model and `docs/PUBLIC-RECIPES.md` for the anonymous recipe-only MCP.

Behind a trusted reverse proxy, set `QURANVID_PROXY_MODE=reverse-proxy`. Use `cloudflare-tunnel` only when all origin traffic comes through that trusted tunnel. Keep the application port private and preserve your ingress/firewall controls. Configure exact trusted MCP browser origins using `QURANVID_MCP_ALLOWED_ORIGINS`.

## Dokploy

Create a Dokploy application from your source repository or a private source ZIP containing your permitted, locally prepared content. Use the repository Dockerfile, internal port 4310 and a persistent mount at `/data`. Set secrets through Dokploy's environment settings, never client-side variables or committed files. Point your domain or tunnel at the application's configured ingress. Do not create a separate manually managed container for an existing Dokploy application.

The public health endpoint is `/health`. Preserve the data volume during updates: it contains imported media, projects, handoffs and OAuth records. Back up it and runtime credentials separately. Source archives are not data backups. Keep backups and administrative access keys outside the web root and Git.

For a source ZIP, exclude `.env*` except `.env.example`, `.git/`, `node_modules/`, `.next/`, `out/`, `.private/`, browser/project exports, logs and `.quranvid-server/`. Provider content included in a deployed build still needs appropriate usage and redistribution rights.
