/* ASCII keys are the stable interface. The SVG paths supply the artwork. */
const ICON_PATHS = Object.freeze({
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4"/>',
  file_scope_folder: '<path d="M2 7h7l2 2h11v11H2z"/>',
  file_scope_tab: '<path d="M2 20V9h5V5h10v4h5v11H2z"/><path d="M7 13h10m-10 3h7"/>',
  file_scope_all: '<path d="M7 3h9l3 3v15H7zM4 6H2v15h2M16 3v4h3M10 12h6m-6 3h6"/>',
  pin: '<path d="m8 4 8 0-1 5 3 3v2H6v-2l3-3zM12 14v7"/>',
  star: '<path d="m12 2 3 6 7 .9-5 5 1.2 7L12 17.5 5.8 21 7 14 2 9l7-.9z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  chevron_right: '<path d="m9 5 7 7-7 7"/>',
  chevron_down: '<path d="m5 9 7 7 7-7"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  close: '<path d="M5 5l14 14M19 5 5 19"/>',
  minus: '<path d="M4 12h16"/>',
  maximize: '<rect x="4" y="4" width="16" height="16" rx="1"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  alert: '<path d="m12 2 10 19H2z"/><path d="M12 9v5m0 3v1"/>',
  activity: '<path d="M3 12h4l2-6 5 12 2-6h5"/>',
  back: '<path d="m14 5-7 7 7 7M7 12h14"/>',
  forward: '<path d="m10 5 7 7-7 7M17 12H3"/>',
  up: '<path d="m5 14 7-7 7 7M12 7v14"/>',
  view_details: '<path d="M3 5h18M3 12h18M3 19h18M7 3v18"/>',
  view_list: '<path d="M8 5h13M8 12h13M8 19h13"/><circle cx="4" cy="5" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="19" r="1"/>',
  view_icons: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  properties: '<path d="M6 3h9l4 4v14H6zM15 3v5h4M9 12h7m-7 4h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  filter: '<path d="M3 5h18l-7 8v5l-4 2v-7z"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 19 8m-.5 7A7 7 0 0 1 5 16"/>',
  new_window: '<rect x="3" y="7" width="14" height="14" rx="1"/><path d="M12 3h9v9M10 14 21 3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v7m0-10v.5"/>',
  external: '<path d="M13 4h7v7m0-7-9 9"/><path d="M19 14v6H4V5h6"/>'
});

function icon(key, size = 17) {
  const paths = ICON_PATHS[key];
  if (!paths) throw new Error(`Unknown icon key: ${key}`);
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
