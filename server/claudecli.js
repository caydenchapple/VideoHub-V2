// Connect Claude Code to VideoHub from the hub itself ("Connect with one click"): runs `claude mcp add` for this install.
// Falls back to handing the user the exact command when the claude program cannot be found or fails.
import fs from 'node:fs';
import path from 'node:path';
import { HUB_DIR, HOME, run } from './util.js';
import { IS_WIN, MAC_TOOL_DIRS, stableNodePath } from './platform.js';

export function findClaude() {
  const names = IS_WIN ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const dirs = [...(process.env.PATH || '').split(path.delimiter), ...(IS_WIN ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude'), path.join(HOME, '.local', 'bin')] : [...MAC_TOOL_DIRS, path.join(HOME, '.local', 'bin'), path.join(HOME, '.claude', 'local'), path.join(HOME, '.npm-global', 'bin')])];
  for (const d of dirs) for (const n of names) { const f = path.join(d, n); try { if (d && fs.statSync(f).isFile()) return f; } catch { } }
  if (!IS_WIN) {   // the Claude desktop app keeps its own copy
    const root = path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude-code');
    try { for (const v of fs.readdirSync(root).sort().reverse()) { const f = path.join(root, v, 'claude.app', 'Contents', 'MacOS', 'claude'); if (fs.existsSync(f)) return f; } } catch { }
  }
  return null;
}
const q = s => /\s/.test(s) ? `"${s}"` : s;
export function connectCommand() {
  const node = IS_WIN ? 'node' : stableNodePath(), mcp = path.join(HUB_DIR, 'server', 'mcp.js');
  return { node, mcp, text: `claude mcp add --scope user videohub -- ${q(node)} ${q(mcp)}` };
}
export async function connectNow() {
  const cmd = connectCommand(), claude = findClaude();
  if (!claude) return { ok: false, command: cmd.text, why: 'The claude program was not found on this computer.' };
  const opts = IS_WIN ? { shell: true } : {};
  await run(claude, ['mcp', 'remove', 'videohub', '--scope', 'user'], opts);
  const r = await run(claude, ['mcp', 'add', '--scope', 'user', 'videohub', '--', cmd.node, cmd.mcp], opts);
  return r.code === 0 ? { ok: true, command: cmd.text } : { ok: false, command: cmd.text, why: (r.stderr || r.stdout || 'claude mcp add failed').trim().split('\n').pop().slice(0, 240) };
}
