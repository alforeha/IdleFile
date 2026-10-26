'use strict';

// Shared settings file (schema version 1): users, per-user data, standards, and branding.
// Storage mechanics live in platform/json-store.js; this module owns the shape and its rules.
// Structure and template checks stay here until the structures/templates features get their own validators.

const crypto = require('node:crypto');
const {relativeFile} = require('../../platform/paths');
const {fullPath} = require('../explorer/explorer');
const {readJson, createJson, loadOrCreateJson, saveJsonLocked} = require('../../platform/json-store');

const SCHEMA_VERSION = 1;

function initialSettings() {
  const adminId = crypto.randomUUID();
  return {
    schemaVersion: SCHEMA_VERSION,
    users: [{id: adminId, name: 'Admin', initials: 'AD', position: 'Admin'}],
    perUser: {[adminId]: {pins: [], recentPins: []}},
    suggestedLocations: [],
    standards: {roots: [], namingTags: [], structures: [], docTemplates: []},
    branding: {appName: 'Folder App', accentColor: '#e8892b', logoPath: ''}
  };
}

function selectedUserAfterReload(users, selectedId) {
  return users.some(u => u.id === selectedId) ? selectedId : null;
}

function validateUniqueIds(name, items) {
  if (!Array.isArray(items)) throw new Error(`${name} must be a list.`);
  const ids = items.map(item => item.id);
  if (ids.some(item => typeof item !== 'string' || !item) || new Set(ids).size !== ids.length) throw new Error(`${name} must have unique IDs.`);
}

function validateStructure(st, templates) {
  if (!st.name?.trim() || !st.rootName?.trim() || !st.primary?.templateId || !st.logPath || !Array.isArray(st.folders) || !Array.isArray(st.documents)) {
    throw new Error(`Structure ${st.name || st.id} is incomplete.`);
  }
  const documents = [st.primary, ...st.documents];
  for (const doc of documents) {
    if (!templates.some(t => t.id === doc.templateId)) throw new Error(`Structure ${st.name} references a missing document template.`);
  }
  // Check constant paths now; token-bearing paths are validated after expansion.
  const paths = [st.rootName, st.logPath, ...st.folders, ...documents.flatMap(d => [d.path, d.folder]).filter(Boolean)];
  for (const p of paths) if (!p.includes('{')) relativeFile(p);
}

function validateSettings(s) {
  if (!s || s.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported settings schema. Expected version ${SCHEMA_VERSION}.`);
  if (!Array.isArray(s.users) || !s.users.length || !s.users.some(u => u.position === 'Admin')) throw new Error('The user list needs at least one Admin.');
  validateUniqueIds('users', s.users);
  validateUniqueIds('structures', s.standards?.structures);
  validateUniqueIds('docTemplates', s.standards?.docTemplates);
  if (s.suggestedLocations !== undefined) {
    validateUniqueIds('suggestedLocations', s.suggestedLocations);
    for (const item of s.suggestedLocations) {
      if (!item.label?.trim() || !['folder', 'file'].includes(item.type)) throw new Error('Each suggestion needs a label and folder or file type.');
      fullPath(item.path);
    }
  }
  if (!Array.isArray(s.standards.roots) || !Array.isArray(s.standards.namingTags)) throw new Error('Roots and naming tags must be lists.');
  if (!s.perUser || typeof s.perUser !== 'object') throw new Error('Per-user settings are required.');
  for (const user of s.users) {
    if (!user.name?.trim() || !user.initials?.trim() || !user.position?.trim()) throw new Error('Each user needs a name, initials, and position.');
    if (!s.perUser[user.id]) s.perUser[user.id] = {pins: [], recentPins: []};
  }
  for (const t of s.standards.docTemplates) {
    if (!t.name?.trim() || !t.fileNamePattern?.trim() || typeof t.content !== 'string') {
      throw new Error('Each document template needs a name, filename rule, and Markdown content.');
    }
  }
  for (const st of s.standards.structures) validateStructure(st, s.standards.docTemplates);
  return s;
}

const store = {label: 'Shared settings', validate: validateSettings, initial: initialSettings, hint: 'Fix it or choose another file.'};

// The remembered shared file: read it, or create it with defaults if it is genuinely missing.
function loadSettings(file) {
  return loadOrCreateJson(file, store);
}

// "Open existing" never creates a file.
async function openExistingSettings(file) {
  try {
    return await readJson(file, store);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Selected settings file does not exist.');
    throw error;
  }
}

// "Create new" never replaces a file.
async function createNewSettings(file) {
  try {
    return await createJson(file, validateSettings(initialSettings()), store);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('A file already exists at this path. Open it as existing settings or choose another path.');
    throw error;
  }
}

function saveSettings(file, proposed, expectedRevision) {
  return saveJsonLocked(file, proposed, expectedRevision, store);
}

module.exports = {
  SCHEMA_VERSION, initialSettings, validateSettings, selectedUserAfterReload,
  loadSettings, openExistingSettings, createNewSettings, saveSettings
};
