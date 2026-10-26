# Folder App — Test Release 1

Windows Electron prototype for creating a project folder structure with starter Markdown documents, then browsing the result on a shared drive.

## Run and package

Requirements: Windows, Node.js 24, npm.

```powershell
npm ci
npm test
npm run dev
npm run pack:win
```

`npm run dev` starts Electron from source; close the window to stop it and run the command again to restart. Running from source uses a development profile, `%APPDATA%\folder-app-dev\local.json`, which persists between runs and is separate from the installed app's `%APPDATA%\folder-app\local.json`. Both can deliberately point at the same shared settings JSON. `npm start` launches the same way but without clearing an inherited `ELECTRON_RUN_AS_NODE`.

For an isolated source run, set `FOLDER_APP_DEV_PROFILE_DIR` to a disposable absolute directory before `npm run dev`. This changes only the development profile location. A selected shared settings file can then be copied under `TESTING/` for safe exploration.

The installer is written to `dist/Folder App Setup 0.1.0-test.1.exe`. It is unsigned. The app uses Electron's isolated preload; project filesystem operations run in the main process.

## Source layout

- `src/app/` — Electron startup, IPC channel table, preload API.
- `src/platform/` — shared filesystem services: safe paths, atomic writes, JSON settings storage, local settings, recovery journal.
- `src/features/<feature>/` — feature rules and main-process workflows (`settings`, `templates`, `project-creation`, `explorer`).
- `src/renderer/` — the current UI shell (to be split into components in Stage 2).
- `test/` — `node --test` checks grouped by owner.

## First use

1. On Home, create a shared settings JSON file on the intended network drive, then select your user on Home.
2. Add an Explorer root that contains the parent folder where projects will be created. Save settings.
3. Add a Markdown document template with its filename rule. Add a folder structure, choose the primary template, add folders and supporting documents, and set a separate project-relative log path. Save settings.
4. On New project, choose the structure and parent, fill the prompted values, inspect the preview, and create the project.
5. Use the expandable Explorer tree or folder view to browse the generated files. Folder names open; chevrons expand one branch. Go to folder, Up, breadcrumbs, Back, and Forward can browse any accessible local or network folder without saving it as a root.

## Settings files and reset

Shared settings live in one versioned JSON file. The selected shared-file path and user live in the local settings file; readable creation recovery records live beside it in `recovery/`.

- Deleting the local settings file resets this PC's selected shared file and user. It is recreated with defaults on the next start or **Refresh**.
- If the selected shared file is missing and its folder is reachable, a new file with a single Admin user and empty standards is created. Deleting it therefore resets shared users and standards for everyone using it.
- If the shared folder cannot be reached (disconnected drive, permissions), the app shows an error, keeps the remembered path, and creates nothing.
- A settings file with invalid JSON or an unsupported schema is reported and left unchanged.

Creation records are retried only by the user; retries verify prior output and never overwrite existing files. A failed operation may need manual inspection if a generated path was changed or partially written.

## Current boundaries

This release has a read-only explorer. Personal folder pins live in local settings; curated file and folder suggestions live in the selected shared settings file. Their paths and local Explorer roots are navigation shortcuts. Project creation still requires a parent under a saved local root. File viewing/editing, naming-rule warnings, renaming, pending rename operations, and dashboards remain for later stages. The app does not auto-log app actions yet; the separate log file is created as a Markdown starter. Real mapped-drive and UNC testing remains a release gate.
