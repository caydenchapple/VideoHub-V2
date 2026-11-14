// Same tools as the MCP server, for sessions that do not have it:
//   node server/cli.js hub_notes '{"project":"C:\\path\\to\\film"}'
//   node server/cli.js list
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOLS } from './tools.js';

const [name, json] = process.argv.slice(2);
if (!name || name === 'list' || !TOOLS[name]) {
  console.log('Tools:\n' + Object.entries(TOOLS).map(([k, t]) => `  ${k} — ${t.description.split('.')[0]}`).join('\n'));
  process.exit(name && name !== 'list' ? 1 : 0);
}
// exitCode instead of process.exit(): exiting while fetch sockets close trips a libuv assertion on Windows
try {
  const args = json ? JSON.parse(json) : {};
  const r = await TOOLS[name].run(args);
  if (r && typeof r === 'object' && typeof r.text === 'string') {   // pictures: written to files the agent can open
    console.log(r.text);
    if (r.images?.length) {
      const dir = path.join(os.tmpdir(), 'videohub-pictures'); fs.mkdirSync(dir, { recursive: true });
      r.images.forEach((im, i) => { const f = path.join(dir, `${name}-${Date.now()}-${i + 1}.jpg`); fs.writeFileSync(f, Buffer.from(im.data, 'base64')); console.log(`Picture ${i + 1}: ${f}`); });
    }
  } else console.log(r);
} catch (e) { console.error('Error:', e.message || e); process.exitCode = 1; }
