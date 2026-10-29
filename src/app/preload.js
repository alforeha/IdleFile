'use strict';
const {contextBridge, ipcRenderer} = require('electron');
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('folderApp', Object.freeze({
  bootstrap: () => call('bootstrap'),
  openSettings: () => call('settings.open'),
  newSettings: () => call('settings.new'),
  chooseFolder: () => call('folder.choose'),
  reloadSettings: () => call('settings.reload'),
  saveSettings: payload => call('settings.save', payload),
  selectUser: id => call('user.select', id),
  requiredValues: id => call('projects.required', id),
  previewProject: request => call('projects.preview', request),
  createProject: request => call('projects.create', request),
  resumeProject: id => call('projects.resume', id),
  listJobs: () => call('projects.jobs'),
  listFolder: (target, offset = 0, sort = 'name', direction = 'asc') => call('explorer.list', target, offset, sort, direction),
  setVisibleFolders: folders => call('explorer.visible', folders),
  onFolderChanges: callback => {
    const listener = (_, paths) => callback(paths);
    ipcRenderer.on('explorer.changed', listener);
    return () => ipcRenderer.removeListener('explorer.changed', listener);
  },
  inspectFile: target => call('explorer.file', target),
  readViewerFile: target => call('viewer.read', target),
  openViewerFile: target => call('viewer.open', target),
  reloadViewerFile: handle => call('viewer.reload', handle),
  saveViewerFile: (handle, source, overwrite) => call('viewer.save', handle, source, overwrite),
  closeViewerFile: handle => call('viewer.closed', handle),
  listSavePoints: () => call('viewer.save-points'),
  restoreSavePoint: id => call('viewer.restore-point', id),
  dismissSavePoint: id => call('viewer.dismiss-point', id),
  viewerDirty: dirty => call('viewer.dirty', dirty),
  finishWindowClose: () => call('viewer.window-finish'),
  openExternal: url => call('viewer.external', url),
  setViewerPreferences: preferences => call('viewer.preferences', preferences),
  onWindowCloseRequest: callback => {
    const listener = () => callback();
    ipcRenderer.on('viewer.close-request', listener);
    return () => ipcRenderer.removeListener('viewer.close-request', listener);
  },
  addRoot: () => call('roots.add'),
  removeRoot: target => call('roots.remove', target),
  rootStatus: () => call('roots.status'),
  addPin: path => call('pins.add', path),
  removePin: path => call('pins.remove', path),
  locationStatus: items => call('locations.status', items),
  setTheme: theme => call('theme.set', theme),
  windowControl: action => call('window.control', action)
}));
