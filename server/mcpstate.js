// Is Claude connected to VideoHub, and is it listening for notes right now? The MCP server (server/mcp.js, one per Claude session)
// says hello every 15 s while it runs; a hub_wait_for_notes call is "listening" for as long as its request is open here.
// "Send to Claude" in the review marks the project's notes as sent; a listening Claude gets them at once, without any pasting.
import { EventEmitter } from 'node:events';

const clients = new Map();      // id -> { name, pid, at }
const waits = new Map();        // token -> { project, at }
const pending = new Map();      // project id -> { at, ids }  (sent by the user, not yet picked up)
const bus = new EventEmitter(); bus.setMaxListeners(0);
const TTL = 45e3;
let last = '';

const alive = () => { const now = Date.now(); for (const [id, c] of clients) if (now - c.at > TTL) clients.delete(id); return [...clients.values()]; };
export const mcpStatus = () => ({ connected: alive().length, waiting: waits.size, clients: alive().map(c => ({ name: c.name, pid: c.pid })) });
export const onMcpChange = fn => { bus.on('change', fn); return () => bus.off('change', fn); };
const changed = () => { const s = JSON.stringify(mcpStatus()); if (s !== last) { last = s; bus.emit('change', mcpStatus()); } };
setInterval(changed, 10e3).unref();   // a client that went quiet drops out of the count

export function hello({ id, name, pid }) { if (!id) return; clients.set(String(id), { name: String(name || 'claude').slice(0, 40), pid: +pid || 0, at: Date.now() }); changed(); }
export function bye(id) { clients.delete(String(id)); changed(); }

// the user pressed "Send to Claude": these notes are waiting for Claude
export function sent(project, ids) { pending.set(project, { at: Date.now(), ids: ids || [] }); bus.emit('sent', project); }
export const hasPending = project => pending.has(project);
export const takePending = project => { const p = pending.get(project) || null; pending.delete(project); return p; };

// long poll for hub_wait_for_notes: resolves { sent: true } at once when notes are waiting, else when they are sent or after `sec`
export function waitForSent(project, sec, token) {
  return new Promise(resolve => {
    if (hasPending(project)) { takePending(project); return resolve({ sent: true }); }
    const tk = token || Math.random().toString(36).slice(2);
    waits.set(tk, { project, at: Date.now() }); changed();
    const done = v => { clearTimeout(timer); bus.off('sent', on); waits.delete(tk); changed(); resolve(v); };
    const on = p => { if (p === project && hasPending(project)) { takePending(project); done({ sent: true }); } };
    const timer = setTimeout(() => done({ sent: false }), Math.max(0, sec) * 1000);
    bus.on('sent', on);
  });
}
export const waitingCount = () => waits.size;
