'use strict';

// Shared by the sandboxed renderer and the watch manager. Windows paths compare without
// slash, case, dot-segment, or UNC share-root spelling differences.
function pathKey(value) {
  const raw = String(value || '').replaceAll('/', '\\');
  const unc = raw.startsWith('\\\\');
  const parts = raw.split(/\\+/).filter(Boolean);
  const prefix = unc ? `\\\\${(parts.shift() || '').toLowerCase()}\\${(parts.shift() || '').toLowerCase()}`
    : /^[a-z]:$/i.test(parts[0] || '') ? `${parts.shift().toLowerCase()}\\` : raw.startsWith('\\') ? '\\' : '';
  const normalized = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') { normalized.pop(); continue; }
    normalized.push(part.toLowerCase());
  }
  const joined = prefix + (prefix && normalized.length && !prefix.endsWith('\\') ? '\\' : '') + normalized.join('\\');
  return /^[a-z]:\\$/.test(joined) ? joined : joined.replace(/\\+$/, '');
}

if (typeof module !== 'undefined' && module.exports) module.exports = {pathKey};
