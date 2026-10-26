'use strict';

function renderNewSettings() {
  const target = document.querySelector('#settings');
  const shared = state.settingsArea === 'shared';
  target.innerHTML = `<div class="settings-area-tabs"><button data-settings-area="pc" class="button ${shared ? 'secondary' : ''}">This PC</button><button data-settings-area="shared" class="button ${shared ? '' : 'secondary'}">Shared settings</button></div>${shared ? `<div class="card"><div class="row between"><div><h2>Shared file</h2><span class="path">${esc(state.settings?.path || state.settingsPath || 'No file selected')}</span></div>${state.draft ? '<div class="row"><button class="button secondary" id="discard">Discard edits / reload</button><button class="button" id="save-settings">Save all changes</button></div>' : ''}</div></div>${state.draft ? `<div class="row" id="settings-tabs">${[['suggested','Suggested'],['users','Users'],['templates','Doc templates'],['structures','Structures']].map(([key,name]) => `<button class="button ${state.editor === key ? '' : 'secondary'}" data-editor="${key}">${name}</button>`).join('')}</div>` : '<div class="notice">Choose shared settings on Home first.</div>'}` : ''}<div id="settings-body"></div>`;
  target.querySelectorAll('[data-settings-area]').forEach(button => button.onclick = () => { state.settingsArea = button.dataset.settingsArea; renderSettings(); });
  if (!shared) { renderPcSettings(); return; }
  if (!state.draft) return;
  target.querySelectorAll('[data-editor]').forEach(button => button.onclick = () => { state.editor = button.dataset.editor; state.selected = null; renderSettings(); });
  target.querySelector('#discard').onclick = () => safe(async () => { state.settings = await api.reloadSettings(); saveDraft(); state.preview = null; invalidateRequired(); renderSettings(); message('Settings reloaded.'); });
  target.querySelector('#save-settings').onclick = () => safe(async () => { state.settings = await api.saveSettings({data: state.draft, revision: state.settings.revision}); saveDraft(); state.preview = null; invalidateRequired(); await refreshSuggestions(); message('Shared settings saved.', 'success'); render(); window.dispatchEvent(new Event('suggestions-changed')); });
  if (state.editor === 'suggested') renderSuggestedSettings();
  if (state.editor === 'users') renderUsers();
  if (state.editor === 'templates') renderTemplates();
  if (state.editor === 'structures') renderStructures();
}

function renderPcSettings() {
  const target = document.querySelector('#settings-body');
  target.innerHTML = `<div class="card"><h2>Explorer roots</h2><p class="muted">Saved starting folders on this PC.</p><div id="pc-roots">${state.roots.map((root, index) => `<div class="row location-line"><span class="path">${esc(root)}</span><button class="button secondary" data-remove-root="${index}">Remove</button></div>`).join('')}</div><button class="button secondary" id="add-root">Add folder</button></div>
    <div class="card"><h2>Pinned folders</h2><div id="pc-pins">${state.pins.map((pin, index) => `<div class="row location-line"><span class="path">${esc(pin)}</span><button class="button secondary" data-remove-pin="${index}">Unpin</button></div>`).join('') || '<p class="muted">No pins yet.</p>'}</div><button class="button secondary" id="add-pin-settings">Add pin</button></div>
    <div class="card"><h2>Appearance</h2><label class="field"><span>Theme</span><select id="pc-theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div>`;
  target.querySelector('#pc-theme').value = state.theme;
  target.querySelector('#pc-theme').onchange = async event => { try { state.theme = await api.setTheme(event.target.value); setTheme(state.theme); } catch (error) { message(error.message, 'error'); } };
  target.querySelector('#add-root').onclick = () => safe(async () => { state.roots = await api.addRoot(); renderPcSettings(); window.dispatchEvent(new Event('roots-changed')); });
  target.querySelector('#add-pin-settings').onclick = () => safe(async () => { await addPinDialog(); renderPcSettings(); });
  target.querySelectorAll('[data-remove-root]').forEach(button => button.onclick = () => safe(async () => { state.roots = await api.removeRoot(state.roots[Number(button.dataset.removeRoot)]); renderPcSettings(); window.dispatchEvent(new Event('roots-changed')); }));
  target.querySelectorAll('[data-remove-pin]').forEach(button => button.onclick = () => safe(async () => { state.pins = await api.removePin(state.pins[Number(button.dataset.removePin)]); renderPcSettings(); window.dispatchEvent(new Event('roots-changed')); }));
}

