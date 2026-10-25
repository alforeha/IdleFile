'use strict';

// This PC's app settings, kept in Electron's userData folder. Not shared between PCs.

const fs = require('node:fs/promises');
const path = require('node:path');
const {loadOrCreateJson} = require('./json-store');
const {writeAtomic} = require('./files');

const LOCAL_SCHEMA_VERSION = 2;
const LABEL = 'Local settings';

function defaultLocalSettings() {
  return {schemaVersion: LOCAL_SCHEMA_VERSION, settingsPath: null, userId: null, explorerRoots: [], theme: 'system'};
}

// Files written before Stage 1 have no schemaVersion. They are read as version 1 and keep every field.
function validateLocalSettings(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a JSON object.');
  const version = data.schemaVersion ?? LOCAL_SCHEMA_VERSION;
  if (version !== 1 && version !== LOCAL_SCHEMA_VERSION) throw new Error(`Unsupported local settings schema. Expected version 1 or ${LOCAL_SCHEMA_VERSION}.`);
  for (const key of ['settingsPath', 'userId']) {
    if (data[key] != null && typeof data[key] !== 'string') throw new Error(`${key} must be text or null.`);
  }
  if (data.explorerRoots !== undefined && (!Array.isArray(data.explorerRoots) || data.explorerRoots.some(root => typeof root !== 'string')))
    throw new Error('explorerRoots must be a list of paths.');
  if (data.theme !== undefined && !['system', 'light', 'dark'].includes(data.theme)) throw new Error('theme must be system, light, or dark.');
  return {...data, schemaVersion: version, settingsPath: data.settingsPath || null, userId: data.userId || null};
}

// Creates the file with defaults when it is missing; an invalid file is reported and left intact.
async function loadLocalSettings(file) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const {data} = await loadOrCreateJson(file, {
    label: LABEL, validate: validateLocalSettings, initial: defaultLocalSettings,
    hint: "Fix it, or delete it to reset this PC's settings."
  });
  return data;
}

async function saveLocalSettings(file, data) {
  const valid = validateLocalSettings(data);
  await writeAtomic(file, `${JSON.stringify(valid, null, 2)}\n`);
  return valid;
}

module.exports = {LOCAL_SCHEMA_VERSION, defaultLocalSettings, validateLocalSettings, loadLocalSettings, saveLocalSettings};
