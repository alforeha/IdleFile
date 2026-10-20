'use strict';

const api = window.folderApp;
const state = {settings: null, settingsError: null, settingsPath: null, localPath: null, localError: null, draft: null, page: 'home', editor: 'users', selected: null, structureId: '', requiredFor: null, loadingFor: null, required: [], values: {}, parent: '', preview: null, jobs: [], folder: '', folderData: null, treeOpen: new Set(), treeData: new Map()};
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const saveDraft = () => { state.draft = state.settings ? structuredClone(state.settings.data) : null; };

function message(text, type = '') {
  const node = $('#status');
  node.textContent = text;
  node.style.color = type === 'error' ? '#b13e32' : type === 'success' ? '#267748' : '#687581';
}
async function safe(work) {
  try { return await work(); }
  catch (error) { message(error.message || String(error), 'error'); return null; }
}
function setPage(page) {
  state.page = page;
  document.querySelectorAll('.page').forEach(node => node.classList.toggle('hidden', node.id !== page));
  document.querySelectorAll('.nav').forEach(node => node.classList.toggle('on', node.dataset.page === page));
  const headers = {home: ['Home', 'Create and open projects on your shared drive.'], create: ['New project', 'Preview every folder and document before creating.'], settings: ['Settings', 'Shared users, structures, and document templates.'], explorer: ['Explorer', 'Read-only view of the current folders.']};
  $('#title').textContent = headers[page][0];
  $('#subtitle').textContent = headers[page][1];
  render();
}
function render() {
  renderRail();
  if (state.page === 'home') renderHome();
  if (state.page === 'create') renderCreate();
  if (state.page === 'settings') renderSettings();
  if (state.page === 'explorer') renderExplorer();
}
function renderRail() {
  const roots = state.settings?.data.standards.roots || [];
  $('#roots').innerHTML = roots.length ? roots.map(root => treeNode(root, root.split(/[\\/]/).filter(Boolean).at(-1) || root, 0)).join('') : '<p class="muted small" style="padding:0 10px">Add roots in Settings.</p>';
  $('#roots').querySelectorAll('[data-tree-toggle]').forEach(button => button.onclick = () => toggleTree(button.dataset.treeToggle));
  $('#roots').querySelectorAll('[data-tree-open]').forEach(button => button.onclick = () => openFolder(button.dataset.treeOpen));
  $('#roots').querySelectorAll('[data-tree-refresh]').forEach(button => button.onclick = () => loadTree(button.dataset.treeRefresh, true));
  $('#roots').querySelectorAll('[data-tree-more]').forEach(button => button.onclick = () => loadTree(button.dataset.treeMore, false));
  const selected = state.settings?.data.users.find(u => u.id === state.settings.selectedUserId);
  $('#identity').textContent = selected ? `${selected.name} · ${selected.position}` : 'No user selected';
}
function treeNode(folder, name, depth) {
  const open = state.treeOpen.has(folder);
  const cached = state.treeData.get(folder);
  const indent = Math.min(depth * 12, 84);
  const children = !open ? '' : !cached ? `<div class="tree-child" style="margin-left:${indent + 22}px">Loading…</div>` : cached.error ? `<div class="tree-child" style="margin-left:${indent + 22}px">${esc(cached.error)} <button data-tree-refresh="${esc(folder)}">Retry</button></div>` : cached.entries.length ? cached.entries.map(item => item.kind === 'folder' ? treeNode(item.path, item.name, depth + 1) : `<div class="tree-row file" style="padding-left:${Math.min((depth + 1) * 12, 84)}px" title="${esc(item.path)}"><span class="tree-toggle"> </span><span class="tree-name">▤ ${esc(item.name)}</span></div>`).join('') + (cached.nextOffset !== null ? `<div class="tree-child" style="margin-left:${indent + 22}px"><button data-tree-more="${esc(folder)}">Load more (${cached.entries.length}/${cached.total})</button></div>` : '') : `<div class="tree-child" style="margin-left:${indent + 22}px">Empty folder</div>`;
  return `<div class="tree-row" style="padding-left:${indent}px" title="${esc(folder)}"><button class="tree-toggle" data-tree-toggle="${esc(folder)}" aria-expanded="${open}">${open ? '−' : '+'}</button><button class="tree-name" data-tree-open="${esc(folder)}">▰ ${esc(name)}</button><button class="tree-refresh" data-tree-refresh="${esc(folder)}" title="Refresh folder">↻</button></div>${children}`;
}
function toggleTree(folder) {
  if (state.treeOpen.has(folder)) state.treeOpen.delete(folder);
  else { state.treeOpen.add(folder); if (!state.treeData.has(folder)) loadTree(folder, true); }
  renderRail();
}
async function loadTree(folder, firstPage) {
  try {
    const previous = firstPage ? null : state.treeData.get(folder);
    const result = await api.listFolder(folder, previous?.nextOffset || 0);
    state.treeData.set(folder, {entries: [...(previous?.entries || []), ...result.entries], nextOffset: result.nextOffset, total: result.total});
    state.treeOpen.add(folder);
  } catch (error) { state.treeData.set(folder, {error: error.message}); state.treeOpen.add(folder); }
  renderRail();
}
function settingsProblems() {
  const local = state.localError ? `<div class="notice error">${esc(state.localError)}</div>` : '';
  const shared = state.settingsError
    ? `<div class="notice error">Shared settings could not be loaded. The remembered path was kept. ${esc(state.settingsError)} <button class="button secondary" id="retry-settings">Try again</button></div>`
    : '';
  return local + shared;
}
function renderHome() {
  const settings = state.settings;
  const shownPath = settings?.path || state.settingsPath;
  $('#home').innerHTML = `<div class="card"><h2>Shared settings</h2>
    <p class="muted">Choose one readable JSON file on your network drive. Each PC keeps only its selected user locally.</p>
    <div class="row"><button class="button" id="open-settings">Open existing</button><button class="button secondary" id="new-settings">Create new</button>${shownPath ? `<span class="path">${esc(shownPath)}</span>` : ''}</div>
    ${settingsProblems()}
    ${state.localPath ? `<p class="muted small">Local settings for this PC: <span class="path">${esc(state.localPath)}</span></p>` : ''}
  </div>${settings ? `<div class="card"><h2>Who are you?</h2><div class="row"><label class="field" style="max-width:320px"><span>User</span><select id="user-select"><option value="">Select a user…</option>${settings.data.users.map(u => `<option value="${esc(u.id)}" ${u.id === settings.selectedUserId ? 'selected' : ''}>${esc(u.name)} (${esc(u.initials)})</option>`).join('')}</select></label><button class="button secondary" id="select-user">Use this identity</button></div></div><div class="card"><h2>First workflow</h2><p>Define a Markdown template and a structure, then create its folders and starter documents.</p><div class="row"><button class="button" id="go-create">New project</button><button class="button secondary" id="go-settings">Edit structures and templates</button></div></div><div class="card"><h2>Creation recovery</h2><p class="muted small">Failed creations stay in a readable local JSON queue. Review the error before choosing Retry. No operation retries itself.</p><div id="jobs"></div></div>` : ''}`;
  $('#open-settings').onclick = () => safe(() => chooseSettings(api.openSettings));
  $('#new-settings').onclick = () => safe(() => chooseSettings(api.newSettings));
  if ($('#retry-settings')) $('#retry-settings').onclick = () => safe(refreshAll);
  if (!settings) {
    $('#home').insertAdjacentHTML('beforeend', '<div class="card"><h2>Creation recovery</h2><p class="muted small">Recovery records remain available even while the shared settings file is offline. Retry only after checking the target drive.</p><div id="jobs"></div></div>');
    renderJobs();
    return;
  }
  $('#select-user').onclick = () => safe(async () => { const id = $('#user-select').value; if (!id) throw new Error('Select a user.'); state.settings = await api.selectUser(id); message('Identity selected.', 'success'); render(); });
  $('#go-create').onclick = () => setPage('create');
  $('#go-settings').onclick = () => setPage('settings');
  renderJobs();
}
function renderJobs() {
  const target = $('#jobs');
  if (!target) return;
  target.innerHTML = state.jobs.length ? state.jobs.map(job => `<div class="job"><strong>${esc(job.plan.rootName)} <span class="pill">${esc(job.status)}</span></strong><div class="path">${esc(job.root)}</div><p class="small">${esc(job.completed.length)} completed steps${job.lastError ? ` · ${esc(job.lastError)}` : ''}</p>${job.status !== 'complete' ? `<button class="button secondary" data-resume="${esc(job.id)}">Retry remaining steps</button>` : ''}</div>`).join('') : '<p class="muted">No creation records yet.</p>';
  target.querySelectorAll('[data-resume]').forEach(button => button.onclick = () => safe(async () => { const job = await api.resumeProject(button.dataset.resume); state.jobs = await api.listJobs(); if (job.status === 'complete') { message('Project creation completed.', 'success'); state.folder = job.root; } else message(job.lastError, 'error'); renderJobs(); }));
}
function renderCreate() {
  const target = $('#create');
  if (!state.settings) { target.innerHTML = '<div class="notice">Choose shared settings on Home first.</div>'; return; }
  const structures = state.settings.data.standards.structures;
  if (!structures.some(s => s.id === state.structureId)) { state.structureId = structures[0]?.id || ''; invalidateRequired(); }
  if (state.structureId && state.requiredFor !== state.structureId && state.loadingFor !== state.structureId) {
    state.loadingFor = state.structureId;
    safe(async () => { try { await loadRequired(); if (state.page === 'create') renderCreate(); } finally { state.loadingFor = null; } });
  }
  target.innerHTML = `<div class="card"><h2>Project source</h2><div class="stack"><label class="field"><span>Structure</span><select id="create-structure">${structures.map(s => `<option value="${esc(s.id)}" ${s.id === state.structureId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label><div class="row"><label class="field"><span>Parent folder on shared drive</span><input id="create-parent" value="${esc(state.parent)}" placeholder="\\\\server\\share\\Projects or P:\\Projects"></label><button class="button secondary" id="browse-parent">Browse…</button></div><p class="muted small">The parent must be inside a saved Explorer root so you can reopen the project after restarting.</p></div>${!structures.length ? '<div class="notice">Create a document template and structure in Settings first.</div>' : ''}</div><div class="card"><h2>Project values</h2><p class="muted small">Fill every field used by the folder name, document filenames, or Markdown content.</p><div id="values" class="grid"></div></div><div class="card"><div class="row between"><h2>Preview</h2><button class="button secondary" id="preview-button" ${structures.length ? '' : 'disabled'}>Build preview</button></div><div id="preview-result"></div></div>`;
  $('#create-structure').onchange = event => safe(async () => { state.structureId = event.target.value; state.values = {}; state.preview = null; invalidateRequired(); await loadRequired(); renderCreate(); });
  $('#create-parent').oninput = event => { state.parent = event.target.value; state.preview = null; renderPreview(); };
  $('#browse-parent').onclick = () => safe(async () => { const folder = await api.chooseFolder(); if (folder) { state.parent = folder; state.preview = null; renderCreate(); } });
  $('#preview-button').onclick = () => safe(async () => {
    if (!state.settings.selectedUserId) throw new Error('Select your user on Home first.');
    state.preview = await api.previewProject({parent: state.parent, structureId: state.structureId, values: state.values});
    message('Preview ready. Check the paths before creating.', 'success'); renderPreview();
  });
  renderValues(); renderPreview();
}
async function loadRequired() {
  const id = state.structureId;
  if (!id) { invalidateRequired(); return; }
  const fields = await api.requiredValues(id);
  if (state.structureId === id) { state.required = fields; state.requiredFor = id; }
}
function invalidateRequired() { state.requiredFor = null; state.loadingFor = null; state.required = []; }
function renderValues() {
  const node = $('#values');
  node.innerHTML = (state.required || []).map(key => `<label class="field"><span>{${esc(key)}}</span><input data-value="${esc(key)}" value="${esc(state.values[key] || '')}" autocomplete="off"></label>`).join('') || '<p class="muted">This structure has no fields to fill.</p>';
  node.querySelectorAll('[data-value]').forEach(input => input.oninput = () => { state.values[input.dataset.value] = input.value; state.preview = null; renderPreview(); });
}
function renderPreview() {
  const node = $('#preview-result'); if (!node) return;
  if (!state.preview) { node.innerHTML = '<p class="muted">A preview checks generated paths and whether the project folder already exists.</p>'; return; }
  const plan = state.preview.plan;
  node.innerHTML = `<p><strong>Project folder</strong><br><span class="path">${esc(state.preview.root)}</span></p><div class="preview">${esc([plan.rootName + '/', ...plan.folders.map(p => `  ▰ ${p}/`), ...plan.files.map(f => `  ${f.primary ? '★' : '•'} ${f.path}${f.log ? ' (log)' : ''}`)].join('\n'))}</div><p class="small muted">★ Primary project Markdown. Supporting links are relative to it.</p><button class="button" id="create-button">Create project</button>`;
  $('#create-button').onclick = () => safe(async () => {
    const job = await api.createProject({parent: state.parent, structureId: state.structureId, values: state.values, fingerprint: state.preview.fingerprint});
    state.jobs = await api.listJobs(); state.preview = null;
    if (job.status === 'complete') { message('Project created.', 'success'); await openFolder(job.root); }
    else { message(job.lastError, 'error'); setPage('home'); }
  });
}

function renderSettings() {
  const target = $('#settings');
  if (!state.draft) { target.innerHTML = '<div class="notice">Choose shared settings on Home first.</div>'; return; }
  target.innerHTML = `<div class="card"><div class="row between"><div><h2>Shared file</h2><span class="path">${esc(state.settings.path)}</span></div><div class="row"><button class="button secondary" id="discard">Discard edits / reload</button><button class="button" id="save-settings">Save all changes</button></div></div><p class="muted small">Settings save together. If another PC changed the file, reload and reapply your edits.</p></div><div class="row" id="settings-tabs"><button class="button ${state.editor === 'users' ? '' : 'secondary'}" data-editor="users">Users</button><button class="button ${state.editor === 'templates' ? '' : 'secondary'}" data-editor="templates">Doc templates</button><button class="button ${state.editor === 'structures' ? '' : 'secondary'}" data-editor="structures">Structures</button><button class="button ${state.editor === 'roots' ? '' : 'secondary'}" data-editor="roots">Explorer roots</button></div><div id="settings-body" style="margin-top:17px"></div>`;
  $('#settings-tabs').querySelectorAll('[data-editor]').forEach(button => button.onclick = () => { state.editor = button.dataset.editor; state.selected = null; renderSettings(); });
  $('#discard').onclick = () => safe(async () => { state.settings = await api.reloadSettings(); saveDraft(); state.preview = null; invalidateRequired(); renderSettings(); message('Settings reloaded.'); });
  $('#save-settings').onclick = () => safe(async () => { state.settings = await api.saveSettings({data: state.draft, revision: state.settings.revision}); saveDraft(); state.preview = null; invalidateRequired(); message('Shared settings saved.', 'success'); render(); });
  if (state.editor === 'users') renderUsers();
  if (state.editor === 'templates') renderTemplates();
  if (state.editor === 'structures') renderStructures();
  if (state.editor === 'roots') renderRootsSettings();
}
function entityList(items, selectedId) {
  return `<div class="list">${items.map(item => `<button data-select="${esc(item.id)}" class="${item.id === selectedId ? 'selected' : ''}"><strong>${esc(item.name)}</strong><small>${esc(item.id)}</small></button>`).join('')}</div>`;
}
function renderUsers() {
  const users = state.draft.users;
  if (!users.some(u => u.id === state.selected)) state.selected = users[0]?.id;
  const selected = users.find(u => u.id === state.selected);
  $('#settings-body').innerHTML = `<div class="two"><div><div class="row between" style="margin-bottom:9px"><strong>Users</strong><button class="text-button" id="add-user">＋ Add</button></div>${entityList(users, state.selected)}</div><div class="card">${selected ? `<h2>Edit user</h2><div class="stack"><label class="field"><span>Name</span><input data-field="name" value="${esc(selected.name)}"></label><label class="field"><span>Initials</span><input data-field="initials" value="${esc(selected.initials)}"></label><label class="field"><span>Position</span><input data-field="position" value="${esc(selected.position)}"></label></div><hr class="divider"><button class="button danger" id="delete-user">Remove user</button>` : 'Add a user.'}</div></div>`;
  bindSelections(renderUsers);
  $('#add-user').onclick = () => { const user = {id: uid(), name: 'New user', initials: 'NU', position: 'Member'}; users.push(user); state.draft.perUser[user.id] = {pins: [], recentPins: []}; state.selected = user.id; renderUsers(); };
  if (selected) {
    bindFields(selected);
    $('#delete-user').onclick = () => { if (!confirm(`Remove ${selected.name} from shared settings?`)) return; state.draft.users = users.filter(u => u.id !== selected.id); delete state.draft.perUser[selected.id]; state.selected = state.draft.users[0]?.id; renderUsers(); };
  }
}
function bindSelections(renderFn) { $('#settings-body').querySelectorAll('[data-select]').forEach(button => button.onclick = () => { state.selected = button.dataset.select; renderFn(); }); }
function bindFields(item) { $('#settings-body').querySelectorAll('[data-field]').forEach(input => input.oninput = () => { item[input.dataset.field] = input.value; }); }
function renderTemplates() {
  const templates = state.draft.standards.docTemplates;
  if (!templates.some(t => t.id === state.selected)) state.selected = templates[0]?.id;
  const selected = templates.find(t => t.id === state.selected);
  $('#settings-body').innerHTML = `<div class="two"><div><div class="row between" style="margin-bottom:9px"><strong>Markdown templates</strong><button class="text-button" id="add-template">＋ Add</button></div>${entityList(templates, state.selected)}</div><div class="card">${selected ? `<h2>Edit document template</h2><div class="stack"><label class="field"><span>Name</span><input data-field="name" value="${esc(selected.name)}"></label><label class="field"><span>Filename rule</span><input data-field="fileNamePattern" value="${esc(selected.fileNamePattern)}" placeholder="project-info.md or {JOB}_notes.md"></label><label class="field"><span>Markdown content</span><textarea data-field="content" style="min-height:290px">${esc(selected.content)}</textarea></label></div><p class="muted small">Use {TAGS} for values, {PROJECT_LINKS} for supporting Markdown links, and {LOG_PATH} for the log link. If {PROJECT_LINKS} is absent, links are appended to the primary document.</p><hr class="divider"><button class="button danger" id="delete-template">Remove template</button>` : 'Add a template.'}</div></div>`;
  bindSelections(renderTemplates);
  $('#add-template').onclick = () => { const t = {id: uid(), name: 'New Markdown template', fileNamePattern: 'project-info.md', content: '# {PROJECT}\n\n{PROJECT_LINKS}\n'}; templates.push(t); state.selected = t.id; renderTemplates(); };
  if (selected) { bindFields(selected); $('#delete-template').onclick = () => { if (!confirm(`Remove ${selected.name}?`)) return; state.draft.standards.docTemplates = templates.filter(t => t.id !== selected.id); state.selected = state.draft.standards.docTemplates[0]?.id; renderTemplates(); }; }
}
function templateOptions(selectedId) { return state.draft.standards.docTemplates.map(t => `<option value="${esc(t.id)}" ${t.id === selectedId ? 'selected' : ''}>${esc(t.name)} · ${esc(t.fileNamePattern)}</option>`).join(''); }
function renderStructures() {
  const structures = state.draft.standards.structures;
  if (!structures.some(s => s.id === state.selected)) state.selected = structures[0]?.id;
  const selected = structures.find(s => s.id === state.selected);
  $('#settings-body').innerHTML = `<div class="two"><div><div class="row between" style="margin-bottom:9px"><strong>Folder structures</strong><button class="text-button" id="add-structure">＋ Add</button></div>${entityList(structures, state.selected)}</div><div class="card">${selected ? `<h2>Edit structure</h2><div class="stack"><label class="field"><span>Name</span><input data-field="name" value="${esc(selected.name)}"></label><label class="field"><span>Project folder name rule</span><input data-field="rootName" value="${esc(selected.rootName)}" placeholder="{PROJECT}"></label><label class="field"><span>Folders, one project-relative path per line</span><textarea id="structure-folders">${esc(selected.folders.join('\n'))}</textarea></label><label class="field"><span>Primary Markdown template</span><select id="primary-template">${templateOptions(selected.primary.templateId)}</select></label><label class="field"><span>Primary file folder (blank means project root)</span><input id="primary-folder" value="${esc(selected.primary.folder || '')}" placeholder="blank for project root"></label><label class="field"><span>Separate log path relative to project</span><input data-field="logPath" value="${esc(selected.logPath)}" placeholder="Notes/project-log.md"></label></div><h3>Supporting Markdown documents</h3><div id="document-rows">${selected.documents.map((doc, index) => `<div class="doc-row"><label class="field"><span>Template</span><select data-document-template="${index}">${templateOptions(doc.templateId)}</select></label><label class="field"><span>Folder (blank for root)</span><input data-document-folder="${index}" value="${esc(doc.folder || '')}"></label><button class="button secondary" data-remove-document="${index}">Remove</button></div>`).join('')}</div><button class="button secondary" id="add-document">＋ Add supporting document</button><hr class="divider"><button class="button danger" id="delete-structure">Remove structure</button>` : '<p>Add a document template first, then add a structure.</p>'}</div></div>`;
  bindSelections(renderStructures);
  $('#add-structure').onclick = () => { const first = state.draft.standards.docTemplates[0]; if (!first) { message('Create a document template first.', 'error'); return; } const s = {id: uid(), name: 'New structure', color: '#e8892b', rootName: '{PROJECT}', folders: [], primary: {templateId: first.id, folder: ''}, documents: [], logPath: 'project-log.md'}; structures.push(s); state.selected = s.id; renderStructures(); };
  if (!selected) return;
  bindFields(selected);
  $('#structure-folders').oninput = event => { selected.folders = event.target.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean); };
  $('#primary-template').onchange = event => { selected.primary.templateId = event.target.value; };
  $('#primary-folder').oninput = event => { selected.primary.folder = event.target.value.trim(); };
  $('#add-document').onclick = () => { selected.documents.push({templateId: state.draft.standards.docTemplates[0].id, folder: ''}); renderStructures(); };
  $('#document-rows').querySelectorAll('[data-document-template]').forEach(select => select.onchange = () => { selected.documents[Number(select.dataset.documentTemplate)].templateId = select.value; });
  $('#document-rows').querySelectorAll('[data-document-folder]').forEach(input => input.oninput = () => { selected.documents[Number(input.dataset.documentFolder)].folder = input.value.trim(); });
  $('#document-rows').querySelectorAll('[data-remove-document]').forEach(button => button.onclick = () => { selected.documents.splice(Number(button.dataset.removeDocument), 1); renderStructures(); });
  $('#delete-structure').onclick = () => { if (!confirm(`Remove ${selected.name}?`)) return; state.draft.standards.structures = structures.filter(s => s.id !== selected.id); state.selected = state.draft.standards.structures[0]?.id; renderStructures(); };
}
function renderRootsSettings() {
  $('#settings-body').innerHTML = `<div class="card"><h2>Explorer roots</h2><p class="muted">Use shared drive folders as roots. The explorer lists their actual contents when you open them.</p><div id="root-items">${state.draft.standards.roots.map((root, index) => `<div class="row" style="margin:7px 0"><span class="path" style="flex:1">${esc(root)}</span><button class="button secondary" data-remove-root="${index}">Remove</button></div>`).join('')}</div><button class="button secondary" id="add-root">＋ Add folder</button></div>`;
  $('#add-root').onclick = () => safe(async () => { const folder = await api.chooseFolder(); if (folder && !state.draft.standards.roots.includes(folder)) { state.draft.standards.roots.push(folder); renderRootsSettings(); } });
  $('#root-items').querySelectorAll('[data-remove-root]').forEach(button => button.onclick = () => { state.draft.standards.roots.splice(Number(button.dataset.removeRoot), 1); renderRootsSettings(); });
}
async function openFolder(folder) {
  state.folder = folder; state.folderData = null; setPage('explorer');
}
function renderExplorer() {
  const target = $('#explorer');
  if (!state.folder) { target.innerHTML = '<div class="card">Choose a root in the sidebar.</div>'; return; }
  target.innerHTML = `<div class="card"><div class="row between"><div><h2>Folder</h2><div class="path">${esc(state.folder)}</div></div><div class="row"><button class="button secondary" id="up-folder">↑ Up</button><button class="button secondary" id="refresh-folder">Refresh</button></div></div><div id="folder-items" style="margin-top:15px">Loading…</div></div>`;
  $('#up-folder').onclick = () => { let parent = state.folder.replace(/[\\/][^\\/]+[\\/]?$/, ''); if (/^[A-Za-z]:$/.test(parent)) parent += '\\'; if (parent && parent !== state.folder) openFolder(parent); };
  $('#refresh-folder').onclick = () => loadFolder(0);
  loadFolder(0);
}
async function loadFolder(offset = 0) {
  const requested = state.folder;
  try {
    const result = await api.listFolder(requested, offset);
    if (state.folder !== requested || state.page !== 'explorer') return;
    state.folderData = {entries: [...(offset ? state.folderData?.entries || [] : []), ...result.entries], nextOffset: result.nextOffset, total: result.total};
    const node = $('#folder-items');
    node.innerHTML = `${state.folderData.entries.length ? state.folderData.entries.map(item => `<button class="entry" data-path="${esc(item.path)}" data-kind="${esc(item.kind)}"><span class="kind">${item.kind === 'folder' ? '▰' : item.kind === 'link' ? '↗' : '▤'}</span><span>${esc(item.name)}</span><span class="pill">${esc(item.kind)}</span></button>`).join('') : '<p class="muted">This folder is empty.</p>'}${state.folderData.nextOffset !== null ? `<div class="row" style="margin-top:14px"><span class="muted small">Showing ${state.folderData.entries.length} of ${state.folderData.total}</span><button class="button secondary" id="more-folder">Load more</button></div>` : ''}`;
    node.querySelectorAll('[data-kind="folder"]').forEach(button => button.onclick = () => openFolder(button.dataset.path));
    if (state.folderData.nextOffset !== null) $('#more-folder').onclick = () => loadFolder(state.folderData.nextOffset);
  } catch (error) { if (state.folder === requested) $('#folder-items').innerHTML = `<div class="notice error">${esc(error.message)}</div>`; }
}
function applyBoot(boot) {
  state.settings = boot.settings;
  state.settingsError = boot.settingsError || null;
  state.settingsPath = boot.settingsPath || null;
  state.localPath = boot.localPath || null;
  state.localError = boot.localError || null;
  state.jobs = boot.jobs;
  saveDraft();
}
function bootMessage(boot, fallback) {
  if (boot.localError) message('Local settings could not be loaded. See Home.', 'error');
  else if (boot.settingsError) message('Shared settings could not be loaded. See Home.', 'error');
  else if (fallback) message(fallback);
}
function resetBrowsing() {
  state.treeOpen.clear();
  state.treeData.clear();
  state.folder = '';
}
async function chooseSettings(choose) {
  state.settings = await choose();
  state.settingsError = null;
  state.settingsPath = state.settings?.path || state.settingsPath;
  saveDraft();
  state.jobs = await api.listJobs();
  resetBrowsing();
  state.parent = state.settings?.data.standards.roots[0] || '';
  invalidateRequired();
  render();
}
// Re-reads both settings files; a deleted local file is recreated with defaults by the main process.
async function refreshAll() {
  const boot = await api.bootstrap();
  applyBoot(boot);
  state.preview = null;
  invalidateRequired();
  state.treeData.clear();
  state.treeOpen.clear();
  bootMessage(boot, 'Refreshed. Expand a folder to load it again.');
  render();
}
document.querySelectorAll('.nav').forEach(button => button.onclick = () => setPage(button.dataset.page));
$('#refresh').onclick = () => safe(refreshAll);
safe(async () => {
  const boot = await api.bootstrap();
  applyBoot(boot);
  state.parent = boot.settings?.data.standards.roots[0] || '';
  await loadRequired();
  render();
  bootMessage(boot);
});
