import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

// Raw JSON-RPC avoids the SDK client's default inherited environment.
export async function probeMcp(root) {
  const workspace=mkdtempSync(join(tmpdir(),'rt-baseline-'));
  writeFileSync(join(workspace,'large.txt'),'bounded-output-test '.repeat(2000));
  const child=spawn(process.execPath,[join(root,'index.js')],{
    cwd:workspace,env:{PATH:process.env.PATH,WORKSPACE_ROOT:workspace,TOOLKIT_STATE_DIR:join(workspace,'state'),DOTENV_CONFIG_PATH:join(workspace,'absent.env')},
    stdio:['pipe','pipe','pipe']});
  let buffer='',stderr='',id=0;
  const pending=new Map();
  child.stderr.on('data',b=>{stderr+=b.toString();});
  child.stdout.on('data',b=>{
    buffer+=b.toString();
    let end;
    while((end=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      try{const msg=JSON.parse(line);const p=pending.get(msg.id);if(p){pending.delete(msg.id);clearTimeout(p.timer);p.resolve(msg);}}
      catch{for(const p of pending.values())p.reject(new Error('Non-JSON stdout: '+line));}
    }
  });
  const request=(method,params={})=>new Promise((resolve,reject)=>{
    const current=++id;
    const timer=setTimeout(()=>{pending.delete(current);reject(new Error(`Timeout: ${method}`));},10000);
    pending.set(current,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:current,method,params})+'\n');
  });
  try {
    const init=await request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'recovery-baseline',version:'1.0.0'}});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const list=await request('tools/list');
    const tools=list.result?.tools||[];
    const local=await request('tools/call',{name:'execute_tool',arguments:{tool_name:'local_list_directory',args:{path:workspace}}});
    const search=await request('tools/call',{name:'search_toolkit',arguments:{query:'search',limit:20}});
    const missing=await request('tools/call',{name:'execute_tool',arguments:{tool_name:'stripe_list_customers',args:{}}});
    const large=await request('tools/call',{name:'execute_tool',arguments:{tool_name:'local_read_file',args:{path:join(workspace,'large.txt')}}});
    const stored=JSON.parse(large.result.content[0].text);
    const page=stored.resultId?await request('tools/call',{name:'toolkit_result_read',arguments:{id:stored.resultId,limit:4096}}):null;
    const transactions=await request('tools/call',{name:'toolkit_transaction',arguments:{action:'list'}});
    const invalidBroker=await request('tools/call',{name:'search_toolkit',arguments:{query:'x',limit:1.5}});
    return {transactionListPassed:!!transactions.result&&!transactions.result.isError,invalidBrokerRejected:invalidBroker.result?.isError===true,largeOutputStored:stored.stored===true,resultReadPassed:!!page?.result&&!page.result.isError,booted:!!init.result,protocolVersion:init.result?.protocolVersion,advertisedToolCount:tools.length,
      advertisedSchemaBytes:Buffer.byteLength(JSON.stringify(tools)),advertisedNames:tools.map(t=>t.name),
      providerSchemasAdvertised:tools.filter(t=>!['search_toolkit','list_namespaces','get_tool_schema','execute_tool','toolkit_result_read','toolkit_result_search','toolkit_transaction'].includes(t.name)).length,
      localCallPassed:!!local.result&&!local.result.isError,missingStripeIsError:!!missing.result?.isError,
      noSecretSearch:search.result,stderr,providerLiveTests:'not run — credentials unavailable'};
  } finally {
    for(const p of pending.values())clearTimeout(p.timer);
    const ended=once(child,'exit');child.kill();await ended;
    rmSync(workspace,{recursive:true,force:true});
  }
}
