# App updates (Zephyr)

VideoHub updates itself from a **Zephyr application**, `videohub-updates` (project `videohub`, organization `cayden`). It serves two static
files: `manifest.json` (version, file name, SHA-256, size, notes) and `videohub-<version>.tar.gz` (the code, never `node_modules`, `data/`
or `hub.json`).

## For the user (bottom left of the window)
- **Check for updates**: one small request for `manifest.json`. Nothing is downloaded until you ask.
- **Download update and restart**: downloads the package, checks its SHA-256, backs up the code it replaces to `data/update-backup/<time>/`,
  copies the new code over, runs `npm install` only if `package-lock.json` changed, then the server restarts and the window reloads.
  Films, notes, settings and `data/` are never touched. Refused while a render is running or queued, or a cleanup runs.

## Publishing a release (the developer)
1. Raise `version` in `package.json`.
2. `npm run release` (builds `release/`, then `zephyr-cli deploy release`; the first time Zephyr asks you to sign in in the browser).
   `npm run release:build` only builds the folder.
3. Put the address Zephyr prints into `videohub.updateUrl` in `package.json` (or in the app: `POST /api/update/config {"url": "https://..."}`,
   stored in `data/updates.json`). It must be https (plain http only for localhost).

Code: `server/updater.js` (check, verify, install, restart; unit-tested in `updater.test.js`), routes `/api/update*` in `server/hub.js`,
the buttons in `ui/app.js` (`updateBox`), the package builder `scripts/make-release.mjs`, the uploader `scripts/release.mjs`.
`RELEASE_ITEMS` in `server/updater.js` must stay in step with `ITEMS` in `update.sh`.
