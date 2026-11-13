// What differs between Windows and macOS in the UI's wording (the server does the real work; see server/platform.js).
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
export const OS_NAME = IS_MAC ? 'macOS' : 'Windows';
export const BIN = IS_MAC ? 'Trash' : 'Recycle Bin';
export const FILES_APP = IS_MAC ? 'Finder' : 'Explorer';
// the last n folders of a path, either slash style (the server sends its own: \ on Windows, / on macOS)
export const tailPath = (p, n) => String(p || '').split(/[\\/]/).filter(Boolean).slice(-n).join(IS_MAC ? '/' : '\\');
