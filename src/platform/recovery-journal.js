'use strict';

// Readable local records for multi-step filesystem jobs, one JSON file per job, kept separate from settings.

const fs = require('node:fs/promises');
const path = require('node:path');
const {writeAtomic} = require('./files');

const JOURNAL_SCHEMA_VERSION = 1;
const JOB_ID = /^[0-9a-f-]{36}$/i;
const JOB_FILE = /^[0-9a-f-]{36}\.json$/i;

async function writeJob(journalDir, job) {
  await fs.mkdir(journalDir, {recursive: true});
  await writeAtomic(path.join(journalDir, `${job.id}.json`), `${JSON.stringify(job, null, 2)}\n`);
}

async function readJob(journalDir, id) {
  if (!JOB_ID.test(id)) throw new Error('Invalid recovery ID.');
  const job = JSON.parse(await fs.readFile(path.join(journalDir, `${id}.json`), 'utf8'));
  if (job.id !== id || job.schemaVersion !== JOURNAL_SCHEMA_VERSION) throw new Error('Invalid recovery record.');
  return job;
}

async function listJobs(journalDir) {
  let names;
  try {
    names = await fs.readdir(journalDir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const jobs = [];
  for (const name of names.filter(n => JOB_FILE.test(n))) {
    try {
      jobs.push(JSON.parse(await fs.readFile(path.join(journalDir, name), 'utf8')));
    } catch {
      // An unreadable record stays on disk for manual inspection.
    }
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

module.exports = {JOURNAL_SCHEMA_VERSION, writeJob, readJob, listJobs};
