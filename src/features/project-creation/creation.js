'use strict';

// Writes a project plan step by step. Each step is recorded in the recovery journal; a retry first
// verifies earlier output and never overwrites an existing file or follows a substituted link.

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {inside} = require('../../platform/paths');
const {sha256} = require('../../platform/files');
const {JOURNAL_SCHEMA_VERSION, writeJob, readJob} = require('../../platform/recovery-journal');

function addAncestors(dirs, rel) {
  let parent = path.posix.dirname(rel);
  while (parent !== '.') {
    dirs.add(parent);
    parent = path.posix.dirname(parent);
  }
}

// Folders first (parents before children), then files.
function stepsFor(plan) {
  const dirs = new Set(plan.folders);
  for (const file of plan.files) addAncestors(dirs, file.path);
  for (const dir of [...dirs]) addAncestors(dirs, dir);
  const depth = rel => rel.split('/').length;
  const orderedDirs = [...dirs].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  return [
    ...orderedDirs.map(rel => ({kind: 'dir', rel})),
    ...plan.files.map(file => ({kind: 'file', rel: file.path, content: file.content}))
  ];
}

async function previewTarget(parent, plan) {
  const root = path.join(parent, plan.rootName);
  const stat = await fs.stat(parent);
  if (!stat.isDirectory()) throw new Error('Project parent is not a folder.');
  try {
    await fs.lstat(root);
    throw new Error('Project folder already exists. Choose another name or location.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const file of plan.files) inside(root, file.path);
  for (const dir of plan.folders) inside(root, dir);
  return root;
}

async function startCreation(parent, plan, journalDir, options = {}) {
  const root = await previewTarget(parent, plan);
  const job = {
    schemaVersion: JOURNAL_SCHEMA_VERSION, id: crypto.randomUUID(), createdAt: new Date().toISOString(),
    root, plan, completed: [], status: 'pending', lastError: null
  };
  await writeJob(journalDir, job);
  return runCreation(job, journalDir, options);
}

function identity(stat) {
  return {dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs};
}

function sameIdentity(saved, stat) {
  return saved.dev === stat.dev && (saved.ino ? saved.ino === stat.ino : saved.birthtimeMs === stat.birthtimeMs);
}

async function verifyCompleted(job) {
  for (const key of job.completed) {
    if (key === 'root') {
      const stat = await fs.lstat(job.root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Project root changed since creation started.');
      if (job.identities?.root && !sameIdentity(job.identities.root, stat)) throw new Error('Project root was replaced since creation started.');
      continue;
    }
    const [kind, rel] = key.split(':', 2);
    const target = inside(job.root, rel);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw new Error(`Generated path was replaced by a link: ${rel}`);
    if (kind === 'dir' && (!stat.isDirectory() || (job.identities?.[key] && !sameIdentity(job.identities[key], stat)))) {
      throw new Error(`Generated folder changed: ${rel}`);
    }
    if (kind === 'file') {
      const item = job.plan.files.find(f => f.path === rel);
      if (!stat.isFile() || sha256(await fs.readFile(target)) !== sha256(item.content)) throw new Error(`Generated file changed: ${rel}`);
    }
  }
}

async function verifyAncestors(job, rel) {
  const rootReal = await fs.realpath(job.root);
  if (job.rootReal && path.resolve(rootReal).toLowerCase() !== path.resolve(job.rootReal).toLowerCase()) {
    throw new Error('Project root now resolves to a different location.');
  }
  let current = job.root;
  const parents = rel ? rel.split('/').slice(0, -1) : [];
  for (const segment of parents) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Generated folder was replaced by a link or file: ${current}`);
    const diff = path.relative(rootReal, await fs.realpath(current));
    if (diff === '..' || diff.startsWith(`..${path.sep}`) || path.isAbsolute(diff)) throw new Error(`Generated folder escapes project root: ${current}`);
  }
}

async function runStep(job, step) {
  if (step.kind === 'root') {
    await fs.mkdir(job.root);
    job.rootReal = await fs.realpath(job.root);
    return;
  }
  const target = inside(job.root, step.rel);
  if (step.kind === 'dir') await fs.mkdir(target);
  else await fs.writeFile(target, step.content, {flag: 'wx'});
}

async function runCreation(job, journalDir, options = {}) {
  try {
    if (job.status === 'complete') return job;
    if (job.completed.length) await verifyCompleted(job);
    const allSteps = [{kind: 'root', rel: ''}, ...stepsFor(job.plan)];
    for (let index = 0; index < allSteps.length; index++) {
      const step = allSteps[index];
      const key = step.kind === 'root' ? 'root' : `${step.kind}:${step.rel}`;
      if (job.completed.includes(key)) continue;
      if (options.beforeStep) await options.beforeStep(step, index);
      if (job.completed.length) await verifyCompleted(job);
      if (step.kind !== 'root') await verifyAncestors(job, step.rel);
      await runStep(job, step);
      if (step.kind === 'root' || step.kind === 'dir') {
        job.identities ||= {};
        job.identities[key] = identity(await fs.lstat(step.kind === 'root' ? job.root : inside(job.root, step.rel)));
      }
      job.completed.push(key);
      await writeJob(journalDir, job);
    }
    job.status = 'complete';
    job.lastError = null;
  } catch (error) {
    job.status = 'needs-attention';
    job.lastError = `${error.code || 'ERROR'}: ${error.message}`;
  }
  await writeJob(journalDir, job);
  return job;
}

async function resumeCreation(id, journalDir) {
  return runCreation(await readJob(journalDir, id), journalDir);
}

module.exports = {stepsFor, previewTarget, startCreation, resumeCreation};
