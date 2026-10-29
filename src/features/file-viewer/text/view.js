'use strict';

function rawEditor(file) {
  return `<textarea class="viewer-raw ${file.wrap ? 'wrap' : ''}" aria-label="Edit ${be(label(file.path))}" spellcheck="false" wrap="${file.wrap ? 'soft' : 'off'}">${be(file.source)}</textarea>`;
}
