'use strict';

// Turns a structure, its templates, and the user's values into a complete project plan,
// rejecting any path that is invalid or collides before anything is written.

const {relativeFile} = require('../../platform/paths');
const {expand, documentPath, linkPath, findTemplate} = require('../templates/templates');

const escapeLinkLabel = name => name.replaceAll('[', '\\[').replaceAll(']', '\\]');

function hasFileFolderConflict(files, folders) {
  const lowerFiles = files.map(p => p.toLowerCase());
  const folderUnderFile = folders.some(folder => lowerFiles.some(file => folder === file || folder.startsWith(`${file}/`)));
  const fileUnderFile = lowerFiles.some(file => lowerFiles.some(other => other !== file && other.startsWith(`${file}/`)));
  return folderUnderFile || fileUnderFile;
}

function checkCollisions(folders, allFiles) {
  if (new Set(allFiles.map(p => p.toLowerCase())).size !== allFiles.length) throw new Error('Two generated files use the same path.');
  const foldedFolders = folders.map(p => p.toLowerCase());
  if (new Set(foldedFolders).size !== foldedFolders.length) throw new Error('Two generated folders use the same path.');
  if (hasFileFolderConflict(allFiles, foldedFolders)) throw new Error('A generated file and folder path conflict.');
  const dirs = new Set(folders);
  for (const p of [...folders, ...allFiles]) {
    let parent = p.split('/').slice(0, -1);
    while (parent.length) {
      dirs.add(parent.join('/'));
      parent = parent.slice(0, -1);
    }
  }
  if (new Set([...dirs].map(p => p.toLowerCase())).size !== dirs.size) throw new Error('Generated folders differ only by letter case.');
}

function buildProjectPlan(structure, templates, values) {
  if (!structure || !structure.id) throw new Error('Choose a structure.');
  const rootName = relativeFile(expand(structure.rootName, values));
  if (rootName.includes('/')) throw new Error('The project folder name must be one segment.');
  const logPath = relativeFile(expand(structure.logPath, values));
  const folders = [...new Set(structure.folders.map(p => relativeFile(expand(p, values))))];
  const docs = [structure.primary, ...structure.documents].map((entry, index) => {
    const template = findTemplate(templates, entry.templateId);
    const rel = documentPath(entry, template, values);
    if (!rel.toLowerCase().endsWith('.md')) throw new Error(`Starter document must be Markdown: ${rel}`);
    return {path: rel, content: template.content, primary: index === 0};
  });
  checkCollisions(folders, [...docs.map(d => d.path), logPath]);

  const files = docs.map(doc => {
    const links = docs
      .filter(d => d.path !== doc.path)
      .map(d => `- [${escapeLinkLabel(d.path.split('/').at(-1))}](${linkPath(doc.path, d.path)})`)
      .join('\n');
    let content = doc.content
      .replaceAll('{PROJECT_LINKS}', links)
      .replaceAll('{LOG_PATH}', linkPath(doc.path, logPath));
    content = expand(content, values);
    if (doc.primary && !doc.content.includes('{PROJECT_LINKS}')) content += `\n\n## Files\n${links || '_No supporting documents yet._'}\n`;
    return {path: doc.path, content: content.endsWith('\n') ? content : `${content}\n`, primary: doc.primary};
  });
  files.push({path: logPath, content: '# Project log\n\n', log: true});
  return {schemaVersion: 1, structureId: structure.id, rootName, primaryPath: docs[0].path, logPath, folders, files};
}

module.exports = {buildProjectPlan};
