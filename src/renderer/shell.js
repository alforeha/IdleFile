'use strict';

// Stage 2 shell owns tabs, local roots, folder navigation and file placeholders.
// The existing settings and project forms remain mounted inside Home.
const beta = {
  roots: [], rootStatus: [], theme: 'system', homeOpen: true, side: 'explorer', collapsed: false,
  folders: new Map(), files: new Map(), tree: new Map(), expanded: new Set(),
  active: {kind: 'home'}, currentFolder: null, rootActive: null,
  history: [], historyIndex: -1, scope: 'folder', view: 'details',
  sort: 'name', direction: 'asc', search: '', type: 'all', selected: null,
  properties: false, notice: ''
};
const bq = selector => document.querySelector(selector);
const be = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label = p => p.replace(/[\\/]$/, '').split(/[\\/]/).at(-1) || p;
const rootLabel = p => label(p).replace(/^\d{4}_/, '').replace(/[_-]+/g, ' ');
const parent = p => { const trimmed = p.replace(/[\\/]$/, ''); const at = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/')); return at < 0 ? '' : at === 2 && trimmed[1] === ':' ? trimmed.slice(0, 3) : trimmed.slice(0, at) || trimmed.slice(0, 1); };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const inside = (p, root) => same(p, root) || p.toLowerCase().startsWith(`${root.replace(/[\\/]$/, '').toLowerCase()}${root.includes('\\') ? '\\' : '/'}`);
const rootFor = p => [...beta.roots].sort((a, b) => b.length - a.length).find(root => inside(p, root));
const ib = (key, title, action, extra = '') => `<button class="icon-button ${extra}" data-action="${be(action)}" aria-label="${be(title)}" title="${be(title)}" ${extra.includes('disabled') ? 'disabled' : ''}>${icon(key)}</button>`;
const kindType = item => item.kind === 'folder' ? 'Folder' : item.kind === 'link' ? 'Link' : (item.name.includes('.') ? item.name.split('.').at(-1).toUpperCase() : 'File');
const formatDate = value => value ? new Date(value).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : '';

function note(text) { beta.notice = text; renderBeta(); }
function failure(error) { note(error.message || String(error)); }
function setTheme(mode) { beta.theme = mode; document.documentElement.dataset.theme = mode === 'system' ? '' : mode; if (bq('#theme-select')) bq('#theme-select').value = mode; }
async function refreshRoots() {
  beta.roots = state.roots.slice();
  beta.rootStatus = api.rootStatus ? await api.rootStatus() : beta.roots.map(path => ({path, available: true}));
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
  const root = rootFor(path);
  if (!root) { note('This folder is outside local Explorer roots. Add its root first.'); return; }
  if (beta.active.kind === 'home') beta.homeOpen = false;
  beta.expanded.add(root);
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
  await Promise.all([loadFolder(path, 0), beta.tree.has(root) ? Promise.resolve() : loadTree(root)]);
}
async function loadFolder(path, offset = 0) {
  const tab = beta.folders.get(path);
  if (!tab || tab.loading) return;
  tab.loading = true; tab.error = null; renderBeta();
  try {
    const result = await api.listFolder(path, offset, beta.sort, beta.direction);
    if (!beta.folders.has(path)) return;
    tab.data = {entries: [...(offset ? tab.data?.entries || [] : []), ...result.entries], nextOffset: result.nextOffset, total: result.total};
  } catch (error) { tab.error = error.message; }
  finally { tab.loading = false; renderBeta(); }
}
async function openFile(path) {
  if (!beta.folders.has(parent(path)) && rootFor(path)) await openFolder(parent(path));
  let info = null; let error = null;
  try { info = await api.inspectFile(path); }
  catch (failure) { error = failure.message; }
  if (!beta.files.has(path)) beta.files.set(path, {path, info, error});
  else Object.assign(beta.files.get(path), {info, error});
  const folder = parent(path);
  if (beta.folders.has(folder)) beta.currentFolder = folder;
  beta.active = {kind: 'file', path}; beta.rootActive = rootFor(path) || beta.rootActive;
  renderBeta();
  revealTab('#file-strip [data-file]', 'file', path);
}
function closeFolder(path) {
  for (const key of [...beta.folders.keys()]) if (inside(key, path)) beta.folders.delete(key);
  for (const key of [...beta.files.keys()]) if (inside(key, path)) beta.files.delete(key);
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
  const target = bq('#side-content');
  if (beta.side !== 'explorer') {
    target.innerHTML = `<div class="side-heading">${beta.side === 'suggested' ? 'Suggested' : 'Pinned'}</div><div class="empty-side">${beta.side === 'suggested' ? 'Shared suggestions are not configured in schema v1 yet.' : 'Local pins arrive in a later stage.'}</div>`;
    return;
  }
  target.innerHTML = `<div class="side-heading">Explorer ${ib('plus', 'Add local root', 'add-root')}</div>
    ${beta.rootStatus.length ? beta.rootStatus.map(status => treeRoot(status)).join('') : '<div class="empty-side">Add a folder from this PC to browse it here.</div>'}`;
}
function treeRoot(status) {
  const root = status.path; const expanded = beta.expanded.has(root); const cached = beta.tree.get(root);
  const children = !expanded ? '' : !status.available ? `<div class="tree-message">Disconnected or missing. Path is remembered.</div>` : !cached ? '<div class="tree-message">Loading...</div>' : cached.error ? `<div class="tree-message">${be(cached.error)} ${ib('refresh', 'Retry root', `tree-refresh:${root}`)}</div>` : cached.entries.map(item => `<button class="tree-child" data-open-item="${be(item.path)}" data-kind="${be(item.kind)}" title="${be(item.path)}">${icon(item.kind === 'folder' ? 'folder' : 'file', 14)}<span>${be(item.name)}</span></button>`).join('') + (cached.nextOffset !== null ? `<button class="tree-more" data-tree-more="${be(root)}">Load more (${cached.entries.length}/${cached.total})</button>` : '');
  return `<div class="side-root ${same(beta.active.path, root) ? 'active' : ''}"><button class="tree-chevron" data-expand="${be(root)}" aria-label="${expanded ? 'Collapse' : 'Expand'} ${be(rootLabel(root))}" title="${expanded ? 'Collapse' : 'Expand'} root">${icon(expanded ? 'chevron_down' : 'chevron_right', 14)}</button><button class="root-name" data-folder="${be(root)}" title="${be(root)}">${icon('folder', 16)}<span>${be(rootLabel(root))}</span>${!status.available ? icon('alert', 14) : ''}</button><button class="root-remove" data-remove-root="${be(root)}" aria-label="Remove ${be(rootLabel(root))} root" title="Remove local root">${icon('close', 13)}</button></div>${children}`;
}
async function loadTree(root, more = false) {
  const old = more ? beta.tree.get(root) : null;
  try {
    const page = await api.listFolder(root, old?.nextOffset || 0);
    beta.tree.set(root, {entries: [...(old?.entries || []), ...page.entries], nextOffset: page.nextOffset, total: page.total});
  } catch (error) { beta.tree.set(root, {error: error.message}); }
  renderSidebar();
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
  strip.innerHTML = `${ib(`file_scope_${beta.scope === 'root' ? 'tab' : beta.scope}`, `${choices[beta.scope]}; click for next scope`, 'scope', 'scope-button')}<span class="file-strip-label">Open files</span>${visibleFiles().map(file => `<span class="file-pill ${beta.active.kind === 'file' && same(beta.active.path, file.path) ? 'active' : ''}"><button data-file="${be(file.path)}" title="${be(file.path)}">${icon('file', 14)}<span>${be(label(file.path))}${beta.scope !== 'folder' ? `<small>${be(label(parent(file.path)))}</small>` : ''}</span></button><button data-close-file="${be(file.path)}" aria-label="Close ${be(label(file.path))}" title="Close file tab">${icon('close', 12)}</button></span>`).join('') || `<span class="muted">No open files in this scope. ${beta.files.size} open elsewhere.</span>`}`;
}
function pathButtons(path) {
  const root = rootFor(path); if (!root) return `<span>${be(path)}</span>`;
  const separator = path.includes('\\') ? '\\' : '/';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const windowsDrive = /^[A-Za-z]:$/.test(parts[0]);
  const unc = path.startsWith('\\\\');
  let current = unc ? `\\\\${parts.shift()}\\${parts.shift()}` : windowsDrive ? `${parts.shift()}\\` : '/';
  const segments = [{name: current === '/' ? '/' : current.replace(/[\\/]$/, ''), path: current}];
  for (const part of parts) {
    current = `${current.replace(/[\\/]$/, '')}${separator}${part}`;
    segments.push({name: part, path: current});
  }
  return segments.map(({name, path: segment}, index) => `${index ? '<span class="path-separator">›</span>' : ''}${inside(segment, root) ? `<button data-folder="${be(segment)}" title="Open ${be(segment)}">${be(name)}</button>` : `<span class="path-ancestor" title="${be(segment)}">${be(name)}</span>`}`).join('');
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
  if (!rootFor(path)) return `<div class="state-card">${be(path)} is outside the current local roots. Add its root again or close this tab.</div>`;
  const partial = data && data.nextOffset !== null;
  const entries = data?.entries || [];
  const types = [...new Set(entries.filter(item => item.kind !== 'folder').map(kindType))].sort();
  const shown = entries.filter(item => (beta.type === 'all' || item.kind === 'folder' || kindType(item) === beta.type) && item.name.toLowerCase().includes(beta.search.toLowerCase()));
  const selected = entries.find(item => item.path === beta.selected);
  return `<div class="folder-workspace">
    <div class="path-row"><div class="nav-buttons">${ib('back', 'Back', 'back', beta.historyIndex <= 0 ? 'disabled' : '')}${ib('forward', 'Forward', 'forward', beta.historyIndex >= beta.history.length - 1 ? 'disabled' : '')}${ib('up', 'Up', 'up', same(path, tab.root) ? 'disabled' : '')}</div><nav class="breadcrumbs" aria-label="Current folder path">${icon('folder', 16)}${pathButtons(path)}</nav></div>
    <div class="action-row">${ib('plus', 'New folder or file: later stage', 'placeholder-new', 'new-control disabled')}
      <div class="view-buttons">${[['details','view_details'], ['list','view_list'], ['icons','view_icons']].map(([view,key]) => ib(key, `${view[0].toUpperCase()}${view.slice(1)} view`, `view:${view}`, beta.view === view ? 'active' : '')).join('')}</div>
      ${typeFilter(entries, types)}
      <button class="properties-trigger ${beta.properties ? 'active' : ''}" data-action="properties" ${selected ? '' : 'hidden'} title="Properties of selected item">${icon('properties', 15)} Properties</button>
      <div class="action-end"><label class="search-label">${icon('search', 15)}<input id="folder-search" value="${be(beta.search)}" placeholder="Search this folder" aria-label="Search loaded entries"></label>${ib('refresh', 'Refresh folder', 'refresh')}${ib('more', 'Options: later stage', 'placeholder-options', 'disabled')}</div>
    </div>
    ${partial ? `<p class="scope-note">Search and type filter cover ${entries.length} of ${data.total} loaded entries. Sort covers the whole folder.</p>` : ''}
    ${beta.properties && selected ? `<div class="properties"><strong>${be(selected.name)}</strong><span>${be(selected.path)}</span><span>${be(kindType(selected))}</span><span>${be(formatDate(selected.modified))}</span></div>` : ''}
    ${tab.error ? `<div class="state-card error">${icon('alert', 22)}<h2>Folder unavailable</h2><p>${be(tab.error)}</p><button data-action="refresh">Try again</button></div>` : tab.loading && !data ? `<div class="state-card">${icon('refresh', 22)}<h2>Loading this folder</h2><p>Checking the selected location.</p></div>` : !entries.length ? '<div class="state-card"><h2>This folder is empty</h2><p>New folders and files will appear here.</p></div>' : `<div class="folder-list view-${beta.view}"><div class="list-head">${sortHead('name', 'Name')}${sortHead('type', 'Type')}${sortHead('modified', 'Modified')}</div><div class="folder-items">${shown.map(item => `<button class="file-row ${beta.selected === item.path ? 'active' : ''}" data-item="${be(item.path)}" data-kind="${be(item.kind)}" aria-pressed="${beta.selected === item.path}" title="Select ${be(item.name)}; double-click or press Enter to open"><span class="name">${icon(item.kind === 'folder' ? 'folder' : item.kind === 'link' ? 'external' : 'file', 17)}<span>${be(item.name)}</span></span><span class="meta">${be(kindType(item))}</span><span class="meta">${be(formatDate(item.modified))}</span></button>`).join('') || '<div class="state-card"><h2>No matches</h2><p>Try another search or file type.</p></div>'}</div></div>`}
    ${data?.nextOffset !== null && data?.nextOffset !== undefined ? `<div class="load-more"><span>Showing ${data.entries.length} of ${data.total}</span><button data-action="more" ${tab.loading ? 'disabled' : ''}>Load more</button></div>` : ''}
    <div class="folder-status"><span>${shown.length} item${shown.length === 1 ? '' : 's'}${partial ? ` of ${data.total} loaded` : ''}</span><span>Select once for properties; double-click or press Enter to open</span></div>
  </div>`;
}
function renderFile(file) {
  const info = file.info; const removed = !rootFor(file.path);
  return `<div class="viewer-frame"><div class="viewer-head">${ib('back', 'Back to folder', 'folder-view')}<div><h1>${be(label(file.path))}</h1><p>${be(file.path)}</p></div></div><div class="viewer-placeholder">${icon('file', 36)}<h2>File viewer comes in Stage 5</h2><p>No file contents are read in this beta.</p>${info ? `<dl><dt>Type</dt><dd>${be(info.type)}</dd><dt>Modified</dt><dd>${be(formatDate(info.modified))}</dd></dl>` : ''}${removed ? '<p class="error">Its local root was removed. Add the root again to reopen this file.</p>' : file.error ? `<p class="error">${be(file.error)}</p>` : ''}<button data-action="file-refresh">Check file again</button></div></div>`;
}
function renderContent() {
  const active = beta.active;
  const home = active.kind === 'home';
  bq('#legacy').hidden = !home;
  bq('#beta-content').hidden = home;
  if (home) return;
  bq('#beta-content').innerHTML = active.kind === 'file' ? renderFile(beta.files.get(active.path)) : active.kind === 'folder' ? renderFolder(beta.folders.get(active.path)) : '<div class="state-card">No tab open. Use the plus button in the Explorer footer to open Home.</div>';
}
function renderBeta() {
  const tabScroll = bq('#tab-strip').scrollLeft;
  const fileScroll = bq('#file-strip').scrollLeft;
  renderTop(); renderSidebar(); renderFiles(); renderContent();
  const pathBar = bq('.breadcrumbs');
  if (pathBar) pathBar.scrollLeft = pathBar.scrollWidth;
  bq('#tab-strip').scrollLeft = tabScroll;
  bq('#file-strip').scrollLeft = fileScroll;
  let banner = bq('#beta-note');
  if (!banner) { banner = document.createElement('div'); banner.id = 'beta-note'; banner.setAttribute('role', 'status'); document.body.append(banner); }
  banner.hidden = !beta.notice;
  banner.textContent = beta.notice;
}

async function action(name) {
  const current = beta.active.kind === 'folder' ? beta.active.path : beta.currentFolder;
  if (name === 'add-root') { state.roots = await api.addRoot(); await refreshRoots(); return; }
  if (name === 'scope') beta.scope = {folder:'root', root:'all', all:'folder'}[beta.scope];
  if (name === 'back' && beta.historyIndex > 0) { beta.historyIndex--; await openFolder(beta.history[beta.historyIndex], false); return; }
  if (name === 'forward' && beta.historyIndex < beta.history.length - 1) { beta.historyIndex++; await openFolder(beta.history[beta.historyIndex], false); return; }
  if (name === 'up' && current && !same(current, rootFor(current))) { await openFolder(parent(current)); return; }
  if (name === 'refresh' && current) { await loadFolder(current, 0); await refreshRoots(); return; }
  if (name === 'more' && current) { await loadFolder(current, beta.folders.get(current).data.nextOffset); return; }
  if (name === 'properties') beta.properties = !beta.properties;
  if (name.startsWith('view:')) beta.view = name.slice(5);
  if (name === 'folder-view' && current) { beta.active = {kind:'folder', path:current}; await openFolder(current); return; }
  if (name === 'file-refresh' && beta.active.kind === 'file') { await openFile(beta.active.path); return; }
  if (name.startsWith('tree-refresh:')) { await loadTree(name.slice(13)); return; }
  renderBeta();
}
document.addEventListener('click', event => {
  const target = event.target.closest('button'); if (!target || !target.closest('#beta-shell')) return;
  const run = async () => {
    if (target.dataset.window) return api.windowControl(target.dataset.window);
    if (target.id === 'panel-toggle') beta.collapsed = !beta.collapsed;
    else if (target.dataset.side) beta.side = target.dataset.side;
    else if (target.id === 'home-add' || target.hasAttribute('data-home-tab')) { beta.homeOpen = true; beta.active = {kind:'home'}; }
    else if (target.hasAttribute('data-close-home')) { beta.homeOpen = false; const path = [...beta.folders.keys()].at(-1); beta.active = path ? {kind:'folder', path} : {kind:'none'}; }
    else if (target.dataset.folder) return openFolder(target.dataset.folder);
    else if (target.dataset.file) return openFile(target.dataset.file);
    else if (target.dataset.closeFolder) return closeFolder(target.dataset.closeFolder);
    else if (target.dataset.closeFile) { beta.files.delete(target.dataset.closeFile); if (beta.active.kind === 'file' && same(beta.active.path, target.dataset.closeFile)) beta.active = {kind:'folder', path:beta.currentFolder}; }
    else if (target.dataset.removeRoot) { state.roots = await api.removeRoot(target.dataset.removeRoot); await refreshRoots(); }
    else if (target.dataset.expand) { const path = target.dataset.expand; beta.expanded.has(path) ? beta.expanded.delete(path) : beta.expanded.add(path); if (beta.expanded.has(path) && beta.rootStatus.find(item => same(item.path, path))?.available) await loadTree(path); }
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
  const row = event.target.closest('#beta-content [data-item]');
  if (row && event.key === 'Enter') { event.preventDefault(); (row.dataset.kind === 'folder' ? openFolder(row.dataset.item) : openFile(row.dataset.item)).catch(failure); }
  if (event.key === 'Escape' && beta.notice) { beta.notice = ''; renderBeta(); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'theme-select') api.setTheme(event.target.value).then(mode => { setTheme(mode); renderBeta(); }).catch(failure);
});
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
window.addEventListener('legacy-boot', () => { setTheme(state.theme); refreshRoots().catch(failure); });
window.addEventListener('legacy-page', event => document.querySelectorAll('[data-workflow]').forEach(item => item.classList.toggle('active', item.dataset.workflow === event.detail)));
window.addEventListener('roots-changed', () => refreshRoots().catch(failure));
window.addEventListener('shell-open-folder', event => openFolder(event.detail).catch(failure));
renderBeta();
if (state.booted) { setTheme(state.theme); refreshRoots().catch(failure); }
