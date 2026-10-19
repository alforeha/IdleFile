'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {relativeFile} = require('../src/core/paths');
const {buildProjectPlan, requiredValues} = require('../src/core/templates');
const {initialSettings, loadSettings, saveSettings, selectedUserAfterReload} = require('../src/core/settings');
const {startCreation, resumeCreation, previewTarget} = require('../src/core/creation');
const {listDirectoryPage, requireConfiguredRoot} = require('../src/core/explorer');

const testing = path.resolve(__dirname, '..', 'TESTING');
async function scratch(t) {
  await fs.mkdir(testing, {recursive: true});
  const dir = await fs.mkdtemp(path.join(testing, 'automated-'));
  t.after(async () => {
    const diff = path.relative(testing, dir);
    assert.ok(diff && diff !== '..' && !diff.startsWith(`..${path.sep}`));
    await fs.rm(dir, {recursive: true, force: true});
  });
  return dir;
}
function fixture() {
  const primary = {id: 'primary', name: 'Project information', fileNamePattern: '{PROJECT}-info.md', content: '# {PROJECT}\n\n{PROJECT_LINKS}\n\nLog: [Activity]({LOG_PATH})\n'};
  const notes = {id: 'notes', name: 'Notes', fileNamePattern: '{PROJECT}-notes.md', content: '# Notes for {PROJECT}\n'};
  const structure = {id: 'structure', name: 'Generic', rootName: '{PROJECT}', folders: ['Notes'], primary: {templateId: 'primary', folder: ''}, documents: [{templateId: 'notes', folder: 'Notes'}], logPath: 'History/activity.md'};
  return {structure, templates: [primary, notes], values: {PROJECT: 'Alpha'}};
}

test('Windows relative paths reject traversal, invalid names and device names', () => {
  for (const bad of ['../outside', 'Folder/../outside', '/absolute', 'C:\\absolute', 'CON', 'aux.txt', 'LPT1/report', 'bad.', 'bad ', 'a//b', 'a?b', 'a:b']) {
    assert.throws(() => relativeFile(bad), bad);
  }
  assert.equal(relativeFile('Notes\\meeting.md'), 'Notes/meeting.md');
});

test('template filenames, root-relative links, log path and required fields', () => {
  const {structure, templates, values} = fixture();
  assert.deepEqual(requiredValues(structure, templates), ['PROJECT']);
  const plan = buildProjectPlan(structure, templates, values);
  assert.equal(plan.primaryPath, 'Alpha-info.md');
  assert.equal(plan.logPath, 'History/activity.md');
  assert.match(plan.files[0].content, /\[Alpha-notes\.md\]\(Notes\/Alpha-notes\.md\)/);
  assert.match(plan.files[0].content, /\[Activity\]\(History\/activity\.md\)/);
  assert.throws(() => buildProjectPlan(structure, templates, {PROJECT: '../outside'}));
});

test('generated paths detect collisions without writing', () => {
  const {structure, templates, values} = fixture();
  structure.logPath = 'Alpha-info.md';
  assert.throws(() => buildProjectPlan(structure, templates, values), /same path/);
  structure.logPath = 'History/activity.md';
  structure.folders.push('Alpha-info.md');
  assert.throws(() => buildProjectPlan(structure, templates, values), /conflict/);
  structure.folders = ['Alpha-info.md/child'];
  assert.throws(() => buildProjectPlan(structure, templates, values), /conflict/);
});

test('shared settings save, reopen, stale revision conflict, and deleted identity', async t => {
  const dir = await scratch(t);
  const file = path.join(dir, 'folderapp.json');
  const first = await loadSettings(file);
  assert.equal(first.revision, null);
  first.data.standards.docTemplates = fixture().templates;
  first.data.standards.structures = [fixture().structure];
  const saved = await saveSettings(file, first.data, first.revision);
  const reopened = await loadSettings(file);
  assert.equal(reopened.revision, saved.revision);
  assert.equal(reopened.data.standards.structures[0].name, 'Generic');
  await assert.rejects(saveSettings(file, first.data, null), /changed since/);
  const userId = reopened.data.users[0].id;
  assert.equal(selectedUserAfterReload(reopened.data.users, userId), userId);
  assert.equal(selectedUserAfterReload([{id: 'another'}], userId), null);
});

