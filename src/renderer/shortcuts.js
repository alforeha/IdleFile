'use strict';

const suggestedGroups = new Set();

async function refreshSuggestions() {
  const items = state.settings?.data.suggestedLocations || [];
  beta.suggestedStatus = api.locationStatus ? await api.locationStatus(items.map(item => ({path: item.path, type: item.type, id: item.id}))) : [];
}

function shortcutStatus(path, list) { return list.find(item => same(item.path, path)); }
function statusGlyph(status) { return status && !status.available ? `<span class="shortcut-warning" title="${be(status.error || 'Unavailable')}">${icon('alert', 13)}</span>` : status?.status === 'empty' ? `<span title="Empty folder">${icon('empty', 13)}</span>` : ''; }

function renderPin(pin, depth = 0) {
  const children = beta.pins.filter(candidate => !same(candidate, pin) && same(closestPinnedAncestor(candidate), pin));
  return `<div class="shortcut-row ${same(beta.active.path, pin) ? 'active' : ''}" style="--tree-depth:${depth}" data-menu-path="${be(pin)}" data-menu-kind="folder"><button data-folder="${be(pin)}" title="${be(pin)}">${statusGlyph(shortcutStatus(pin, beta.pinStatus))}${icon('folder', 15)}<span>${be(label(pin))}</span></button></div>${children.map(child => renderPin(child, depth + 1)).join('')}`;
}
function closestPinnedAncestor(pin) { return beta.pins.filter(candidate => !same(candidate, pin) && inside(pin, candidate)).sort((a, b) => b.length - a.length)[0]; }

function suggestionNodes() {
  if (!beta.suggestionsExpanded) return (state.settings?.data.suggestedLocations || []).map(item => renderSuggestionNode({path: item.path, item}, [], 0)).join('');
  const nodes = new Map();
  for (const item of state.settings?.data.suggestedLocations || []) {
    nodes.set(item.path.toLowerCase(), {path: item.path, item});
    if (!beta.suggestionsExpanded) continue;
    for (let cursor = parent(item.path); cursor && !same(cursor, parent(cursor)); cursor = parent(cursor)) {
      const key = cursor.toLowerCase();
      if (!nodes.has(key)) nodes.set(key, {path: cursor, connector: true});
    }
  }
  const values = [...nodes.values()];
  return values.filter(node => !values.some(other => !same(node.path, other.path) && inside(node.path, other.path))).sort((a,b) => a.path.localeCompare(b.path)).map(node => renderSuggestionNode(node, values, 0)).join('');
}
function renderSuggestionNode(node, nodes, depth) {
  const children = nodes.filter(other => !same(other.path, node.path) && same(parent(other.path), node.path));
  const group = node.connector;
  const expanded = suggestedGroups.has(node.path);
  const status = node.item && shortcutStatus(node.path, beta.suggestedStatus);
  const kind = node.item?.type || 'folder';
  const name = node.item?.label || label(node.path);
  const row = `<div class="shortcut-row ${group ? 'connector' : ''} ${same(beta.active.path, node.path) ? 'active' : ''}" style="--tree-depth:${depth}" ${group ? '' : `data-menu-path="${be(node.path)}" data-menu-kind="${kind}" data-suggested="true"`}>
    ${group ? `<button data-group-toggle="${be(node.path)}" aria-expanded="${expanded}" title="Expand group">${icon(expanded ? 'chevron_down' : 'chevron_right', 13)}${icon('folder', 15)}<span>${be(name)}</span></button>` : `<button data-open-item="${be(node.path)}" data-kind="${kind}" title="${be(node.path)}">${statusGlyph(status)}${icon(kind === 'folder' ? 'folder' : 'file', 15)}<span>${be(name)}</span></button>`}</div>`;
  return row + (group && !expanded ? '' : children.map(child => renderSuggestionNode(child, nodes, depth + 1)).join(''));
}

