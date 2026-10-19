'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {inside} = require('./paths');
const {writeAtomic} = require('./settings');

const digest = text => crypto.createHash('sha256').update(text).digest('hex');
function stepsFor(plan) {
  const dirs = new Set(plan.folders);
  for (const file of plan.files) {
    let parent = path.posix.dirname(file.path);
    while (parent !== '.') { dirs.add(parent); parent = path.posix.dirname(parent); }
  }
  for (const dir of [...dirs]) {
    let parent = path.posix.dirname(dir);
    while (parent !== '.') { dirs.add(parent); parent = path.posix.dirname(parent); }
  }
  return [
    ...[...dirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)).map(rel => ({kind: 'dir', rel})),
    ...plan.files.map(file => ({kind: 'file', rel: file.path, content: file.content}))
  ];
}
async function previewTarget(parent, plan) {
  const root = path.join(parent, plan.rootName);
  const stat = await fs.stat(parent);
  if (!stat.isDirectory()) throw new Error('Project parent is not a folder.');
  try { await fs.lstat(root); throw new Error('Project folder already exists. Choose another name or location.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const file of plan.files) inside(root, file.path);
  for (const dir of plan.folders) inside(root, dir);
  return root;
}
async function writeJournal(journalDir, job) {
  await fs.mkdir(journalDir, {recursive: true});
  await writeAtomic(path.join(journalDir, `${job.id}.json`), `${JSON.stringify(job, null, 2)}\n`);
}
async function startCreation(parent, plan, journalDir, options = {}) {
  const root = await previewTarget(parent, plan);
  const job = {schemaVersion: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), root, plan, completed: [], status: 'pending', lastError: null};
  await writeJournal(journalDir, job);
  return runCreation(job, journalDir, options);
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
    if (kind === 'dir' && (!stat.isDirectory() || (job.identities?.[key] && !sameIdentity(job.identities[key], stat)))) throw new Error(`Generated folder changed: ${rel}`);
    if (kind === 'file') {
      const item = job.plan.files.find(f => f.path === rel);
      if (!stat.isFile() || digest(await fs.readFile(target)) !== digest(item.content)) throw new Error(`Generated file changed: ${rel}`);
    }
  }
}
function identity(stat) { return {dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs}; }
function sameIdentity(saved, stat) { return saved.dev === stat.dev && (saved.ino ? saved.ino === stat.ino : saved.birthtimeMs === stat.birthtimeMs); }
async function verifyAncestors(job, rel) {
  const rootReal = await fs.realpath(job.root);
  if (job.rootReal && path.resolve(rootReal).toLowerCase() !== path.resolve(job.rootReal).toLowerCase()) throw new Error('Project root now resolves to a different location.');
  let current = job.root;
  const parents = rel ? rel.split('/').slice(0, -1) : [];
  for (const segment of parents) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Generated folder was replaced by a link or file: ${current}`);
    const actual = await fs.realpath(current);
    const diff = path.relative(rootReal, actual);
    if (diff === '..' || diff.startsWith(`..${path.sep}`) || path.isAbsolute(diff)) throw new Error(`Generated folder escapes project root: ${current}`);
  }
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
      if (step.kind === 'root') {
        await fs.mkdir(job.root);
        job.rootReal = await fs.realpath(job.root);
      }
      else {
        const target = inside(job.root, step.rel);
        if (step.kind === 'dir') await fs.mkdir(target);
        else await fs.writeFile(target, step.content, {flag: 'wx'});
      }
      if (step.kind === 'root' || step.kind === 'dir') {
        job.identities ||= {};
        job.identities[key] = identity(await fs.lstat(step.kind === 'root' ? job.root : inside(job.root, step.rel)));
      }
      job.completed.push(key);
      await writeJournal(journalDir, job);
    }
    job.status = 'complete';
    job.lastError = null;
  } catch (error) {
    job.status = 'needs-attention';
    job.lastError = `${error.code || 'ERROR'}: ${error.message}`;
  }
  await writeJournal(journalDir, job);
  return job;
}
async function resumeCreation(id, journalDir) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid recovery ID.');
  const job = JSON.parse(await fs.readFile(path.join(journalDir, `${id}.json`), 'utf8'));
  if (job.id !== id || job.schemaVersion !== 1) throw new Error('Invalid recovery record.');
  return runCreation(job, journalDir);
}
async function listJobs(journalDir) {
  let names;
  try { names = await fs.readdir(journalDir); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const jobs = [];
  for (const name of names.filter(n => /^[0-9a-f-]{36}\.json$/i.test(n))) {
    try { jobs.push(JSON.parse(await fs.readFile(path.join(journalDir, name), 'utf8'))); }
    catch { /* Reported by the recovery file remaining on disk. */ }
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
module.exports = {stepsFor, previewTarget, startCreation, resumeCreation, listJobs};
