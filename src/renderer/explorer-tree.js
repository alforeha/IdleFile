'use strict';

function renderExplorerSidebar() {
  return `<div class="side-heading">Explorer <span>${ib('folder', 'Go to folder', 'go-folder')}${ib('plus', 'Add local root', 'add-root')}</span></div>${beta.rootStatus.length ? beta.rootStatus.map(status => renderExplorerNode({path: status.path, name: rootLabel(status.path), kind: 'folder', status: status.available ? status.status : 'unavailable', error: status.error}, 0, true)).join('') : '<div class="empty-side">Go to any accessible folder or add a saved root.</div>'}`;
}

function renderExplorerNode(item, depth, savedRoot = false) {
  const folder = item.kind === 'folder';
  const opened = beta.expanded.has(item.path);
  const page = beta.tree.get(item.path);
  const status = page?.loading ? 'loading' : page?.error ? 'unavailable' : page ? page.entries?.length ? null : 'empty' : item.status;
  const statusIcon = status === 'unavailable' ? icon('alert', 13) : status === 'loading' ? icon('refresh', 13) : status === 'empty' ? icon('empty', 13) : '';
  const row = `<div class="tree-row-beta ${same(beta.active.path, item.path) ? 'active' : ''}" style="--tree-depth:${depth}" data-menu-path="${be(item.path)}" data-menu-kind="${folder ? 'folder' : 'file'}">
    ${folder ? `<button class="tree-chevron" data-expand="${be(item.path)}" aria-expanded="${opened}" aria-label="${opened ? 'Collapse' : 'Expand'} ${be(item.name)}" title="${opened ? 'Collapse' : 'Expand'}">${icon(opened ? 'chevron_down' : 'chevron_right', 14)}</button>` : '<span class="tree-spacer"></span>'}
    <button class="tree-name-beta" data-open-item="${be(item.path)}" data-kind="${folder ? 'folder' : 'file'}" title="${be(item.path)}">${statusIcon}${icon(folder ? 'folder' : 'file', 15)}<span>${be(item.name)}</span></button>
    ${savedRoot ? `<button class="root-remove" data-remove-root="${be(item.path)}" aria-label="Remove root" title="Remove local root">${icon('close', 12)}</button>` : ''}</div>`;
  if (!folder || !opened) return row;
  const children = page?.loading && !page.entries?.length ? '<div class="tree-message">Loading…</div>' : page?.error ? `<div class="tree-message">${be(page.error)}</div>` : page?.entries?.length ? page.entries.map(child => renderExplorerNode(child, depth + 1)).join('') : page ? '<div class="tree-message">Empty folder</div>' : '<div class="tree-message">Loading…</div>';
  const more = page?.nextOffset != null ? `<button class="tree-more" data-tree-more="${be(item.path)}">Load more (${page.entries.length}/${page.total})</button>` : '';
  return row + children + more;
}

async function loadExplorerBranch(folder, more = false, quiet = false) {
  const existing = beta.tree.get(folder);
  if (existing?.loading || existing?.refreshing) { existing.dirty = true; return; }
  const previous = more ? existing : null;
  const before = JSON.stringify([existing?.entries, existing?.nextOffset, existing?.total, existing?.error]);
  const request = {...(existing || {}), loading: !quiet, refreshing: quiet, error: quiet ? existing?.error : null};
  beta.tree.set(folder, request);
  if (!quiet) renderSidebar();
  try {
    const targetCount = more ? (previous?.entries.length || 0) + 500 : quiet ? Math.max(500, existing?.entries.length || 0) : 500;
    let offset = more ? previous?.nextOffset || 0 : 0;
    const entries = [...(previous?.entries || [])];
    let page;
    do {
      page = await api.listFolder(folder, offset, 'tree');
      entries.push(...page.entries);
      offset = page.nextOffset;
    } while (offset != null && entries.length < targetCount);
    beta.tree.set(folder, {entries, nextOffset: offset, total: page.total});
    retryResult(`tree:${folder}`, true);
  } catch (error) { beta.tree.set(folder, {entries: existing?.entries || [], error: error.message, nextOffset: existing?.nextOffset ?? null}); retryResult(`tree:${folder}`, false); }
  const dirty = request.dirty;
  const current = beta.tree.get(folder);
  const after = JSON.stringify([current?.entries, current?.nextOffset, current?.total, current?.error]);
  if (!quiet || after !== before) renderSidebar();
  if (dirty) loadExplorerBranch(folder, false, true).catch(failure);
}