function renderSuggestedSettings() {
  const target = document.querySelector('#settings-body');
  const items = state.draft.suggestedLocations ||= [];
  const edit = items.find(item => item.id === state.suggestedEdit);
  const form = state.suggestedEdit ? `<dialog class="location-dialog"><div class="card"><h2>${edit ? 'Edit' : 'Add'} suggestion</h2><div class="stack"><label class="field"><span>Label</span><input id="suggest-label" value="${esc(edit?.label || '')}" required></label><label class="field"><span>Type</span><select id="suggest-type"><option value="folder">Folder</option><option value="file">File</option></select></label><label class="field"><span>Full path</span><input id="suggest-path" value="${esc(edit?.path || '')}" placeholder="C:\\Folder or \\\\server\\share\\Folder" required></label></div><div class="row"><button class="button" id="suggest-apply">Apply to draft</button><button class="button secondary" id="suggest-cancel">Cancel</button></div></div></dialog>` : '';
  target.innerHTML = `<div class="card"><div class="row between"><h2>Suggested locations</h2><button class="button secondary" id="suggest-add">Add</button></div><p class="muted small">Shared with users of this settings file. Save all changes above to publish edits.</p>${items.length ? items.map(item => { const status = beta.suggestedStatus.find(s => s.id === item.id); return `<div class="suggestion-line"><div><strong>${esc(item.label)}</strong><span class="pill">${esc(item.type)}</span><div class="path">${esc(item.path)}</div><small class="muted" data-status-id="${esc(item.id)}">${status ? status.available ? 'Available' : 'Unavailable' : 'Checking…'}</small></div><div class="row"><button class="button secondary" data-edit-suggest="${esc(item.id)}">Edit</button><button class="button danger" data-remove-suggest="${esc(item.id)}">Remove</button></div></div>`; }).join('') : '<p class="muted">No suggestions yet.</p>'}</div>${form}`;
  if (api.locationStatus && items.length) api.locationStatus(items.map(item => ({id: item.id, path: item.path, type: item.type}))).then(statuses => {
    for (const status of statuses) {
      const node = [...target.querySelectorAll('[data-status-id]')].find(element => element.dataset.statusId === status.id);
      if (node) { node.textContent = status.available ? 'Available' : 'Unavailable'; node.title = status.error || ''; }
    }
  }).catch(error => message(error.message, 'error'));
  target.querySelector('#suggest-add').onclick = () => { state.suggestedEdit = 'new'; renderSuggestedSettings(); };
  target.querySelectorAll('[data-edit-suggest]').forEach(button => button.onclick = () => { state.suggestedEdit = button.dataset.editSuggest; renderSuggestedSettings(); });
  target.querySelectorAll('[data-remove-suggest]').forEach(button => button.onclick = () => { items.splice(items.findIndex(item => item.id === button.dataset.removeSuggest), 1); state.suggestedEdit = null; renderSuggestedSettings(); });
  if (!state.suggestedEdit) return;
  const dialog = target.querySelector('.location-dialog');
  dialog.showModal?.();
  dialog.oncancel = event => { event.preventDefault(); dialog.close?.(); state.suggestedEdit = null; renderSuggestedSettings(); };
  target.querySelector('#suggest-type').value = edit?.type || 'folder';
  target.querySelector('#suggest-cancel').onclick = () => { target.querySelector('.location-dialog').close?.(); state.suggestedEdit = null; renderSuggestedSettings(); };
  target.querySelector('#suggest-apply').onclick = () => {
    const label = target.querySelector('#suggest-label').value.trim();
    const type = target.querySelector('#suggest-type').value;
    const path = target.querySelector('#suggest-path').value.trim();
    if (!label || !path) { message('Enter a label and full path.', 'error'); return; }
    if (edit) Object.assign(edit, {label, type, path}); else items.push({id: uid(), label, type, path});
    target.querySelector('.location-dialog').close?.();
    state.suggestedEdit = null;
    renderSuggestedSettings();
  };
}
