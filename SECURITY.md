# Security

Do not include credentials, private media, project exports or live server data in issues or pull requests. Report security problems privately to the repository owner before disclosing details publicly; use GitHub's private vulnerability reporting if it is enabled.

The companion service is currently single-owner: authenticated API clients can access the owner's server projects and media. Keep the owner key private. Public recipe MCP access is separate and does not grant private-project access. See `docs/AGENT-API.md` for the trust model and deployment limits.

Before publishing source, run `npm run audit:public` in the clean public checkout. It checks tracked and eligible untracked files and all local Git refs for excluded content and recognizable credentials. For a local comparison against known credentials, optionally use `-- --secrets-from=/private/path/to/.env`; values are never printed. Pattern scanning does not prove the absence of all secrets. Enable GitHub secret scanning/push protection where available.

A leaked credential must be revoked and replaced. Removing it in a later commit does not remove it from Git history, forks, downloads or caches. `.gitignore` and export filters do not retroactively remove tracked files or history.
