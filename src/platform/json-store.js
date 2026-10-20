'use strict';

// Readable JSON files with a revision hash. This module knows nothing about a file's schema:
// callers pass `validate` (and `initial` for files that may be created).

const fs = require('node:fs/promises');
const path = require('node:path');
const {sha256, writeAtomic} = require('./files');

const toBytes = data => Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
const codeOf = error => error.code || 'ERROR';

function unreachable(label, target, error) {
  const message = `${label} cannot be reached at ${target} (${codeOf(error)}). `
    + 'Check the drive connection and your permissions. Nothing was created or changed.';
  return Object.assign(new Error(message), {code: 'UNREACHABLE'});
}

// A missing file keeps its ENOENT code so the caller chooses the reset policy.
async function readJson(file, {label, validate, hint = ''}) {
  let bytes;
  try {
    bytes = await fs.readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') throw error;
    throw unreachable(label, file, error);
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8').replace(/^﻿/, ''));
  } catch (error) {
    throw new Error(`${label} at ${file} is not valid JSON (${error.message}). The file was left unchanged. ${hint}`.trim());
  }
  try {
    return {data: validate(parsed), revision: sha256(bytes)};
  } catch (error) {
    throw new Error(`${label} at ${file} cannot be used: ${error.message} The file was left unchanged. ${hint}`.trim());
  }
}

// Creates a new file. Never replaces an existing one (EEXIST is passed through).
async function createJson(file, data, {label}) {
  const bytes = toBytes(data);
  let handle;
  try {
    handle = await fs.open(file, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw error;
    throw new Error(`${label} could not be created at ${file} (${codeOf(error)}). Check your permissions for that folder.`);
  }
  try {
    await handle.writeFile(bytes);
  } catch (error) {
    await handle.close();
    await fs.rm(file, {force: true}).catch(() => {});
    throw new Error(`${label} could not be written at ${file} (${codeOf(error)}). The partial file was removed.`);
  }
  await handle.close();
  return {data, revision: sha256(bytes)};
}

// Reset policy: a genuinely missing file is created with defaults, but only when its folder is
// reachable. An unreachable folder, unreadable file, or invalid content leaves the disk unchanged.
async function loadOrCreateJson(file, {label, validate, initial, hint}) {
  try {
    return await readJson(file, {label, validate, hint});
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const folder = path.dirname(file);
  let stat;
  try {
    stat = await fs.stat(folder);
  } catch (error) {
    throw unreachable(`The folder for ${label.toLowerCase()}`, folder, error);
  }
  if (!stat.isDirectory()) throw new Error(`${label} cannot be created because ${folder} is not a folder.`);
  try {
    return await createJson(file, validate(initial()), {label});
  } catch (error) {
    if (error.code === 'EEXIST') return readJson(file, {label, validate, hint});
    throw error;
  }
}

// Saves only if the file still has the revision the caller loaded; a lock file serializes saves across PCs.
async function saveJsonLocked(file, proposed, expectedRevision, {validate}) {
  const lock = `${file}.lock`;
  let handle;
  try {
    handle = await fs.open(lock, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Settings are locked by another save. Try again shortly. If the app crashed, inspect ${lock} before removing it.`);
    throw error;
  }
  try {
    let current;
    try {
      current = sha256(await fs.readFile(file));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      current = null;
    }
    if (current !== expectedRevision) throw new Error('Settings changed since you opened them. Reload before saving; your edits were not written.');
    validate(proposed);
    const bytes = toBytes(proposed);
    await writeAtomic(file, bytes);
    return {data: proposed, revision: sha256(bytes)};
  } finally {
    await handle.close();
    await fs.rm(lock, {force: true});
  }
}

module.exports = {readJson, createJson, loadOrCreateJson, saveJsonLocked};
