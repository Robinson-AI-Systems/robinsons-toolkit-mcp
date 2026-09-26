// MCP stdio adapter. Capability behavior belongs to src/core.
console.log = console.error;
import 'dotenv/config';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createToolkit} from './src/core/index.js';
import {PINNED_TOOLS} from './src/adapters/mcp/surface.js';

// ── Main server bootstrap ──────────────────────────────────────────────────────
const core = await createToolkit();
const {registry, activeNamespaces, namespaceCounts, totalActiveTools, activeNs} = core;

const server = new Server(
  { name: 'robinsons-toolkit', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

// ── Tool list (always returns pinned tools) ────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: PINNED_TOOLS };
});

// ── Tool execution router ──────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // ── Meta tools ──────────────────────────────────────────────────────────
    if (name === 'search_toolkit') {
      const { query, limit = 8 } = args;
      const results = core.search(query, Math.min(limit, 20));
      if (results.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No tools found matching "${query}".\n\nAvailable namespaces: ${activeNs.join(', ')}\n\nTry: list_namespaces to see all categories, or try different search terms.`
          }]
        };
      }
      return {
        content: [{
          type: 'text',
          text: `Found ${results.length} tools matching "${query}":\n\n` +
            results.map(t =>
              `**${t.name}**\n${t.description || 'No description'}\n` +
              (t.inputSchema?.properties ? `Parameters: ${Object.keys(t.inputSchema.properties).join(', ')}` : '')
            ).join('\n\n') +
            '\n\nTo use any tool: call execute_tool with the tool_name and args.\nTo see exact parameters: call get_tool_schema with the tool_name.'
        }]
      };
    }

    if (name === 'list_namespaces') {
      const active = Object.entries(activeNamespaces)
        .filter(([, v]) => v)
        .map(([ns]) => `✅ ${ns}: ${namespaceCounts[ns] || 0} tools`);
      const inactive = Object.entries(activeNamespaces)
        .filter(([, v]) => !v)
        .map(([ns]) => `⬜ ${ns}: add credentials to .env to unlock`);
      return {
        content: [{
          type: 'text',
          text: `Robinson's Toolkit — ${totalActiveTools} active tools across ${activeNs.length} namespaces\n\n` +
            `ACTIVE:\n${active.join('\n')}\n\n` +
            (inactive.length ? `LOCKED (missing credentials):\n${inactive.join('\n')}` : '')
        }]
      };
    }

    if (name === 'get_tool_schema') {
      const { tool_name } = args;
      const tool = core.schema(tool_name);
      if (!tool) {
        return {
          content: [{
            type: 'text',
            text: `Tool "${tool_name}" not found in registry.\nUse search_toolkit to find the right tool name.`
          }]
        };
      }
      return {
        content: [{
          type: 'text',
          text: `**${tool.name}**\n\n${tool.description || ''}\n\nSchema:\n${JSON.stringify(tool.inputSchema || {}, null, 2)}`
        }]
      };
    }

    if (name === 'execute_tool') {
      const { tool_name, args: toolArgs } = args;
      const result = await core.execute(tool_name, toolArgs);
      return {
        content: [{
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        }]
      };
    }

    // ── Pinned tools (handled directly for speed) ────────────────────────────
    if (name.startsWith('local_') || name.startsWith('github_') || name.startsWith('neon_') ||
        name.startsWith('vercel_') || name.startsWith('compound_')) {
      const result = await core.execute(name, args);
      return {
        content: [{
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        }]
      };
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}. Use search_toolkit to find available tools.` }]
    };

  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error executing ${name}: ${error.message}\n\n` +
          (error.stack ? `Stack: ${error.stack}` : '')
      }],
      isError: true
    };
  }
});

// ── Start server ───────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);

console.error(`
╔══════════════════════════════════════════════════════╗
║  Robinson's Toolkit MCP v2.0 — Active               ║
║  ${String(totalActiveTools).padEnd(4)} tools across ${String(activeNs.length).padEnd(2)} namespaces        ║
║  Active: ${activeNs.slice(0,4).join(', ')}${activeNs.length > 4 ? '...' : ''}
╚══════════════════════════════════════════════════════╝
`);
