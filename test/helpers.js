'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const testing = path.resolve(__dirname, '..', 'TESTING');

// A temporary folder under TESTING, removed after the test.
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
  const structure = {
    id: 'structure', name: 'Generic', rootName: '{PROJECT}', folders: ['Notes'],
    primary: {templateId: 'primary', folder: ''}, documents: [{templateId: 'notes', folder: 'Notes'}], logPath: 'History/activity.md'
  };
  return {structure, templates: [primary, notes], values: {PROJECT: 'Alpha'}};
}

module.exports = {scratch, fixture};
