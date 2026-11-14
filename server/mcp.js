// VideoHub MCP server (stdio). stdout belongs to the MCP protocol: log only to stderr.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS, heartbeat, goodbye } from './tools.js';

const server = new McpServer({ name: 'videohub', version: '0.2.0' });
// a tool answers with text, or { text, images: [{ data: <base64>, mimeType }] } (pictures the model can look at)
const ok = r => {
  if (r && typeof r === 'object' && !Array.isArray(r) && (r.images || typeof r.text === 'string')) return { content: [{ type: 'text', text: String(r.text ?? '') }, ...(r.images || []).map(i => ({ type: 'image', data: i.data, mimeType: i.mimeType || 'image/jpeg' }))] };
  return { content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r, null, 1) }] };
};
const fail = e => ({ isError: true, content: [{ type: 'text', text: String(e?.message || e) }] });

for (const [name, tool] of Object.entries(TOOLS)) {
  server.registerTool(name, { description: tool.description, inputSchema: tool.schema }, async (args, extra) => {
    try { return ok(await tool.run(args ?? {}, extra)); } catch (e) { console.error(e); return fail(e); }
  });
}
await server.connect(new StdioServerTransport());

// tell the hub this Claude session is connected (VideoHub shows it next to "Send to Claude")
const ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
heartbeat(ID); setInterval(() => heartbeat(ID), 15e3).unref();
process.stdin.on('end', () => goodbye(ID).finally(() => process.exit(0)));
