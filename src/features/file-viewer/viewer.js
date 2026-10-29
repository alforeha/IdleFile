'use strict';

let viewerPreferences = {markdownMode: 'preview', textWrap: true};
function viewerSetup(preferences) {
  viewerPreferences = {markdownMode: 'preview', textWrap: true, ...(preferences || {})};
}
function viewerDirty(file) { return !!file.info?.supported && file.source !== file.savedSource; }
function syncViewerDirty() { api.viewerDirty?.([...beta.files.values()].some(viewerDirty)).catch(failure); }
async function loadViewerFile(file) {
  try {
    if (!file.handle && api.openViewerFile) {
      const opened = await api.openViewerFile(file.path);
      file.handle = opened.handle;
      file.info = opened.info;
    } else file.info = file.handle && api.reloadViewerFile ? await api.reloadViewerFile(file.handle) : api.readViewerFile ? await api.readViewerFile(file.path) : {...await api.inspectFile(file.path), supported: false, reason: 'File viewer unavailable.'};
    file.error = null;
    if (file.info.supported) file.source = file.savedSource = file.info.source;
    file.diskChanged = false;
    file.unavailable = false;
  } catch (error) { file.error = error.message; file.unavailable = true; }
  if (beta.active.kind === 'file' && same(beta.active.path, file.path)) renderBeta();
  syncViewerDirty();
}
async function checkViewerFile(file, force = false) {
  if (!file) return;
  try {
    const current = await api.readViewerFile(file.path);
    if (!force && current.hash === file.info?.hash) return;
    if (viewerDirty(file)) { file.diskChanged = current.hash !== file.info?.hash; file.unavailable = false; }
    else {
      file.info = file.handle && api.reloadViewerFile ? await api.reloadViewerFile(file.handle) : current;
      file.source = file.savedSource = file.info.source || '';
      file.diskChanged = false; file.unavailable = false;
    }
    file.error = null;
  } catch (error) { file.unavailable = true; file.error = error.message; }
  if (beta.active.kind === 'file' && same(beta.active.path, file.path)) renderContent();
}
function viewerButton(key, title, action, active = false) {
  return `<button class="viewer-tool ${active ? 'active' : ''}" data-viewer="${action}" aria-label="${title}" title="${title}" aria-pressed="${active}">${icon(key, 17)}</button>`;
}
function viewerMenu(file) {
  const info = file.info || {};
  const saveTitle = viewerDirty(file) ? 'Save, unsaved changes' : 'Save';
  return `<div class="viewer-menu" data-viewer-menu hidden>
    <button data-viewer="save" aria-label="${saveTitle}" ${!info.supported ? 'disabled' : ''}><span class="save-icon">${icon('save', 18)}${viewerDirty(file) ? '<b>!</b>' : ''}</span>Save</button>
    <button data-viewer="go-folder">${icon('folder', 18)}Go to folder</button>
    <dl><dt>Type</dt><dd>${be(info.type === 'markdown' ? 'Markdown' : info.type === 'text' ? 'Text' : info.name?.split('.').at(-1)?.toUpperCase() || 'File')}</dd>
    <dt>Location</dt><dd>${be(parent(file.path))}</dd><dt>Size</dt><dd>${info.size == null ? '—' : `${info.size.toLocaleString()} bytes`}</dd>
    <dt>Modified</dt><dd>${be(info.modified ? new Date(info.modified).toLocaleString() : '—')}</dd></dl></div>`;
}
function renderFileViewer(file) {
  if (!file) return '';
  const info = file.info || {};
  const type = info.type === 'markdown' ? 'Markdown' : info.type === 'text' ? 'Text' : info.type || 'File';
  const stem = label(file.path).replace(/\.[^.]+$/, '');
  const markdown = info.type === 'markdown' && info.supported;
  const text = info.type === 'text' && info.supported;
  const raw = (markdown && file.mode !== 'preview') || text;
  const preview = markdown && file.mode !== 'raw';
  const headings = markdown ? markdownHeadings(file.source) : [];
  return `<div class="viewer-frame"><div class="viewer-chrome"><div class="viewer-toolbar">
    <div class="viewer-identity">${viewerButton('info', 'File information', 'info')}<button class="viewer-type-button" data-viewer="convert">${be(type)} ${icon('chevron_down', 12)}</button><strong title="${be(label(file.path))}">${be(stem)}</strong></div>
    <div class="viewer-actions">${markdown ? `<div class="viewer-switch" role="group" aria-label="View mode">${viewerButton('code', 'Raw Markdown', 'mode:raw', file.mode === 'raw')}${viewerButton('eye', 'Preview', 'mode:preview', file.mode === 'preview')}${viewerButton('columns', 'Split view', 'mode:split', file.mode === 'split')}</div>${viewerButton('view_list', 'Contents', 'contents', !!file.contents)}` : ''}
    ${text ? viewerButton('wrap', 'Wrap text', 'wrap', file.wrap) : ''}${viewerButton('close', 'Close file', 'close')}</div></div>
    ${viewerMenu(file)}<div class="viewer-convert" data-viewer-convert hidden><strong>Convert to</strong><button disabled>Not available yet</button></div></div>
    ${file.diskChanged ? '<div class="viewer-notice">Changed on disk. Save to choose what to keep.</div>' : ''}
    ${file.unavailable ? `<div class="viewer-notice error">File deleted or unavailable. ${be(file.error || '')}</div>` : ''}
    ${file.error && !file.unavailable ? `<div class="viewer-notice error">${be(file.error)}</div>` : ''}
    ${!info.supported ? `<div class="viewer-placeholder">${icon('file', 36)}<h2>Preview unavailable</h2><p>${be(file.error || info.reason || 'This file type does not have a viewer yet.')}</p><button data-viewer="reload">Try again</button></div>` : `<div class="viewer-stage ${file.contents && markdown ? 'with-contents' : ''}"><div class="viewer-panes ${file.mode === 'split' && markdown ? 'split' : ''}">
      ${raw ? rawEditor(file) : ''}${preview ? `<div class="viewer-preview" aria-label="Markdown preview">${safeMarkdown(file.source, file.path)}</div>` : ''}</div>
      ${file.contents && markdown ? `<aside class="viewer-contents"><h2>Contents</h2><nav>${headings.length ? headings.map(item => `<button data-viewer-heading="${be(item.id)}" data-line="${item.line}" class="level-${item.level}">${be(item.title)}</button>`).join('') : '<p>No headings</p>'}</nav></aside>` : ''}</div>`}</div>`;
}
function viewerPrompt(message, choices) {
  return new Promise(resolve => {
    const dialog = document.querySelector('#viewer-dialog');
    dialog.querySelector('p').textContent = message;
    dialog.querySelector('.viewer-dialog-actions').innerHTML = choices.map(choice => `<button type="button" data-choice="${choice}">${choice}</button>`).join('');
    const finish = choice => {
      dialog.removeEventListener('click', done);
      dialog.removeEventListener('cancel', cancel);
      dialog.close?.(); dialog.removeAttribute('open');
      resolve(choice);
    };
    const done = event => {
      const button = event.target.closest('[data-choice]');
      if (!button) return;
      finish(button.dataset.choice);
    };
    const cancel = event => { event.preventDefault(); finish('Cancel'); };
    dialog.addEventListener('click', done);
    dialog.addEventListener('cancel', cancel);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  });
}
async function saveViewerFile(file) {
  if (!viewerDirty(file)) return true;
  try {
    let overwrite = false;
    while (true) {
      const result = await api.saveViewerFile(file.handle, file.source, overwrite);
      if (!result.conflict) { file.info = result.info; file.savedSource = file.source; file.diskChanged = false; file.error = null; syncViewerDirty(); renderBeta(); return true; }
      file.diskChanged = true; renderContent();
      const choice = await viewerPrompt('This file changed on disk. Choose which version to keep.', ['Overwrite', 'Reload', 'Cancel']);
      if (choice === 'Cancel') return false;
      if (choice === 'Reload') { await loadViewerFile(file); renderBeta(); return false; }
      overwrite = true;
    }
  } catch (error) { file.error = error.message; renderContent(); return false; }
}
async function closeViewerTab(path) {
  const file = beta.files.get(path);
  if (!file) return;
  if (viewerDirty(file)) {
    const choice = await viewerPrompt(`Save changes to ${label(file.path)}?`, ['Save', 'Discard', 'Cancel']);
    if (choice === 'Cancel' || choice === 'Save' && !await saveViewerFile(file)) return;
  }
  beta.files.delete(file.path);
  if (file.handle) await api.closeViewerFile?.(file.handle);
  if (beta.active.kind === 'file' && same(beta.active.path, file.path)) {
    const folder = parent(file.path);
    if (beta.folders.has(folder)) { beta.active = {kind: 'folder', path: beta.folders.get(folder).path}; beta.currentFolder = beta.active.path; }
    else await openFolder(folder);
  }
  syncViewerDirty(); renderBeta();
}
async function viewerAction(action, file) {
  if (action === 'info' || action === 'convert') {
    const selected = document.querySelector(action === 'info' ? '[data-viewer-menu]' : '[data-viewer-convert]');
    const other = document.querySelector(action === 'info' ? '[data-viewer-convert]' : '[data-viewer-menu]');
    other.hidden = true; selected.hidden = !selected.hidden; return;
  }
  if (action === 'save') return saveViewerFile(file);
  if (action === 'go-folder') { await openFolder(parent(file.path)); beta.selected = file.path; updateSelectedArea(); renderContent(); updateSelectedArea(); return; }
  if (action === 'close') return closeViewerTab(file.path);
  if (action === 'reload') return loadViewerFile(file);
  if (action.startsWith('mode:')) { file.mode = action.slice(5); viewerPreferences.markdownMode = file.mode; api.setViewerPreferences?.(viewerPreferences).catch(failure); renderContent(); return; }
  if (action === 'wrap') { file.wrap = !file.wrap; viewerPreferences.textWrap = file.wrap; api.setViewerPreferences?.(viewerPreferences).catch(failure); renderContent(); return; }
  if (action === 'contents') { file.contents = !file.contents; renderContent(); }
}
document.addEventListener('click', event => {
  const heading = event.target.closest('[data-viewer-heading]');
  if (heading) {
    const preview = document.querySelector('.viewer-preview');
    const target = [...preview?.querySelectorAll('[id]') || []].find(item => item.id === heading.dataset.viewerHeading);
    if (target) target.scrollIntoView({block: 'start'});
    const editor = document.querySelector('.viewer-raw');
    if (editor && (!preview || beta.files.get(beta.active.path).mode === 'raw')) {
      const lines = editor.value.split('\n');
      editor.focus(); editor.setSelectionRange(lines.slice(0, Number(heading.dataset.line)).join('\n').length, lines.slice(0, Number(heading.dataset.line)).join('\n').length);
    }
    event.stopPropagation(); return;
  }
  const link = event.target.closest('.viewer-preview a[data-viewer-link]');
  if (link) {
    event.preventDefault(); event.stopPropagation();
    const href = link.dataset.viewerLink;
    if (/^https?:\/\//i.test(href)) api.openExternal?.(href).catch(failure);
    else if (!/^[a-z][\w+.-]*:/i.test(href) && !href.startsWith('//')) {
      const file = beta.files.get(beta.active.path);
      const target = parent(file.path) + '\\' + decodeURIComponent(href.split('#')[0]).replaceAll('/', '\\');
      if (href.split('#')[0]) api.inspectFile(target).then(() => openFile(target), () => openFolder(target)).catch(failure);
    }
    return;
  }
  const button = event.target.closest('[data-viewer]');
  if (!button || !button.closest('.viewer-frame')) return;
  event.stopPropagation();
  viewerAction(button.dataset.viewer, beta.files.get(beta.active.path)).catch(failure);
});
document.addEventListener('input', event => {
  if (!event.target.matches('.viewer-raw')) return;
  const file = beta.files.get(beta.active.path);
  file.source = event.target.value;
  const preview = document.querySelector('.viewer-preview');
  if (preview) preview.innerHTML = safeMarkdown(file.source, file.path);
  if (file.contents) {
    const nav = document.querySelector('.viewer-contents nav');
    if (nav) nav.innerHTML = markdownHeadings(file.source).map(item => `<button data-viewer-heading="${be(item.id)}" data-line="${item.line}" class="level-${item.level}">${be(item.title)}</button>`).join('') || '<p>No headings</p>';
  }
  const menu = document.querySelector('[data-viewer-menu]');
  if (menu) { const open = !menu.hidden; menu.outerHTML = viewerMenu(file); document.querySelector('[data-viewer-menu]').hidden = !open; }
  const pill = [...document.querySelectorAll('.file-pill')].find(node => same(node.querySelector('[data-file]')?.dataset.file, file.path));
  pill?.classList.toggle('dirty', viewerDirty(file));
  syncViewerDirty();
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && beta.active.kind === 'file') { event.preventDefault(); saveViewerFile(beta.files.get(beta.active.path)).catch(failure); }
});
api.onWindowCloseRequest?.(async () => {
  for (const file of beta.files.values()) {
    if (!viewerDirty(file)) continue;
    const choice = await viewerPrompt(`Save changes to ${label(file.path)} before closing?`, ['Save', 'Discard', 'Cancel']);
    if (choice === 'Cancel' || choice === 'Save' && !await saveViewerFile(file)) return;
  }
  api.finishWindowClose?.();
});
