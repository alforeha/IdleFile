'use strict';

const path = require('node:path');
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

function relativeFile(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('A relative path is required.');
  const raw = input.replaceAll('\\', '/');
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw) || raw.startsWith('//')) throw new Error(`Absolute path is not allowed: ${input}`);
  const segments = raw.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || /[<>:"|?*{}\x00-\x1f]/.test(segment) || /[. ]$/.test(segment) || RESERVED.test(segment)) {
      throw new Error(`Invalid Windows path segment: ${segment || '(empty)'}`);
    }
  }
  return segments.join('/');
}

function inside(root, rel) {
  const safe = relativeFile(rel);
  const resolved = path.resolve(root, ...safe.split('/'));
  const diff = path.relative(path.resolve(root), resolved);
  if (!diff || diff === '..' || diff.startsWith(`..${path.sep}`) || path.isAbsolute(diff)) throw new Error('Path leaves the project root.');
  return resolved;
}

function markdownLink(from, to) {
  const fromDir = path.posix.dirname(relativeFile(from));
  return path.posix.relative(fromDir, relativeFile(to));
}

module.exports = {relativeFile, inside, markdownLink};
