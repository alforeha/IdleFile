'use strict';

function sidebarWidthForRows(widths, viewport) {
  const desired = Math.max(266, ...widths);
  const cap = Math.max(266, Math.min(viewport * 0.4, viewport - 360));
  return Math.ceil(Math.min(desired, cap));
}

if (typeof module !== 'undefined') module.exports = {sidebarWidthForRows};