function renderShortcutSidebar() {
  if (beta.side === 'pinned') {
    const top = beta.pins.filter(pin => !closestPinnedAncestor(pin));
    return `<div class="side-heading">Pinned ${ib('plus', 'Add pin', 'add-pin')}</div>${top.length ? top.map(pin => renderPin(pin)).join('') : '<div class="empty-side">No pinned folders yet.</div>'}`;
  }
  const items = state.settings?.data.suggestedLocations || [];
  return `<div class="side-heading">Suggested</div><div class="shortcut-switch"><button data-action="suggested-list" class="${beta.suggestionsExpanded ? '' : 'active'}">List</button><button data-action="suggested-groups" class="${beta.suggestionsExpanded ? 'active' : ''}">Expand groups</button></div>${items.length ? suggestionNodes() : '<div class="empty-side">No shared suggestions yet. Add them in Shared settings.</div>'}`;
}

function askPath(title, initial = '') {
  return new Promise(resolve => {
    const dialog = document.querySelector('#path-dialog');
    const input = dialog.querySelector('input');
    dialog.querySelector('h2').textContent = title;
    input.value = initial;
    const finish = value => { if (dialog.open) dialog.close(); dialog.oncancel = null; dialog.querySelector('form').onsubmit = null; dialog.querySelector('[data-cancel]').onclick = null; resolve(value); };
    dialog.oncancel = event => { event.preventDefault(); finish(null); };
    dialog.querySelector('form').onsubmit = event => { event.preventDefault(); finish(input.value.trim()); };
    dialog.querySelector('[data-cancel]').onclick = () => finish(null);
    dialog.querySelector('[data-browse]').onclick = async () => { const chosen = await api.chooseFolder(); if (chosen) input.value = chosen; };
    dialog.showModal(); input.focus();
  });
}

async function addPinDialog() {
  const path = await askPath('Add pin');
  if (!path) return;
  state.pins = await api.addPin(path);
  beta.side = 'pinned';
  await refreshRoots();
}
async function togglePin(path) {
  const pinned = beta.pins.some(pin => same(pin, path));
  state.pins = pinned ? await api.removePin(path) : await api.addPin(path);
  await refreshRoots();
}

function closeItemMenu() { document.querySelector('.item-menu')?.remove(); }
function showItemMenu(event, path, kind, suggested = false) {
  closeItemMenu();
  const folder = kind === 'folder';
  const pinned = beta.pins.some(pin => same(pin, path));
  const actions = [{label: 'Open', run: () => folder ? openFolder(path) : openFile(path)}];
  if (folder) {
    actions.push({label: pinned ? 'Unpin from my shortcuts' : suggested ? 'Pin to my shortcuts' : 'Pin folder', run: () => togglePin(path)});
    actions.push({label: 'Refresh', run: async () => {
      const jobs = [];
      if (beta.expanded.has(path)) jobs.push(loadExplorerBranch(path, false, true));
      if (beta.folders.has(path)) jobs.push(loadFolder(path, 0, true));
      jobs.push(refreshRoots());
      await Promise.all(jobs);
    }});
  }
  const menu = document.createElement('div');
  menu.className = 'item-menu'; menu.setAttribute('role', 'menu');
  menu.style.left = `${Math.min(event.clientX, innerWidth - 190)}px`;
  menu.style.top = `${Math.min(event.clientY, innerHeight - actions.length * 38 - 12)}px`;
  for (const action of actions) {
    const button = document.createElement('button');
    button.textContent = action.label; button.setAttribute('role', 'menuitem');
    button.onclick = () => { closeItemMenu(); Promise.resolve(action.run()).catch(failure); };
    menu.append(button);
  }
  document.body.append(menu);
  menu.querySelector('button')?.focus();
}
document.addEventListener('contextmenu', event => {
  const item = event.target.closest('[data-menu-path], #beta-content [data-item], #beta-content .breadcrumbs');
  if (!item) return;
  const path = item.dataset.menuPath || item.dataset.item || beta.currentFolder;
  const kind = item.dataset.menuKind || item.dataset.kind || 'folder';
  if (!path) return;
  event.preventDefault();
  if (item.dataset.item) { beta.selected = path; item.classList.add('active'); updateSelectedArea(); const trigger = document.querySelector('.properties-trigger'); if (trigger) trigger.hidden = false; }
  showItemMenu(event, path, kind, item.dataset.suggested === 'true');
});
document.addEventListener('click', event => { if (!event.target.closest('.item-menu')) closeItemMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeItemMenu(); });
