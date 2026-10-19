'use strict';

const {relativeFile, markdownLink} = require('./paths');
const TOKEN = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

function tokens(text) { return [...String(text).matchAll(TOKEN)].map(match => match[1]); }
function expand(text, values) {
  return String(text).replace(TOKEN, (_, key) => {
    if (!Object.hasOwn(values, key) || values[key] === '') throw new Error(`Missing value for {${key}}.`);
    return String(values[key]);
  });
}
function documentPath(entry, template, values) {
  const folder = entry.folder ? `${expand(entry.folder, values)}/` : '';
  const pattern = entry.path || template.fileNamePattern;
  if (!pattern) throw new Error(`Document template ${template.name} needs a filename rule.`);
  return relativeFile(`${folder}${expand(pattern, values)}`);
}
function linkPath(from, to) { return markdownLink(from, to).split('/').map(part => encodeURIComponent(part)).join('/'); }
function requiredValues(structure, templates) {
  const text = [structure.rootName, structure.logPath, ...structure.folders];
  for (const doc of [structure.primary, ...structure.documents]) {
    const template = templates.find(t => t.id === doc.templateId);
    if (!template) throw new Error(`Missing document template: ${doc.templateId}`);
    text.push(doc.folder || '', doc.path || template.fileNamePattern || '');
    text.push(template.content.replaceAll('{PROJECT_LINKS}', '').replaceAll('{LOG_PATH}', ''));
  }
  return [...new Set(text.flatMap(tokens))].filter(key => key !== 'PROJECT_LINKS' && key !== 'LOG_PATH');
}
function buildProjectPlan(structure, templates, values) {
  if (!structure || !structure.id) throw new Error('Choose a structure.');
  const rootName = relativeFile(expand(structure.rootName, values));
  if (rootName.includes('/')) throw new Error('The project folder name must be one segment.');
  const logPath = relativeFile(expand(structure.logPath, values));
  const folders = [...new Set(structure.folders.map(p => relativeFile(expand(p, values))))];
  const docs = [structure.primary, ...structure.documents].map((entry, index) => {
    const template = templates.find(t => t.id === entry.templateId);
    if (!template) throw new Error(`Missing document template: ${entry.templateId}`);
    const rel = documentPath(entry, template, values);
    if (!rel.toLowerCase().endsWith('.md')) throw new Error(`Starter document must be Markdown: ${rel}`);
    return {path: rel, content: template.content, primary: index === 0};
  });
  const allFiles = [...docs.map(d => d.path), logPath];
  if (new Set(allFiles.map(p => p.toLowerCase())).size !== allFiles.length) throw new Error('Two generated files use the same path.');
  const primaryPath = docs[0].path;
  const foldedFolders = folders.map(p => p.toLowerCase());
  if (new Set(foldedFolders).size !== foldedFolders.length) throw new Error('Two generated folders use the same path.');
  if (allFiles.some(file => foldedFolders.some(folder => folder === file.toLowerCase() || folder.startsWith(`${file.toLowerCase()}/`))) || allFiles.some(file => allFiles.some(other => other !== file && other.toLowerCase().startsWith(`${file.toLowerCase()}/`)))) throw new Error('A generated file and folder path conflict.');
  const dirs = new Set(folders);
  for (const p of [...folders, ...allFiles]) {
    let parent = p.split('/').slice(0, -1);
    while (parent.length) { dirs.add(parent.join('/')); parent = parent.slice(0, -1); }
  }
  if (new Set([...dirs].map(p => p.toLowerCase())).size !== dirs.size) throw new Error('Generated folders differ only by letter case.');
  const files = docs.map(doc => {
    const links = docs.filter(d => d.path !== doc.path).map(d => `- [${d.path.split('/').at(-1).replaceAll('[', '\\[').replaceAll(']', '\\]')}](${linkPath(doc.path, d.path)})`).join('\n');
    const logLink = linkPath(doc.path, logPath);
    let content = doc.content.replaceAll('{PROJECT_LINKS}', links).replaceAll('{LOG_PATH}', logLink);
    content = expand(content, values);
    if (doc.primary && !doc.content.includes('{PROJECT_LINKS}')) content += `\n\n## Files\n${links || '_No supporting documents yet._'}\n`;
    return {path: doc.path, content: content.endsWith('\n') ? content : `${content}\n`, primary: doc.primary};
  });
  files.push({path: logPath, content: '# Project log\n\n', log: true});
  return {schemaVersion: 1, structureId: structure.id, rootName, primaryPath, logPath, folders, files};
}

module.exports = {tokens, expand, requiredValues, buildProjectPlan};
