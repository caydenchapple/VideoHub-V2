// Icons. The UI's labels are written with a symbol in front ("📂 Folder", "🗑", "⏸"); this file draws each of them as one
// crisp line icon (the same drawing on every platform, in the text colour) instead of the system's emoji picture.
// Text nodes are rewritten as they appear (a MutationObserver), so any code that sets text gets the icon for free, and
// the original character stays in the element's text for code that reads it back (e.g. `btn.textContent !== '⏸'`).
// Characters without an entry here are left alone. Emoji inside title="" tooltips are removed (a tooltip cannot hold a drawing).

const L = (d, extra = '') => `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra} aria-hidden="true">${d}</svg>`;
const FILL = 'fill="currentColor" stroke-width="1.2"';
const SHAPES = {
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/><path d="M14 2v6h6"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".6"/><circle cx="17.5" cy="10.5" r=".6"/><circle cx="8.5" cy="7.5" r=".6"/><circle cx="6.5" cy="12.5" r=".6"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.7-.7 1.7-1.6 0-.4-.2-.8-.5-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.7 1.7-1.7H16c3.3 0 6-2.7 6-6 0-4.9-4.5-8.5-10-8.5Z"/>',
  pencil: '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  pointer: '<path d="m4 4 7 17 2.5-7.5L21 11Z"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="m22 9-6 6M16 9l6 6"/>',
  note: '<path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M15 3v5h5M9 13h6M9 17h4"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/>',
  back: '<path d="M19 20 9 12l10-8Z"/><path d="M5 19V5"/>',
  forward: '<path d="m5 4 10 8-10 8Z"/><path d="M19 5v14"/>',
  pin: '<path d="M12 17v5M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V17h14v-1.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z"/>',
  type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  right: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.9 4.2A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  library: '<path d="m16 6 4 14M12 6v14M8 8v12M4 4v16"/>',
  headphones: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M21 15a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3ZM3 15a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3Z"/>',
  film: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 3v18M17 3v18M2 8h5M2 12h5M2 16h5M17 8h5M17 12h5M17 16h5"/>',
  video: '<path d="m22 8-6 4 6 4Z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3.3 7.5 8.7 5 8.7-5M12 22V12.5"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/><circle cx="12" cy="13" r="3"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4M12 17h.01"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2Z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4A2 2 0 0 0 17 6.2V2"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
  xcircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  slow: '<path d="m12 14 4-4M3.3 19a10 10 0 1 1 17.4 0"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5Z"/>',
  playLeft: '<path d="M17 4.5v15a1 1 0 0 1-1.5.9l-12-7.5a1 1 0 0 1 0-1.8l12-7.5A1 1 0 0 1 17 4.5Z"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9Z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
};
const FILLED = new Set(['play', 'playLeft', 'pause']);
// character -> drawing (a variation selector after it is swallowed)
const MAP = {
  '📂': 'folder', '📁': 'folder', '🗑': 'trash', '🖼': 'image', '🌄': 'mountain', '💾': 'save', '❔': 'help', '📄': 'file', '🎨': 'palette',
  '✏': 'pencil', '✎': 'pencil', '🔍': 'search', '👆': 'pointer', '🔊': 'volume', '🔇': 'mute', '📝': 'note', '🎵': 'music', '🎚': 'sliders',
  '⏮': 'back', '⏭': 'forward', '📌': 'pin', '🔤': 'type', '🅣': 'type', '➜': 'right', '⬆': 'up', '⬇': 'down', '👁': 'eye', '🙈': 'eyeOff',
  '🧍': 'user', '📚': 'library', '🎧': 'headphones', '🎬': 'film', '🎥': 'video', '📦': 'box', '✂': 'scissors', '➕': 'plus', '📷': 'camera',
  '⛶': 'maximize', '⚠': 'alert', '📐': 'layout', '🔒': 'lock', '🔓': 'unlock', '🔧': 'wrench', '☀': 'sun', '🆕': 'sparkles', '⚙': 'gear',
  '🎯': 'target', '⚡': 'bolt', '⏳': 'hourglass', '⏸': 'pause', '💬': 'message', '❌': 'xcircle', '🐢': 'slow', '🧩': 'layers', '▶': 'play', '◀': 'playLeft', '✓': 'check', '✕': 'x', '✗': 'x',
};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CHARS = Object.keys(MAP).map(esc).join('|');
const FIND = new RegExp(`(${CHARS})\\uFE0F?( ?)`, 'g'), HAS = new RegExp(`(?:${CHARS})`);
const ANY_EMOJI = /[\u{1F000}-\u{1FAFF}☀-➿⬀-⯿⌀-⏿]️?/gu;

export function iconSvg(name) { return L(SHAPES[name] || '', FILLED.has(name) ? FILL : ''); }

// the pieces for one piece of text: strings and icon elements
function pieces(text) {
  const out = []; let last = 0, m;
  FIND.lastIndex = 0;
  while ((m = FIND.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const hasText = m[2] === ' ' && FIND.lastIndex < text.length;
    const el = document.createElement('span');
    el.className = 'ico' + (hasText ? ' ico-lead' : '');
    el.innerHTML = iconSvg(MAP[m[1]]);
    const t = document.createElement('span'); t.className = 'ico-t'; t.textContent = m[1] + m[2];   // the character stays readable for code and copy/paste
    el.append(t); out.push(el);
    last = FIND.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
const SKIP = 'script, style, textarea, input, select, option, [contenteditable="true"], .ico-t, .no-ico';
function decorateText(node) {
  const p = node.parentElement;
  if (!p || !HAS.test(node.data)) return;
  if (p.closest('option')) { node.data = node.data.replace(FIND, ''); return; }   // a menu entry cannot hold a drawing
  if (p.closest(SKIP)) return;
  node.replaceWith(...pieces(node.data));
}
function walk(root) {
  if (root.nodeType === 3) return decorateText(root);
  if (root.nodeType !== 1 || root.closest?.(SKIP)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found = []; for (let n = w.nextNode(); n; n = w.nextNode()) if (HAS.test(n.data)) found.push(n);
  for (const n of found) decorateText(n);
  for (const el of [root, ...root.querySelectorAll('[title]')]) cleanTitle(el);
}
// a tooltip can only hold text: take the picture characters out of it
function cleanTitle(el) {
  const t = el.getAttribute?.('title'); if (!t) return;
  const c = t.replace(ANY_EMOJI, '').replace(/\s{2,}/g, ' ').trim();
  if (c !== t) el.setAttribute('title', c);
}
export function startIcons(root = document.body) {
  walk(root);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'attributes') { cleanTitle(m.target); continue; }
      if (m.type === 'characterData') { decorateText(m.target); continue; }
      for (const n of m.addedNodes) walk(n);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title'] });
}
