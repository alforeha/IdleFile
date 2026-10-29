'use strict';

const fs = require('node:fs');
const {fullPath} = require('../features/explorer/explorer');
const {pathKey} = require('../platform/path-key');

const MAX_WATCHES = 64;
const POLL_MS = 5000;
const DEBOUNCE_MS = 250;

function createVisibleFolderWatches(window, options = {}) {
  const watch = options.watch || fs.watch;
  const now = options.now || Date.now;
  const watches = new Map();
  const pending = new Map();
  const retries = new Map();
  let visible = new Map();
  let focused = !window.isMinimized() && window.isVisible() && window.isFocused();
  let pollTimer;
  let closed = false;

  function notify(paths) {
    if (!closed && !window.isDestroyed() && paths.length) window.webContents.send('explorer.changed', paths);
  }
  function queue(folder) {
    const key = pathKey(folder);
    if (!visible.has(key) || pending.has(key)) return;
    pending.set(key, setTimeout(() => {
      pending.delete(key);
      if (visible.has(key)) notify([visible.get(key).path]);
    }, DEBOUNCE_MS));
  }
  function release(key) {
    watches.get(key)?.close();
    watches.delete(key);
    if (pending.has(key)) clearTimeout(pending.get(key));
    pending.delete(key);
    retries.delete(key);
  }
  function retryLater(key) {
    const attempts = (retries.get(key)?.attempts || 0) + 1;
    retries.set(key, {attempts, after: now() + Math.min(30000, POLL_MS * 2 ** (attempts - 1))});
  }
  function attach() {
    if (closed) return;
    const allowed = [...visible].filter(([, item]) => item.watch).slice(0, MAX_WATCHES);
    const keep = new Set(allowed.map(([key]) => key));
    for (const key of watches.keys()) if (!keep.has(key)) release(key);
    for (const [key, item] of allowed) {
      if (watches.has(key)) continue;
      if (now() < (retries.get(key)?.after || 0)) continue;
      try {
        const handle = watch(item.path, {persistent: false}, () => queue(item.path));
        handle.on('error', () => { release(key); retryLater(key); queue(item.path); });
        watches.set(key, handle);
        retries.delete(key);
      } catch { retryLater(key); }
    }
  }
  function poll() {
    if (!focused || closed) return;
    attach();
    // This also checks paths beyond the watch cap and paths whose network events were lost.
    notify([...visible.values()].map(item => item.path));
  }
  function focusChanged() {
    const now = !window.isMinimized() && window.isVisible() && window.isFocused();
    if (now === focused) return;
    focused = now;
    if (now) poll();
  }
  function sync(items) {
    if (!Array.isArray(items)) return;
    const next = new Map();
    for (const item of items.slice(0, 1000)) {
      try {
        const folder = fullPath(item.path);
        const key = pathKey(folder);
        next.set(key, {path: folder, watch: !!item.watch || !!next.get(key)?.watch});
      } catch { /* Ignore malformed renderer requests. */ }
    }
    visible = next;
    for (const key of watches.keys()) if (!visible.has(key) || !visible.get(key).watch) release(key);
    for (const key of retries.keys()) if (!visible.has(key) || !visible.get(key).watch) retries.delete(key);
    attach();
  }
  function close() {
    closed = true;
    clearInterval(pollTimer);
    for (const key of watches.keys()) release(key);
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  }
  for (const event of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore']) window.on(event, focusChanged);
  window.on('closed', close);
  pollTimer = setInterval(poll, POLL_MS);
  pollTimer.unref?.();
  return {sync, poll, close, get watchCount() { return watches.size; }};
}

module.exports = {createVisibleFolderWatches, MAX_WATCHES, POLL_MS, DEBOUNCE_MS};
