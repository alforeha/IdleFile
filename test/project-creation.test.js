'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {relativeFile} = require('../src/platform/paths');
const {requiredValues} = require('../src/features/templates/templates');
const {buildProjectPlan} = require('../src/features/project-creation/plan');
const {startCreation, resumeCreation, previewTarget} = require('../src/features/project-creation/creation');
const {createProjectService} = require('../src/features/project-creation/service');
const {createSettingsSession} = require('../src/features/settings/session');
const {saveSettings} = require('../src/features/settings/shared-settings');
const {scratch, fixture} = require('./helpers');

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

test('project preview uses local roots even when shared version-1 roots differ', async t => {
  const dir = await scratch(t);
  const sharedRoot = path.join(dir, 'SharedRoot');
  const localRoot = path.join(dir, 'LocalRoot');
  await fs.mkdir(sharedRoot);
  await fs.mkdir(localRoot);
  const session = createSettingsSession({localFile: path.join(dir, 'local.json')});
  await session.loadLocal();
  const shared = await session.useNew(path.join(dir, 'shared.json'));
  const {structure, templates, values} = fixture();
  shared.data.standards.roots = [sharedRoot];
  shared.data.standards.structures = [structure];
  shared.data.standards.docTemplates = templates;
  await saveSettings(shared.path, shared.data, shared.revision);
  await session.selectUser(shared.data.users[0].id);
  await session.addRoot(localRoot);
  const projects = createProjectService({session, journalDir: path.join(dir, 'recovery')});
  assert.ok((await projects.preview({parent: localRoot, structureId: structure.id, values})).root.startsWith(localRoot));
  await assert.rejects(projects.preview({parent: sharedRoot, structureId: structure.id, values}), /outside local Explorer roots/);
});
