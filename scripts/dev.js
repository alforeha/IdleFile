'use strict';

// npm run dev: starts Electron from source with the development profile (see src/app/main.js).
// ELECTRON_RUN_AS_NODE is removed because terminals launched from some editors (e.g. VS Code
// extension hosts) inherit it, which would make Electron run as plain Node and exit.

const {spawn} = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], {cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit'});
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
