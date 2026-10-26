'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {createVisibleFolderWatches, MAX_WATCHES} = require('../src/app/visible-folder-watches');

function fixture() {
  const window = new EventEmitter();
  const sent = [];
  const handles = new Map();
  let focused = true, visible = true, minimized = false, time = 1000;
  window.webContents = {send: (_, folders) => sent.push(folders)};
  window.isDestroyed = () => false;
  window.isFocused = () => focused;
  window.isVisible = () => visible;
  window.isMinimized = () => minimized;
  const watch = (folder, _options, callback) => {
    const handle = new EventEmitter();
    handle.changed = callback;
    handle.close = () => { handle.closed = true; };
    handles.set(folder, handle);
    return handle;
  };
  const manager = createVisibleFolderWatches(window, {watch, now: () => time});
  return {window, sent, handles, manager,
    hide() { focused = false; visible = false; window.emit('hide'); },
    show() { focused = true; visible = true; window.emit('show'); },
    minimize() { minimized = true; window.emit('minimize'); },
    restore() { minimized = false; window.emit('restore'); },
    advance(ms) { time += ms; }};
}

test('expanded branches and tabs use one watch per path, and collapse and close release them', async t => {
  const f = fixture(); t.after(() => f.manager.close());
  const root = path.resolve('visible-root');
  const child = path.join(root, 'child');
  f.manager.sync([{path: root, watch: true}, {path: child, watch: true}, {path: root, watch: true}]);
  assert.equal(f.manager.watchCount, 2);
  f.manager.sync([{path: root, watch: true}, {path: child, watch: false}]);
  assert.equal(f.manager.watchCount, 1);
  assert.equal(f.handles.get(child).closed, true);
  f.manager.sync([]);
  assert.equal(f.manager.watchCount, 0);
  assert.equal(f.handles.get(root).closed, true);
  f.manager.sync(Array.from({length: MAX_WATCHES + 7}, (_, i) => ({path: path.resolve(`folder-${i}`), watch: true})));
  assert.equal(f.manager.watchCount, MAX_WATCHES);
});

test('events debounce; hidden polling pauses and focus rechecks visible folders', async t => {
  const f = fixture(); t.after(() => f.manager.close());
  const root = path.resolve('visible-root');
  f.manager.sync([{path: root, watch: true}]);
  f.handles.get(root).changed(); f.handles.get(root).changed();
  await new Promise(resolve => setTimeout(resolve, 280));
  assert.deepEqual(f.sent, [[root]]);
  f.hide(); f.manager.poll();
  assert.equal(f.sent.length, 1);
  f.show();
  assert.deepEqual(f.sent.at(-1), [root]);
  f.minimize(); f.manager.poll();
  assert.equal(f.sent.length, 2);
  f.restore();
  assert.equal(f.sent.length, 3);
});

test('an unavailable watched folder retries with bounded backoff and recovers', t => {
  const f = fixture(); t.after(() => f.manager.close());
  const root = path.resolve('unavailable-root');
  // Emit a watcher failure, then verify no immediate retry and a later successful attach.
  f.manager.sync([{path: root, watch: true}]);
  const first = f.handles.get(root);
  first.emit('error', new Error('Offline'));
  assert.equal(first.closed, true);
  assert.equal(f.manager.watchCount, 0);
  f.manager.poll();
  assert.equal(f.manager.watchCount, 0);
  f.advance(5000);
  f.manager.poll();
  assert.equal(f.manager.watchCount, 1);
  assert.notEqual(f.handles.get(root), first);
});
