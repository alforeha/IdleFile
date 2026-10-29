'use strict';

function markdownHeadings(source) {
  const found = [];
  const counts = new Map();
  const parser = window.marked?.marked || window.marked;
  const tokens = parser?.lexer ? parser.lexer(source, {gfm: true}) : [];
  let offset = 0;
  for (const token of tokens) {
    const position = source.indexOf(token.raw, offset);
    const line = position < 0 ? 0 : source.slice(0, position).split('\n').length - 1;
    if (position >= 0) offset = position + token.raw.length;
    if (token.type !== 'heading') continue;
    const title = token.text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '');
    const slug = title.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'heading';
    const number = counts.get(slug) || 0;
    counts.set(slug, number + 1);
    found.push({title, level: token.depth, id: number ? `${slug}-${number}` : slug, line});
  }
  return found;
}
function safeMarkdown(source) {
  if (!window.marked || !window.DOMPurify) return '<p>Markdown renderer unavailable.</p>';
  const parser = window.marked.marked || window.marked;
  const dirty = parser.parse(source, {gfm: true, breaks: false});
  const clean = window.DOMPurify.sanitize(dirty, {FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'math'], FORBID_ATTR: ['style']});
  const template = document.createElement('template');
  template.innerHTML = clean;
  const headings = markdownHeadings(source);
  template.content.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((heading, index) => { heading.id = headings[index]?.id || `heading-${index}`; });
  template.content.querySelectorAll('input[type="checkbox"]').forEach(input => { input.disabled = true; });
  template.content.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || /^(javascript|data|vbscript|file):/i.test(href) || href.startsWith('//')) link.removeAttribute('href');
    else link.dataset.viewerLink = href;
  });
  template.content.querySelectorAll('img').forEach(img => {
    const placeholder = document.createElement('span');
    placeholder.className = 'viewer-image-placeholder';
    placeholder.textContent = img.getAttribute('alt') || 'Image';
    img.replaceWith(placeholder);
  });
  return template.innerHTML;
}
