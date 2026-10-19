'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {relativeFile} = require('./paths');

const SCHEMA_VERSION = 1;
const id = () => crypto.randomUUID();
function initialSettings() {
  const adminId = id();
  return {schemaVersion: SCHEMA_VERSION, users: [{id: adminId, name: 'Admin', initials: 'AD', position: 'Admin'}], perUser: {[adminId]: {pins: [], recentPins: []}}, standards: {roots: [], namingTags: [], structures: [], docTemplates: []}, branding: {appName: 'Folder App', accentColor: '#e8892b', logoPath: ''}};
}
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function selectedUserAfterReload(users, selectedId) { return users.some(u => u.id === selectedId) ? selectedId : null; }
function validateSettings(s) {
  if (!s || s.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported settings schema. Expected version ${SCHEMA_VERSION}.`);
  if (!Array.isArray(s.users) || !s.users.length || !s.users.some(u => u.position === 'Admin')) throw new Error('The user list needs at least one Admin.');
  for (const [name, items] of [['users', s.users], ['structures', s.standards?.structures], ['docTemplates', s.standards?.docTemplates]]) {
    if (!Array.isArray(items)) throw new Error(`${name} must be a list.`);
    const ids = items.map(item => item.id);
    if (ids.some(item => typeof item !== 'string' || !item) || new Set(ids).size !== ids.length) throw new Error(`${name} must have unique IDs.`);
  }
  if (!Array.isArray(s.standards.roots) || !Array.isArray(s.standards.namingTags)) throw new Error('Roots and naming tags must be lists.');
  if (!s.perUser || typeof s.perUser !== 'object') throw new Error('Per-user settings are required.');
  for (const user of s.users) {
    if (!user.name?.trim() || !user.initials?.trim() || !user.position?.trim()) throw new Error('Each user needs a name, initials, and position.');
    if (!s.perUser[user.id]) s.perUser[user.id] = {pins: [], recentPins: []};
  }
  for (const t of s.standards.docTemplates) {
    if (!t.name?.trim() || !t.fileNamePattern?.trim() || typeof t.content !== 'string') throw new Error('Each document template needs a name, filename rule, and Markdown content.');
  }
  for (const st of s.standards.structures) {
    if (!st.name?.trim() || !st.rootName?.trim() || !st.primary?.templateId || !st.logPath || !Array.isArray(st.folders) || !Array.isArray(st.documents)) throw new Error(`Structure ${st.name || st.id} is incomplete.`);
    for (const doc of [st.primary, ...st.documents]) {
      if (!s.standards.docTemplates.some(t => t.id === doc.templateId)) throw new Error(`Structure ${st.name} references a missing document template.`);
    }
    // Check constant paths now; token-bearing paths are validated after expansion.
    for (const p of [st.rootName, st.logPath, ...st.folders, ...[st.primary, ...st.documents].flatMap(d => [d.path, d.folder]).filter(Boolean)]) if (!p.includes('{')) relativeFile(p);
  }
  return s;
}
async function loadSettings(file) {
  try {
    const bytes = await fs.readFile(file);
    return {data: validateSettings(JSON.parse(bytes.toString('utf8'))), revision: hash(bytes)};
  } catch (error) {
    if (error.code === 'ENOENT') return {data: initialSettings(), revision: null};
    throw error;
  }
}
async function writeAtomic(file, contents) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, contents, {flag: 'wx'});
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, {force: true}).catch(() => {}); }
}
async function saveSettings(file, proposed, expectedRevision) {
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
    try { current = hash(await fs.readFile(file)); }
    catch (error) { if (error.code === 'ENOENT') current = null; else throw error; }
    if (current !== expectedRevision) throw new Error('Settings changed since you opened them. Reload before saving; your edits were not written.');
    validateSettings(proposed);
    const bytes = Buffer.from(`${JSON.stringify(proposed, null, 2)}\n`, 'utf8');
    await writeAtomic(file, bytes);
    return {data: proposed, revision: hash(bytes)};
  } finally {
    await handle.close();
    await fs.rm(lock, {force: true});
  }
}
module.exports = {SCHEMA_VERSION, initialSettings, validateSettings, loadSettings, saveSettings, writeAtomic, selectedUserAfterReload};
