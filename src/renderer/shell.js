'use strict';

// The shell owns tabs, local roots and folder navigation; file viewing lives in file-viewer.
class PathMap extends Map {
  constructor() { super(); this.index = new Map(); }
  get(key) { return super.get(this.index.get(pathKey(key))); }
  has(key) { return this.index.has(pathKey(key)); }
  set(key, value) { const actual = this.index.get(pathKey(key)) || key; this.index.set(pathKey(key), actual); return super.set(actual, value); }
  delete(key) { const actual = this.index.get(pathKey(key)); this.index.delete(pathKey(key)); return super.delete(actual); }
  clear() { this.index.clear(); return super.clear(); }
}
class PathSet extends Set {
  constructor() { super(); this.index = new Map(); }
  has(key) { return this.index.has(pathKey(key)); }
  add(key) { if (!this.has(key)) { this.index.set(pathKey(key), key); super.add(key); } return this; }
  delete(key) { const actual = this.index.get(pathKey(key)); this.index.delete(pathKey(key)); return super.delete(actual); }
  clear() { this.index.clear(); return super.clear(); }
}
// The existing settings and project forms remain mounted inside Home.
const beta = {
  roots: [], rootStatus: [], pins: [], pinStatus: [], suggestedStatus: [], suggestionsExpanded: false, theme: 'system', homeOpen: true, side: 'explorer', collapsed: false,
  folders: new PathMap(), files: new PathMap(), tree: new PathMap(), expanded: new PathSet(),
  active: {kind: 'home'}, currentFolder: null, rootActive: null,
  history: [], historyIndex: -1, scope: 'folder', view: 'details',
  sort: 'name', direction: 'asc', search: '', type: 'all', selected: null,
  properties: false, notice: ''
};
const bq = selector => document.querySelector(selector);
const be = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label = p => p.replace(/[\\/]$/, '').split(/[\\/]/).at(-1) || p;
const rootLabel = p => label(p).replace(/^\d{4}_/, '').replace(/[_-]+/g, ' ');
const parent = p => { const trimmed = p.replace(/[\\/]+$/, ''); if (/^[A-Za-z]:$/.test(trimmed) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+$/.test(trimmed)) return p; const at = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/')); return at < 0 ? '' : at === 2 && trimmed[1] === ':' ? trimmed.slice(0, 3) : trimmed.slice(0, at) || trimmed.slice(0, 1); };
const same = (a, b) => pathKey(a) === pathKey(b);
const inside = (p, root) => same(p, root) || pathKey(p).startsWith(`${pathKey(root).replace(/\\$/, '')}\\`);
const rootFor = p => [...beta.roots].sort((a, b) => b.length - a.length).find(root => inside(p, root));
const ib = (key, title, action, extra = '') => `<button class="icon-button ${extra}" data-action="${be(action)}" aria-label="${be(title)}" title="${be(title)}" ${extra.includes('disabled') ? 'disabled' : ''}>${icon(key)}</button>`;
const kindType = item => item.kind === 'folder' ? 'Folder' : item.kind === 'link' ? 'Link' : (item.name.includes('.') ? item.name.split('.').at(-1).toUpperCase() : 'File');
const itemStatusIcon = item => item.kind !== 'folder' ? '' : item.status === 'empty' ? icon('empty', 13) : item.status === 'unavailable' ? icon('alert', 13) : '';
const formatDate = value => value ? new Date(value).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : '';
const retryState = new Map();
function retryAllowed(key) { return Date.now() >= (retryState.get(key)?.after || 0); }
function retryResult(key, success) {
  if (success) { retryState.delete(key); return; }
  const attempts = (retryState.get(key)?.attempts || 0) + 1;
  retryState.set(key, {attempts, after: Date.now() + Math.min(30000, 5000 * 2 ** (attempts - 1))});
}

function note(text) { beta.notice = text; renderBeta(); }
function failure(error) { note(error.message || String(error)); }
function setTheme(mode) { beta.theme = mode; document.documentElement.dataset.theme = mode === 'system' ? '' : mode; }
async function refreshRoots() {
  beta.roots = state.roots.slice();
  beta.rootStatus = api.rootStatus ? await api.rootStatus() : beta.roots.map(path => ({path, available: true}));
  beta.pins = state.pins.slice();
  beta.pinStatus = api.locationStatus ? await api.locationStatus(beta.pins.map(path => ({path, type: 'folder'}))) : [];
  await refreshSuggestions();
  renderBeta();
}
function record(path) {
  if (same(beta.history[beta.historyIndex], path)) return;
  beta.history = beta.history.slice(0, beta.historyIndex + 1);
  beta.history.push(path);
  beta.historyIndex = beta.history.length - 1;
}
function revealTab(selector, attribute, path) {
  window.requestAnimationFrame?.(() => {
    const tab = [...document.querySelectorAll(selector)].find(item => same(item.dataset[attribute], path));
    tab?.scrollIntoView?.({block: 'nearest', inline: 'nearest'});
  });
}
async function openFolder(path, addHistory = true) {
  const root = rootFor(path) || path;
  if (beta.active.kind === 'home') beta.homeOpen = false;
  if (!beta.folders.has(root)) beta.folders.set(root, {path: root, root, data: null, loading: false, error: null});
  const ancestors = [];
  for (let next = parent(path); next && inside(next, root) && !same(next, root); next = parent(next)) ancestors.unshift(next);
  for (const ancestor of ancestors) if (!beta.folders.has(ancestor)) beta.folders.set(ancestor, {path: ancestor, root, data: null, loading: false, error: null});
  if (!beta.folders.has(path)) beta.folders.set(path, {path, root, data: null, loading: false, error: null});
  beta.active = {kind: 'folder', path}; beta.currentFolder = path; beta.rootActive = root;
  beta.selected = null; beta.properties = false; beta.search = ''; beta.type = 'all';
  if (addHistory) record(path);
  renderBeta();
  revealTab('#tab-strip [data-folder]', 'folder', path);
  await loadFolder(path, 0);
}
async function loadFolder(path, offset = 0, quiet = false) {
  const tab = beta.folders.get(path);
  if (!tab) return;
  if (tab.loading || tab.refreshing) { tab.dirty = true; return; }
  const before = JSON.stringify([tab.data, tab.error]);
  tab.loading = !quiet; tab.refreshing = quiet;
  if (!quiet) tab.error = null;
  if (!quiet) renderBeta();
  try {
    const targetCount = quiet ? Math.max(500, tab.data?.entries.length || 0) : offset ? offset + 500 : 500;
    const entries = offset ? [...(tab.data?.entries || [])] : [];
    let next = offset;
    let result;
    do {
      result = await api.listFolder(path, next, beta.sort, beta.direction);
      entries.push(...result.entries);
      next = result.nextOffset;
    } while (next != null && entries.length < targetCount);
    if (!beta.folders.has(path)) return;
    tab.data = {entries, nextOffset: next, total: result.total};
    tab.error = null;
    retryResult(`tab:${path}`, true);
    if (beta.selected && same(beta.active.path, path) && !entries.some(item => same(item.path, beta.selected))) beta.selected = null;
  } catch (error) { tab.error = error.message; retryResult(`tab:${path}`, false); }
  finally {
    tab.loading = false;
    tab.refreshing = false;
    const dirty = tab.dirty; tab.dirty = false;
    const changed = JSON.stringify([tab.data, tab.error]) !== before;
    if (!quiet) renderBeta();
    else if (changed && beta.active.kind === 'folder' && same(beta.active.path, path)) {
      const area = bq('#beta-content');
      const scroll = area.scrollTop;
      const searchFocused = document.activeElement?.id === 'folder-search';
      const cursor = searchFocused ? document.activeElement.selectionStart : null;
      renderContent(); updateSelectedArea();
      area.scrollTop = scroll;
      if (searchFocused) {
        const input = bq('#folder-search');
        input?.focus(); input?.setSelectionRange(cursor, cursor);
      }
    }
    if (dirty && beta.folders.has(path)) loadFolder(path, 0, true).catch(failure);
  }
}
async function openFile(path) {
  if (!beta.folders.has(parent(path))) await openFolder(parent(path));
  let file = beta.files.get(path);
  if (!file) {
    file = {path, info: null, source: '', savedSource: '', error: null, mode: viewerPreferences.markdownMode, wrap: viewerPreferences.textWrap};
    beta.files.set(path, file);
    await loadViewerFile(file);
  }
  const folder = parent(path);
  if (beta.folders.has(folder)) beta.currentFolder = folder;
  beta.active = {kind: 'file', path}; beta.rootActive = rootFor(path) || folder;
  renderBeta();
  revealTab('#file-strip [data-file]', 'file', path);
}
function closeFolder(path) {
  if ([...beta.files.values()].some(file => inside(file.path, path) && viewerDirty(file))) { note('Save or discard open file edits before closing this folder.'); return; }
  for (const key of [...beta.folders.keys()]) if (inside(key, path)) beta.folders.delete(key);
  for (const file of [...beta.files.values()]) if (inside(file.path, path)) { beta.files.delete(file.path); if (file.handle) api.closeViewerFile?.(file.handle); }
  if (beta.active.kind !== 'home' && inside(beta.active.path, path)) {
    const remaining = [...beta.folders.keys()].at(-1);
    beta.active = remaining ? {kind: 'folder', path: remaining} : {kind: beta.homeOpen ? 'home' : 'none'};
    beta.currentFolder = remaining || null;
  }
  renderBeta();
}
function rootTabs() {
  const roots = [...new Set([...beta.folders.values()].map(tab => tab.root))];
  return roots.map(root => {
    const tabs = [...beta.folders.values()].filter(tab => same(tab.root, root));
    const active = beta.active.kind !== 'home' && beta.active.kind !== 'none' && same(beta.rootActive, root);
    const files = [...beta.files.keys()].filter(path => inside(path, root)).length;
    const descendants = tabs.filter(tab => !same(tab.path, root)).length;
    const badge = (kind, count) => count ? `<span class="tab-badge" title="${count} open ${kind} tabs in this branch">${icon(kind, 11)}${count}</span>` : '';
    const current = beta.currentFolder || root;
    const directChildren = folder => tabs.filter(tab => !same(tab.path, folder) && same(parent(tab.path), folder));
    const child = (tab, depth) => {
      const nested = directChildren(tab.path);
      const branchOpen = active && inside(current, tab.path) && nested.length;
      const childFolders = tabs.filter(other => !same(other.path, tab.path) && inside(other.path, tab.path)).length;
      const childFiles = [...beta.files.keys()].filter(path => inside(path, tab.path)).length;
      const selected = beta.active.kind === 'folder' && same(beta.active.path, tab.path);
      const own = `<span class="child-tab ${selected ? 'active' : ''} ${inside(current, tab.path) ? 'on-path' : ''}" style="--depth:${depth}"><button data-folder="${be(tab.path)}" title="${be(tab.path)}">${icon('folder', 14)}<span>${be(label(tab.path))}</span></button>${badge('folder', childFolders)}${badge('file', childFiles)}<button class="child-close" data-close-folder="${be(tab.path)}" aria-label="Close ${be(label(tab.path))} and child tabs" title="Close folder and child tabs">${icon('close', 12)}</button></span>`;
      return branchOpen ? `<span class="nested-branch">${own}${nested.map(item => child(item, depth + 1)).join('')}</span>` : own;
    };
    const head = `<div class="root-tab ${active ? 'expanded' : ''}"><button class="root-main ${same(beta.active.path, root) ? 'active' : ''}" data-folder="${be(root)}" title="${be(root)}">${icon('folder', 16)}<span>${be(rootLabel(root))}</span></button>${badge('folder', descendants)}${badge('file', files)}`;
    const children = active ? directChildren(root).map(tab => child(tab, 1)).join('') : '';
    return `${head}${children}<button class="root-close" data-close-folder="${be(root)}" aria-label="Close ${be(rootLabel(root))} root group" title="Close root group">${icon('close', 13)}</button></div>`;
  }).join('');
}
function renderTop() {
  bq('#panel-toggle').innerHTML = icon('panel');
  bq('#panel-toggle').setAttribute('aria-expanded', String(!beta.collapsed));
  for (const [side, key] of [['suggested', 'star'], ['explorer', 'folder'], ['pinned', 'pin']]) {
    const node = bq(`[data-side="${side}"]`); node.innerHTML = icon(key); node.classList.toggle('active', beta.side === side);
    node.setAttribute('aria-current', beta.side === side ? 'page' : 'false');
  }
  bq('[data-window="minimize"]').innerHTML = icon('minus');
  bq('[data-window="maximize"]').innerHTML = icon('maximize');
  bq('[data-window="close"]').innerHTML = icon('close');
  bq('#home-add').innerHTML = icon('plus');
  bq('#attention').innerHTML = icon('alert');
  bq('#activity').innerHTML = icon('activity');
  bq('#beta-shell').classList.toggle('collapsed', beta.collapsed);
  bq('#tab-strip').innerHTML = `${beta.homeOpen ? `<div class="home-tab ${beta.active.kind === 'home' ? 'active' : ''}"><button data-home-tab aria-label="Home" title="Home">${icon('home', 16)}</button><button data-close-home aria-label="Close Home tab" title="Close Home tab">${icon('close', 12)}</button></div>` : ''}${rootTabs()}`;
}
function renderSidebar() {
  const side = bq('#side-content');
  const scroll = side.scrollTop;
  side.innerHTML = beta.side === 'explorer' ? renderExplorerSidebar() : renderShortcutSidebar();
  side.scrollTop = scroll;
  syncVisibleFolders();
  scheduleSidebarWidth();
}
let visibleSignature = '';
function syncVisibleFolders() {
  if (!api.setVisibleFolders) return;
  const folders = new Map();
  const add = (path, watch) => {
    if (!path) return;
    const key = pathKey(path);
    folders.set(key, {path, watch: !!watch || !!folders.get(key)?.watch});
  };
  for (const path of beta.folders.keys()) add(path, true);
  if (!beta.collapsed && beta.side === 'explorer') {
    for (const row of bq('#side-content').querySelectorAll('.tree-row-beta[data-menu-kind="folder"]')) {
      add(row.dataset.menuPath, beta.expanded.has(row.dataset.menuPath));
    }
  } else if (!beta.collapsed && beta.side === 'pinned') {
    for (const row of bq('#side-content').querySelectorAll('.shortcut-row[data-menu-kind="folder"]')) add(row.dataset.menuPath, true);
  } else if (!beta.collapsed && beta.side === 'suggested') {
    for (const row of bq('#side-content').querySelectorAll('.shortcut-row[data-menu-kind="folder"]')) add(row.dataset.menuPath, true);
    for (const row of bq('#side-content').querySelectorAll('.shortcut-row[data-menu-kind="file"]')) add(parent(row.dataset.menuPath), true);
  }
  const list = [...folders.values()];
  const signature = JSON.stringify(list);
  if (signature !== visibleSignature) { visibleSignature = signature; api.setVisibleFolders(list).catch(failure); }
}
let sidebarMeasureQueued = false;
function scheduleSidebarWidth() {
  if (sidebarMeasureQueued) return;
  sidebarMeasureQueued = true;
  setTimeout(() => {
    sidebarMeasureQueued = false;
    const rows = [...bq('#side-content').querySelectorAll('.tree-row-beta, .shortcut-row')];
    const widths = rows.map(row => {
      const name = row.querySelector('.tree-name-beta span:last-child, button span:last-child');
      const depth = Number(row.style.getPropertyValue('--tree-depth')) || 0;
      const icons = row.querySelectorAll('svg').length;
      return 20 + depth * 13 + (row.classList.contains('tree-row-beta') ? 32 : 8) + icons * 17 + Math.max(0, icons - 1) * 6 + (name?.scrollWidth || 0) + (row.querySelector('.root-remove') ? 24 : 0) + 18;
    });
    const width = sidebarWidthForRows(widths, window.innerWidth);
    const shell = bq('#beta-shell');
    const current = parseInt(shell.style.getPropertyValue('--sidebar-width'), 10) || 266;
    if (width < current && [...beta.tree.values()].some(page => page.loading)) return;
    if (width !== current) shell.style.setProperty('--sidebar-width', `${width}px`);
  }, 16);
}
async function loadTree(root, more = false) {
  return loadExplorerBranch(root, more);
}
function visibleFiles() {
  const all = [...beta.files.values()]; const folder = beta.currentFolder;
  if (beta.scope === 'all') return all;
  if (beta.scope === 'root') return all.filter(file => rootFor(file.path) && same(rootFor(file.path), beta.rootActive));
  return all.filter(file => folder && same(parent(file.path), folder));
}
function renderFiles() {
  const strip = bq('#file-strip');
  strip.hidden = beta.active.kind === 'home' || !beta.files.size;
  if (strip.hidden) return;
  const choices = {folder: 'Files in selected folder', root: 'Files in root group', all: 'All open files'};
  strip.innerHTML = `${ib(`file_scope_${beta.scope === 'root' ? 'tab' : beta.scope}`, `${choices[beta.scope]}; click for next scope`, 'scope', 'scope-button')}<span class="file-strip-label">Open files</span>${visibleFiles().map(file => `<span class="file-pill ${beta.active.kind === 'file' && same(beta.active.path, file.path) ? 'active' : ''} ${viewerDirty(file) ? 'dirty' : ''}"><button data-file="${be(file.path)}" title="${be(file.path)}">${icon('file', 14)}<span>${be(label(file.path))}${beta.scope !== 'folder' ? `<small>${be(label(parent(file.path)))}</small>` : ''}</span></button><button data-close-file="${be(file.path)}" aria-label="Close ${be(label(file.path))}" title="Close file tab">${icon('close', 12)}</button></span>`).join('') || `<span class="muted">No open files in this scope. ${beta.files.size} open elsewhere.</span>`}`;
}
function pathButtons(path) {
  const separator = path.includes('\\') ? '\\' : '/';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const windowsDrive = /^[A-Za-z]:$/.test(parts[0]);
  const unc = path.startsWith('\\\\') || path.startsWith('//');
  let current = unc ? `\\\\${parts.shift()}\\${parts.shift()}` : windowsDrive ? `${parts.shift()}\\` : '/';
  const segments = [{name: current === '/' ? '/' : current.replace(/[\\/]$/, ''), path: current}];
  for (const part of parts) {
    current = `${current.replace(/[\\/]$/, '')}${separator}${part}`;
    segments.push({name: part, path: current});
  }
  return segments.map(({name, path: segment}, index) => `${index ? '<span class="path-separator">›</span>' : ''}<button data-folder="${be(segment)}" title="Open ${be(segment)}">${be(name)}</button>`).join('');
}
function typeFilter(entries, types) {
  if (!types.length) return '';
  const files = entries.filter(item => item.kind !== 'folder');
  const options = [['all', 'All file types', files.length], ...types.map(type => [type, type, files.filter(item => kindType(item) === type).length])];
  return `<details class="type-filter"><summary aria-label="Filter file types" title="Filter file types" class="icon-button ${beta.type !== 'all' ? 'active' : ''}">${icon('filter', 17)}</summary><div class="type-menu"><strong>File type</strong>${options.map(([key, name, count]) => `<button data-file-type="${be(key)}" class="${beta.type === key ? 'active' : ''}" aria-pressed="${beta.type === key}"><span>${beta.type === key ? icon('check', 14) : ''}</span><span>${be(name)}</span><small>${count}</small></button>`).join('')}</div></details>`;
}
function sortHead(key, name) {
  const active = beta.sort === key;
  return `<button data-sort="${key}" class="${active ? 'active' : ''}" aria-label="Sort by ${name}${active ? `, currently ${beta.direction}ending` : ''}" title="Sort by ${name}">${name}${active ? `<span class="sort-arrow ${beta.direction}">${icon('chevron_down', 12)}</span>` : ''}</button>`;
}
function renderFolder(tab) {
  const path = tab.path; const data = tab.data;
  const partial = data && data.nextOffset !== null;
  const entries = data?.entries || [];
  const types = [...new Set(entries.filter(item => item.kind !== 'folder').map(kindType))].sort();
  const shown = entries.filter(item => (beta.type === 'all' || item.kind === 'folder' || kindType(item) === beta.type) && item.name.toLowerCase().includes(beta.search.toLowerCase()));
  const selected = entries.find(item => item.path === beta.selected);
  return `<div class="folder-workspace">
    <div class="path-row"><div class="nav-buttons">${ib('back', 'Back', 'back', beta.historyIndex <= 0 ? 'disabled' : '')}${ib('forward', 'Forward', 'forward', beta.historyIndex >= beta.history.length - 1 ? 'disabled' : '')}${ib('up', 'Up', 'up', !parent(path) || same(path, parent(path)) ? 'disabled' : '')}${ib('folder', 'Go to folder', 'go-folder')}</div><nav class="breadcrumbs" aria-label="Current folder path">${icon('folder', 16)}${pathButtons(path)}</nav></div>
    <div class="action-row">${ib('plus', 'New folder or file: later stage', 'placeholder-new', 'new-control disabled')}
      <div class="view-buttons">${[['details','view_details'], ['list','view_list'], ['icons','view_icons']].map(([view,key]) => ib(key, `${view[0].toUpperCase()}${view.slice(1)} view`, `view:${view}`, beta.view === view ? 'active' : '')).join('')}</div>
      ${typeFilter(entries, types)}
      <button class="properties-trigger ${beta.properties ? 'active' : ''}" data-action="properties" ${selected ? '' : 'hidden'} title="Properties of selected item">${icon('properties', 15)} Properties</button>
      <div class="action-end"><label class="search-label">${icon('search', 15)}<input id="folder-search" value="${be(beta.search)}" placeholder="Search this folder" aria-label="Search loaded entries"></label>${ib('more', 'Options: later stage', 'placeholder-options', 'disabled')}</div>
    </div>
    ${partial ? `<p class="scope-note">Search and type filter cover ${entries.length} of ${data.total} loaded entries. Sort covers the whole folder.</p>` : ''}
    ${beta.properties && selected ? `<div class="properties"><strong>${be(selected.name)}</strong><span>${be(selected.path)}</span><span>${be(kindType(selected))}</span><span>${be(formatDate(selected.modified))}</span></div>` : ''}
    ${tab.error ? `<div class="state-card error">${icon('alert', 22)}<h2>Folder unavailable</h2><p>${be(tab.error)}</p><button data-action="refresh">Try again</button></div>` : tab.loading && !data ? `<div class="state-card">${icon('refresh', 22)}<h2>Loading this folder</h2><p>Checking the selected location.</p></div>` : !entries.length ? '<div class="state-card"><h2>This folder is empty</h2><p>New folders and files will appear here.</p></div>' : `<div class="folder-list view-${beta.view}"><div class="list-head">${sortHead('name', 'Name')}${sortHead('type', 'Type')}${sortHead('modified', 'Modified')}</div><div class="folder-items">${shown.map(item => `<button class="file-row ${beta.selected === item.path ? 'active' : ''}" data-item="${be(item.path)}" data-kind="${be(item.kind)}" aria-pressed="${beta.selected === item.path}" title="Select ${be(item.name)}; double-click or press Enter to open"><span class="name">${itemStatusIcon(item)}${icon(item.kind === 'folder' ? 'folder' : item.kind === 'link' ? 'external' : 'file', 17)}<span>${be(item.name)}</span></span><span class="meta">${be(kindType(item))}</span><span class="meta">${be(formatDate(item.modified))}</span></button>`).join('') || '<div class="state-card"><h2>No matches</h2><p>Try another search or file type.</p></div>'}</div></div>`}
    ${data?.nextOffset !== null && data?.nextOffset !== undefined ? `<div class="load-more"><span>Showing ${data.entries.length} of ${data.total}</span><button data-action="more" ${tab.loading ? 'disabled' : ''}>Load more</button></div>` : ''}
    <div class="folder-status"><span>${shown.length} item${shown.length === 1 ? '' : 's'}${partial ? ` of ${data.total} loaded` : ''}</span><span>Select once for properties; double-click or press Enter to open</span></div>
  </div>`;
}
function renderContent() {
  const active = beta.active;
  const home = active.kind === 'home';
  bq('#legacy').hidden = !home;
  bq('#beta-content').hidden = home;
  if (home) return;
  bq('#beta-content').innerHTML = active.kind === 'file' ? renderFileViewer(beta.files.get(active.path)) : active.kind === 'folder' ? renderFolder(beta.folders.get(active.path)) : '<div class="state-card">No tab open. Use the plus button in the Explorer footer to open Home.</div>';
}
function renderBeta() {
  const tabScroll = bq('#tab-strip').scrollLeft;
  const fileScroll = bq('#file-strip').scrollLeft;
  const sideScroll = bq('#side-content').scrollTop;
  const contentScroll = bq('#beta-content').scrollTop;
  renderTop(); renderSidebar(); renderFiles(); renderContent();
  updateSelectedArea();
  const pathBar = bq('.breadcrumbs');
  if (pathBar) pathBar.scrollLeft = pathBar.scrollWidth;
  bq('#tab-strip').scrollLeft = tabScroll;
  bq('#file-strip').scrollLeft = fileScroll;
  bq('#side-content').scrollTop = sideScroll;
  bq('#beta-content').scrollTop = contentScroll;
  let banner = bq('#beta-note');
  if (!banner) { banner = document.createElement('div'); banner.id = 'beta-note'; banner.setAttribute('role', 'status'); document.body.append(banner); }
  banner.hidden = !beta.notice;
  banner.textContent = beta.notice;
}

function updateSelectedArea() {
  const workspace = bq('.folder-workspace');
  workspace?.querySelector('.selected-area')?.remove();
  if (!workspace || !beta.selected) return;
  const item = beta.folders.get(beta.active.path)?.data?.entries.find(entry => entry.path === beta.selected);
  if (!item) return;
  const node = document.createElement('div');
  node.className = 'selected-area';
  node.textContent = `${item.name} · ${kindType(item)} · ${item.path}`;
  workspace.querySelector('.folder-list, .state-card')?.before(node);
}

async function refreshCurrentView() {
  const path = beta.active.kind === 'folder' ? beta.active.path : beta.currentFolder;
  const jobs = [];
  if (path && beta.folders.has(path)) jobs.push(loadFolder(path, 0, true));
  if (path && beta.expanded.has(path)) jobs.push(loadExplorerBranch(path, false, true));
  if (beta.active.kind === 'file') jobs.push(checkViewerFile(beta.files.get(beta.active.path), true));
  jobs.push(refreshRoots());
  await Promise.all(jobs);
}

const pendingFolderChanges = new PathSet();
let folderChangeTimer;
let applyingFolderChanges = false;
async function refreshLiveStatuses(paths) {
  if (!api.locationStatus) { await refreshRoots(); return; }
  const suggested = state.settings?.data.suggestedLocations || [];
  const targets = [...new Map([
    ...beta.roots.map(path => [pathKey(path), {path, type: 'folder'}]),
    ...beta.pins.map(path => [pathKey(path), {path, type: 'folder'}]),
    ...suggested.map(item => [pathKey(item.path), {path: item.path, type: item.type}])
  ]).values()].filter(item => paths.some(path => same(path, item.path) || item.type === 'file' && same(path, parent(item.path))) && retryAllowed(`status:${item.path}`));
  if (!targets.length) return;
  const results = await api.locationStatus(targets);
  let changed = false;
  for (const result of results) {
    retryResult(`status:${result.path}`, result.available);
    const update = list => {
      const index = list.findIndex(item => same(item.path, result.path));
      if (index >= 0 && ['available', 'status', 'error'].some(key => list[index][key] !== result[key])) {
        list[index] = result;
        changed = true;
      }
    };
    update(beta.rootStatus); update(beta.pinStatus); update(beta.suggestedStatus);
  }
  if (changed) renderSidebar();
}
async function applyFolderChanges() {
  if (applyingFolderChanges) return;
  applyingFolderChanges = true;
  try {
    const paths = [...pendingFolderChanges];
    pendingFolderChanges.clear();
    const work = [];
    for (const path of paths) {
      if (beta.folders.has(path) && retryAllowed(`tab:${path}`)) work.push(() => loadFolder(beta.folders.get(path).path, 0, true));
      for (const file of beta.files.values()) if (same(parent(file.path), path)) work.push(() => checkViewerFile(file));
      if (beta.expanded.has(path) && retryAllowed(`tree:${path}`) && !beta.collapsed && beta.side === 'explorer' && [...bq('#side-content').querySelectorAll('[data-expand]')].some(row => same(row.dataset.expand, path))) {
        work.push(() => loadExplorerBranch(path, false, true));
      }
    }
    let index = 0;
    await Promise.all(Array.from({length: Math.min(8, work.length)}, async () => {
      while (index < work.length) await work[index++]();
    }));
    await refreshLiveStatuses(paths);
    await refreshCollapsedRows(paths);
  } finally {
    applyingFolderChanges = false;
    if (pendingFolderChanges.size) setTimeout(() => applyFolderChanges().catch(failure), 0);
  }
}
api.onFolderChanges?.(paths => {
  for (const path of paths) pendingFolderChanges.add(path);
  clearTimeout(folderChangeTimer);
  folderChangeTimer = setTimeout(() => applyFolderChanges().catch(failure), 100);
});

async function action(name) {
  const current = beta.active.kind === 'folder' ? beta.active.path : beta.currentFolder;
  if (name === 'add-root') { state.roots = await api.addRoot(); await refreshRoots(); return; }
  if (name === 'scope') beta.scope = {folder:'root', root:'all', all:'folder'}[beta.scope];
  if (name === 'back' && beta.historyIndex > 0) { beta.historyIndex--; await openFolder(beta.history[beta.historyIndex], false); return; }
  if (name === 'forward' && beta.historyIndex < beta.history.length - 1) { beta.historyIndex++; await openFolder(beta.history[beta.historyIndex], false); return; }
  if (name === 'up' && current && parent(current) && !same(current, parent(current))) { await openFolder(parent(current)); return; }
  if (name === 'go-folder') { const path = await askPath('Go to folder', current || ''); if (path) await openFolder(path); return; }
  if (name === 'add-pin') { await addPinDialog(); return; }
  if (name === 'suggested-list' || name === 'suggested-groups') { beta.suggestionsExpanded = name === 'suggested-groups'; renderBeta(); return; }
  if (name === 'refresh') { await refreshCurrentView(); return; }
  if (name === 'more' && current) { await loadFolder(current, beta.folders.get(current).data.nextOffset); return; }
  if (name === 'properties') beta.properties = !beta.properties;
  if (name.startsWith('view:')) beta.view = name.slice(5);
  if (name === 'folder-view' && current) { beta.active = {kind:'folder', path:current}; await openFolder(current); return; }
  if (name === 'file-refresh' && beta.active.kind === 'file') { await checkViewerFile(beta.files.get(beta.active.path), true); return; }
  renderBeta();
}
document.addEventListener('click', event => {
  const target = event.target.closest('button'); if (!target || !target.closest('#beta-shell')) return;
  if (target.closest('.viewer-frame')) return;
  const run = async () => {
    if (target.dataset.window) return api.windowControl(target.dataset.window);
    if (target.id === 'panel-toggle') beta.collapsed = !beta.collapsed;
    else if (target.dataset.side) beta.side = target.dataset.side;
    else if (target.id === 'home-add' || target.hasAttribute('data-home-tab')) { beta.homeOpen = true; beta.active = {kind:'home'}; }
    else if (target.hasAttribute('data-close-home')) { beta.homeOpen = false; const path = [...beta.folders.keys()].at(-1); beta.active = path ? {kind:'folder', path} : {kind:'none'}; }
    else if (target.dataset.folder) return openFolder(target.dataset.folder);
    else if (target.dataset.file) return openFile(target.dataset.file);
    else if (target.dataset.closeFolder) return closeFolder(target.dataset.closeFolder);
    else if (target.dataset.closeFile) { await closeViewerTab(target.dataset.closeFile); return; }
    else if (target.dataset.removeRoot) { state.roots = await api.removeRoot(target.dataset.removeRoot); await refreshRoots(); }
    else if (target.dataset.expand) {
      const path = target.dataset.expand;
      if (beta.expanded.has(path)) { beta.expanded.delete(path); renderSidebar(); }
      else {
        beta.expanded.add(path);
        if (beta.tree.has(path)) { renderSidebar(); await loadExplorerBranch(path, false, true); }
        else await loadExplorerBranch(path);
      }
      return;
    }
    else if (target.dataset.groupToggle) { const path = target.dataset.groupToggle; suggestedGroups.has(path) ? suggestedGroups.delete(path) : suggestedGroups.add(path); }
    else if (target.dataset.treeMore) return loadTree(target.dataset.treeMore, true);
    else if (target.dataset.openItem) return target.dataset.kind === 'folder' ? openFolder(target.dataset.openItem) : openFile(target.dataset.openItem);
    else if (target.dataset.fileType) { beta.type = target.dataset.fileType; beta.selected = null; beta.properties = false; }
    else if (target.dataset.sort) { beta.direction = beta.sort === target.dataset.sort && beta.direction === 'asc' ? 'desc' : 'asc'; beta.sort = target.dataset.sort; if (beta.active.kind === 'folder') return loadFolder(beta.active.path, 0); }
    else if (target.dataset.item) {
      beta.selected = target.dataset.item; beta.properties = false;
      const workspace = target.closest('.folder-workspace');
      workspace.querySelectorAll('.file-row').forEach(row => {
        const selected = row === target;
        row.classList.toggle('active', selected);
        row.setAttribute('aria-pressed', String(selected));
      });
      workspace.querySelector('.properties-trigger').hidden = false;
      workspace.querySelector('.properties')?.remove();
      updateSelectedArea();
      return;
    }
    else if (target.dataset.action) return action(target.dataset.action);
    else if (target.id === 'attention') note(state.settingsError || state.localError || 'No attention items.');
    else if (target.id === 'activity') note('Activity is limited to the creation recovery list on Home.');
    renderBeta();
  };
  run().catch(failure);
});
document.querySelectorAll('[data-workflow]').forEach(button => button.addEventListener('click', () => {
  setPage(button.dataset.workflow);
  document.querySelectorAll('[data-workflow]').forEach(item => item.classList.toggle('active', item === button));
}));
document.addEventListener('dblclick', event => {
  const row = event.target.closest('#beta-content [data-item]');
  if (row) (row.dataset.kind === 'folder' ? openFolder(row.dataset.item) : openFile(row.dataset.item)).catch(failure);
});
document.addEventListener('keydown', event => {
  if (event.key === 'F5') { event.preventDefault(); refreshCurrentView().catch(failure); return; }
  const row = event.target.closest('#beta-content [data-item]');
  if (row && event.key === 'Enter') { event.preventDefault(); (row.dataset.kind === 'folder' ? openFolder(row.dataset.item) : openFile(row.dataset.item)).catch(failure); }
  if (event.key === 'Escape' && beta.notice) { beta.notice = ''; renderBeta(); }
});
window.addEventListener('resize', scheduleSidebarWidth);
window.addEventListener('focus', scheduleSidebarWidth);
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSidebarWidth(); });
document.addEventListener('input', event => {
  if (event.target.id !== 'folder-search') return;
  const cursor = event.target.selectionStart;
  beta.search = event.target.value; beta.selected = null; beta.properties = false; renderBeta();
  const input = bq('#folder-search'); input?.focus(); input?.setSelectionRange(cursor, cursor);
});
document.addEventListener('wheel', event => {
  const strip = event.target.closest('#tab-strip, #file-strip');
  if (!strip || strip.scrollWidth <= strip.clientWidth || !event.deltaY) return;
  strip.scrollLeft += event.deltaY;
  event.preventDefault();
}, {passive: false});
window.addEventListener('legacy-boot', () => { viewerSetup(state.viewerPreferences); setTheme(state.theme); refreshRoots().catch(failure); });
window.addEventListener('legacy-page', event => document.querySelectorAll('[data-workflow]').forEach(item => item.classList.toggle('active', item.dataset.workflow === event.detail)));
window.addEventListener('roots-changed', () => refreshRoots().catch(failure));
window.addEventListener('suggestions-changed', () => refreshSuggestions().then(renderBeta).catch(failure));
window.addEventListener('shell-open-folder', event => openFolder(event.detail).catch(failure));
renderBeta();
if (state.booted) { viewerSetup(state.viewerPreferences); setTheme(state.theme); refreshRoots().catch(failure); }
