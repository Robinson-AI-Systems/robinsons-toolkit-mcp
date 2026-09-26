// MCP adapter: dotenv and stdout handling belong here, never in Core.
console.log = console.error;
import 'dotenv/config';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createToolkit} from './src/core/index.js';
import {PINNED_TOOLS} from './src/adapters/mcp/surface.js';
const core=await createToolkit();
const server=new Server({name:'robinsons-toolkit',version:'2.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:PINNED_TOOLS}));
server.setRequestHandler(CallToolRequestSchema,async({params:{name,arguments:args={}}})=>{
  try{
    let result;
    switch(name){
      case 'search_toolkit':result=core.search(args.query,args.limit??8,{includeUnavailable:args.include_unavailable===true});break;
      case 'list_namespaces':result=core.doctor();break;
      case 'get_tool_schema':
        result=core.schema(args.tool_name);
        if(!result)throw Object.assign(new Error('Unknown capability: '+args.tool_name),{code:'UNKNOWN_TOOL'});
        break;
      case 'toolkit_result_read':result=core.results.read(args.id,{cursor:args.cursor,limit:args.limit});break;
      case 'toolkit_result_search':result=core.results.search(args.id,args.query,{cursor:args.cursor,limit:args.limit});break;
      case 'execute_tool':result=await core.execute(args.tool_name,args.args);break;
      default:
        // Existing directly pinned tool calls still work, but their schemas stay hidden.
        if(!core.schema(name))throw Object.assign(new Error('Unknown tool: '+name),{code:'UNKNOWN_TOOL'});
        result=await core.execute(name,args);
    }
    return {isError:result?.success===false||result?.operationFailed===true,content:[{type:'text',text:JSON.stringify(core.results.deliver(result))}]};
  }catch(error){return {isError:true,content:[{type:'text',text:JSON.stringify(core.errorResult(error))}]};}
});
await server.connect(new StdioServerTransport());
console.error(`Robinson's Toolkit: ${core.registry.length} catalog entries; ${PINNED_TOOLS.length} MCP broker tools; provider handlers load on demand.`);
