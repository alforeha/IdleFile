# Folder App — Test Release 1

Windows Electron prototype for creating a project folder structure with starter Markdown documents, then browsing the result on a shared drive.

## Run and package

Requirements: Windows, Node.js 24, npm.

```powershell
npm ci
npm test
npm start
npm run pack:win
```

The installer is written to `dist/Folder App Setup 0.1.0-test.1.exe`. It is unsigned. The app uses Electron's isolated preload; project filesystem operations run in the main process.

## First use

1. On Home, create a shared settings JSON file on the intended network drive. Save it in Settings, then select your user on Home.
2. Add an Explorer root that contains the parent folder where projects will be created. Save settings.
3. Add a Markdown document template with its filename rule. Add a folder structure, choose the primary template, add folders and supporting documents, and set a separate project-relative log path. Save settings.
4. On New project, choose the structure and parent, fill the prompted values, inspect the preview, and create the project.
5. Use the expandable Explorer tree or folder view to browse the generated files.

Settings live in one versioned JSON file. The selected user and readable creation recovery records live locally in Electron's `userData` folder. Creation records are retried only by the user; retries verify prior output and never overwrite existing files. A failed operation may need manual inspection if a generated path was changed or partially written.

## Current boundaries

This release has a read-only explorer. File viewing/editing, naming-rule warnings, renaming, pending rename operations, pins, and dashboards are planned for later test releases. The app does not auto-log app actions yet; the separate log file is created as a Markdown starter. Real mapped-drive and UNC testing remains a release gate.
