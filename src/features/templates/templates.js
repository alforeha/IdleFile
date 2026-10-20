'use strict';

// Starter-document template rules: {TOKEN} expansion, filename rules, and relative Markdown links.

const {relativeFile, markdownLink} = require('../../platform/paths');

const TOKEN = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
// Filled in by project creation, not by the user.
const GENERATED_TOKENS = ['PROJECT_LINKS', 'LOG_PATH'];

function tokens(text) {
  return [...String(text).matchAll(TOKEN)].map(match => match[1]);
}

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

function linkPath(from, to) {
  return markdownLink(from, to).split('/').map(part => encodeURIComponent(part)).join('/');
}

function findTemplate(templates, templateId) {
  const template = templates.find(t => t.id === templateId);
  if (!template) throw new Error(`Missing document template: ${templateId}`);
  return template;
}

// Every user-supplied token used by a structure's paths and its documents' filenames and content.
function requiredValues(structure, templates) {
  const text = [structure.rootName, structure.logPath, ...structure.folders];
  for (const doc of [structure.primary, ...structure.documents]) {
    const template = findTemplate(templates, doc.templateId);
    text.push(doc.folder || '', doc.path || template.fileNamePattern || '');
    text.push(GENERATED_TOKENS.reduce((content, token) => content.replaceAll(`{${token}}`, ''), template.content));
  }
  return [...new Set(text.flatMap(tokens))].filter(key => !GENERATED_TOKENS.includes(key));
}

module.exports = {tokens, expand, documentPath, linkPath, findTemplate, requiredValues};
