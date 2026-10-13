// MCP adapter: dotenv and stdout handling belong here, never in Core.
console.log = console.error;
import 'dotenv/config';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createToolkit} from './src/core/index.js';
import {callBroker} from './src/adapters/mcp/broker.js';
import {PINNED_TOOLS} from './src/adapters/mcp/surface.js';
const core=await createToolkit();
if(process.argv.includes('--modern')){
  const {startModernStdio}=await import('./src/adapters/mcp/modern.js');
  await startModernStdio(core);
}else{
const server=new Server({name:'robinsons-toolkit',version:'2.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:PINNED_TOOLS}));
server.setRequestHandler(CallToolRequestSchema,async({params:{name,arguments:args={}}})=>callBroker(core,name,args));
await server.connect(new StdioServerTransport());
}
console.error(`Robinson's Toolkit: ${core.registry.length} catalog entries; ${PINNED_TOOLS.length} MCP broker tools; provider handlers load on demand.`);
