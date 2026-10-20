'use strict';

const fs = require('node:fs/promises');
const crypto = require('node:crypto');

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Writes through a unique temp file and renames it, so readers never see a half-written file.
async function writeAtomic(file, contents) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, contents, {flag: 'wx'});
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, {force: true}).catch(() => {});
  }
}

module.exports = {sha256, writeAtomic};
