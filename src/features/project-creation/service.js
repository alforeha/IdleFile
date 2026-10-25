'use strict';

// Main-process project-creation workflow: required values, preview, create, and recovery retry.

const {requiredValues} = require('../templates/templates');
const {sha256} = require('../../platform/files');
const {listJobs} = require('../../platform/recovery-journal');
const {requireConfiguredRoot} = require('../explorer/explorer');
const {buildProjectPlan} = require('./plan');
const {previewTarget, startCreation, resumeCreation} = require('./creation');

function createProjectService({session, journalDir}) {
  function findStructure(settings, structureId) {
    return settings?.data.standards.structures.find(s => s.id === structureId);
  }

  async function required(structureId) {
    const settings = await session.current();
    const structure = findStructure(settings, structureId);
    if (!structure) throw new Error('Choose a structure.');
    return requiredValues(structure, settings.data.standards.docTemplates);
  }

  async function preview({parent, structureId, values}) {
    const settings = await session.current();
    if (!settings) throw new Error('Choose a settings file first.');
    if (!settings.selectedUserId) throw new Error('Select your user first.');
    const structure = findStructure(settings, structureId);
    if (!structure) throw new Error('Structure no longer exists. Reload settings.');
    const plan = buildProjectPlan(structure, settings.data.standards.docTemplates, values);
    await requireConfiguredRoot(parent, session.roots());
    const root = await previewTarget(parent, plan);
    const fingerprint = sha256(JSON.stringify({parent, plan, revision: settings.revision}));
    return {plan, root, fingerprint};
  }

  // Creation repeats every preview check and refuses if anything changed since the user's preview.
  async function create(request) {
    const ready = await preview(request);
    if (ready.fingerprint !== request.fingerprint) throw new Error('Preview changed. Preview again before creating.');
    return startCreation(request.parent, ready.plan, journalDir);
  }

  return {
    required,
    preview,
    create,
    resume: id => resumeCreation(id, journalDir),
    jobs: () => listJobs(journalDir)
  };
}

module.exports = {createProjectService};