test('creation reports failure, saves progress, resumes only remaining work and never overwrites', async t => {
  const dir = await scratch(t);
  const journal = path.join(dir, 'recovery');
  const {structure, templates, values} = fixture();
  const plan = buildProjectPlan(structure, templates, values);
  let failed = false;
  const job = await startCreation(dir, plan, journal, {beforeStep(step) { if (!failed && step.kind === 'file') { failed = true; throw new Error('Simulated disconnect'); } }});
  assert.equal(job.status, 'needs-attention');
  assert.match(job.lastError, /Simulated disconnect/);
  assert.ok(job.completed.includes('root'));
  const pending = await resumeCreation(job.id, journal);
  assert.equal(pending.status, 'complete');
  assert.equal(await fs.readFile(path.join(dir, 'Alpha', 'Notes', 'Alpha-notes.md'), 'utf8'), '# Notes for Alpha\n');
  await assert.rejects(previewTarget(dir, plan), /already exists/);
  await fs.writeFile(path.join(dir, 'Alpha', 'Alpha-info.md'), 'Externally changed');
  const repeated = await resumeCreation(job.id, journal);
  assert.equal(repeated.status, 'complete');
  // A completed job is immutable; it does not replay over external changes.
  assert.equal(await fs.readFile(path.join(dir, 'Alpha', 'Alpha-info.md'), 'utf8'), 'Externally changed');
});

test('resume refuses a changed completed file after a later failure', async t => {
  const dir = await scratch(t);
  const journal = path.join(dir, 'recovery');
  const {structure, templates, values} = fixture();
  const plan = buildProjectPlan(structure, templates, values);
  let count = 0;
  const job = await startCreation(dir, plan, journal, {beforeStep(step) { if (step.kind === 'file' && ++count === 2) throw new Error('Simulated lock'); }});
  assert.equal(job.status, 'needs-attention');
  await fs.writeFile(path.join(dir, 'Alpha', 'Alpha-info.md'), 'Changed outside the app');
  const retried = await resumeCreation(job.id, journal);
  assert.equal(retried.status, 'needs-attention');
  assert.match(retried.lastError, /changed/);
  assert.equal(await fs.readFile(path.join(dir, 'Alpha', 'Alpha-info.md'), 'utf8'), 'Changed outside the app');
});

test('creation refuses a junction substituted for a generated folder', async t => {
  const dir = await scratch(t);
  const outside = path.join(dir, 'outside');
  await fs.mkdir(outside);
  const journal = path.join(dir, 'recovery');
  const {structure, templates, values} = fixture();
  structure.folders = ['Docs'];
  structure.primary.folder = 'Docs';
  structure.documents = [];
  structure.logPath = 'log.md';
  const plan = buildProjectPlan(structure, templates, values);
  const docs = path.join(dir, 'Alpha', 'Docs');
  const job = await startCreation(dir, plan, journal, {async beforeStep(step) {
    if (step.kind === 'file' && step.rel === 'Docs/Alpha-info.md') {
      await fs.rename(docs, `${docs}-old`);
      await fs.symlink(outside, docs, 'junction');
    }
  }});
  assert.equal(job.status, 'needs-attention');
  assert.match(job.lastError, /replaced by a link|changed/);
  await assert.rejects(fs.stat(path.join(outside, 'Alpha-info.md')), {code: 'ENOENT'});
});

test('explorer pagination reaches entries after the first 500', async t => {
  const dir = await scratch(t);
  await Promise.all(Array.from({length: 501}, (_, index) => fs.writeFile(path.join(dir, `item-${String(index).padStart(3, '0')}.txt`), '')));
  const first = await listDirectoryPage(dir);
  assert.equal(first.entries.length, 500);
  assert.equal(first.nextOffset, 500);
  const second = await listDirectoryPage(dir, first.nextOffset);
  assert.equal(second.entries.length, 1);
  assert.equal(second.entries[0].name, 'item-500.txt');
  assert.equal(second.nextOffset, null);
});

test('project parent must be under a saved explorer root for reopening', async t => {
  const dir = await scratch(t);
  const root = path.join(dir, 'shared-root');
  const projectParent = path.join(root, 'Projects');
  const other = path.join(dir, 'unconfigured');
  await fs.mkdir(projectParent, {recursive: true});
  await fs.mkdir(other);
  assert.equal(await requireConfiguredRoot(projectParent, [root]), await fs.realpath(projectParent));
  await assert.rejects(requireConfiguredRoot(other, [root]), /outside saved Explorer roots/);
});
