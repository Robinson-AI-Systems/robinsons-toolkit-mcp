import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createToolkit} from '../src/core/index.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
import {createAuthenticatedHttpAdapter} from '../src/adapters/mcp/modern.js';
let Client,StdioClientTransport,StreamableHTTPClientTransport;
let reason;
try{
 if(Number(process.versions.node.split('.')[0])<20)throw new Error('Node.js 20 required');
 await import('@modelcontextprotocol/server');
 ({Client,StreamableHTTPClientTransport}=await import('@modelcontextprotocol/client'));
 ({StdioClientTransport}=await import('@modelcontextprotocol/client/stdio'));
}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND'&&!error.message.includes('Node.js 20 required'))throw error;reason='Modern MCP dependencies unavailable: '+error.message;}
for(const mode of ['legacy',{pin:'2026-07-28'}])test('optional stdio adapter supports '+JSON.stringify(mode),{skip:reason},async t=>{
 const workspace=mkdtempSync(join(tmpdir(),'rt-modern-'));t.after(()=>rmSync(workspace,{recursive:true,force:true}));
 writeFileSync(join(workspace,'large.txt'),'test-only-large-output '.repeat(2000));
 const transport=new StdioClientTransport({command:process.execPath,args:[new URL('../index.js',import.meta.url).pathname,'--modern'],cwd:workspace,env:{PATH:process.env.PATH,WORKSPACE_ROOT:workspace,TOOLKIT_STATE_DIR:join(workspace,'state'),DOTENV_CONFIG_PATH:join(workspace,'absent.env')},stderr:'pipe'});
 const client=new Client({name:'test-only-client',version:'1.0.0'},{versionNegotiation:{mode}});
 t.after(()=>client.close());
 await client.connect(transport);
 assert.equal(client.getProtocolEra(),mode==='legacy'?'legacy':'modern');
 const list=await client.listTools();assert.equal(list.tools.length,7);
 const result=await client.callTool({name:'execute_tool',arguments:{tool_name:'local_list_directory',args:{path:workspace}}});assert.equal(result.isError,false);
 const large=await client.callTool({name:'execute_tool',arguments:{tool_name:'local_read_file',args:{path:join(workspace,'large.txt')}}});
 const stored=JSON.parse(large.content[0].text);assert.equal(stored.stored,true);
 const page=await client.callTool({name:'toolkit_result_read',arguments:{id:stored.resultId,limit:4096}});assert.equal(page.isError,false);
 const unavailable=await client.callTool({name:'execute_tool',arguments:{tool_name:'stripe_list_customers',args:{}}});assert.equal(unavailable.isError,true);
});
test('HTTP adapter requires authorization and serves the modern protocol without a network listener',{skip:reason},async t=>{
 const core=await createToolkit({profile:null,credentials:new EnvironmentCredentials({})});
 await assert.rejects(createAuthenticatedHttpAdapter({core}),/authorization callback/);
 const brokenAuth=await createAuthenticatedHttpAdapter({core,authorize:()=>{throw new Error('test-only-sensitive-auth-detail');}});t.after(()=>brokenAuth.close());
 const unavailable=await brokenAuth.fetch(new Request('https://test.invalid/mcp'));assert.equal(unavailable.status,503);assert.equal(await unavailable.text(),'Authorization unavailable');
 let authorize=false;
 const adapter=await createAuthenticatedHttpAdapter({core,authorize:()=>authorize});t.after(()=>adapter.close());
 assert.equal((await adapter.fetch(new Request('https://test.invalid/mcp',{method:'POST'}))).status,401);
 authorize=true;
 const client=new Client({name:'test-only-http-client',version:'1.0.0'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});t.after(()=>client.close());
 const transport=new StreamableHTTPClientTransport(new URL('https://test.invalid/mcp'),{fetch:(url,init)=>adapter.fetch(new Request(url,init))});
 await client.connect(transport);
 assert.equal(client.getProtocolEra(),'modern');assert.equal((await client.listTools()).tools.length,7);
 const result=await client.callTool({name:'toolkit_transaction',arguments:{action:'list'}});assert.equal(result.isError,false);
 assert.deepEqual(core.loadedNamespaces,[]);
});
