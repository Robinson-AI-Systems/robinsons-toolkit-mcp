import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createProcessHandlerLoader} from '../src/core/providers/process-loader.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
import {withExecutionContext,currentExecutionContext} from '../src/core/context.js';
import {createToolkit,toolkitRoot} from '../src/core/index.js';
function fixture(t,source){
 const root=mkdtempSync(join(tmpdir(),'rt-provider-test-'));mkdirSync(join(root,'handlers'));
 writeFileSync(join(root,'package.json'),'{"type":"module"}');writeFileSync(join(root,'handlers/example.js'),source);
 t.after(()=>rmSync(root,{recursive:true,force:true}));return root;
}
const fixtureEnv={TEST_PROVIDER_TOKEN:'test-only-account-a',UNRELATED_SECRET:'test-only-hidden'};
test('process scopes isolate concurrent account credentials, omit parent loaders, and refresh values',async t=>{
 const root=fixture(t,`const token=process.env.TEST_PROVIDER_TOKEN;export default {execute:async()=>({token,unrelated:process.env.UNRELATED_SECRET||null,options:process.env.NODE_OPTIONS||null})};`);
 const original=process.env.UNRELATED_SECRET;process.env.UNRELATED_SECRET='test-only-ambient';t.after(()=>{if(original===undefined)delete process.env.UNRELATED_SECRET;else process.env.UNRELATED_SECRET=original;});
 const make=env=>createProcessHandlerLoader(root,{credentials:new EnvironmentCredentials(env),scopes:{example_read:['TEST_PROVIDER_TOKEN']}});
 const first=make(fixtureEnv),second=make({...fixtureEnv,TEST_PROVIDER_TOKEN:'test-only-account-b'});
 assert.deepEqual(first.loadedNamespaces,[]);
 const [a,b]=await Promise.all([(await first.load('example')).execute('example_read',{}),(await second.load('example')).execute('example_read',{})]);
 assert.equal(a.token,'test-only-account-a');assert.equal(b.token,'test-only-account-b');assert.equal(a.unrelated,null);assert.equal(a.options,null);
 const rotating={TEST_PROVIDER_TOKEN:'test-only-before'};const loader=make(rotating),handler=await loader.load('example');
 assert.equal((await handler.execute('example_read',{})).token,'test-only-before');rotating.TEST_PROVIDER_TOKEN='test-only-after';
 assert.equal((await handler.execute('example_read',{})).token,'test-only-after');
 assert.throws(()=>createProcessHandlerLoader(root,{credentials:new EnvironmentCredentials({}),scopes:{example_read:['NODE_OPTIONS']}}),/Invalid provider/);
});
test('process dispatch retains parent Core context and propagates denied child errors safely',async t=>{
 const contextUrl=pathToFileURL(join(toolkitRoot,'src/core/context.js')).href;
 const root=fixture(t,`import {currentDispatcher,currentExecutionContext} from '${contextUrl}';export default {execute:async()=>({context:currentExecutionContext().transactionId,child:await currentDispatcher()('child_read',{})})};`);
 const loader=createProcessHandlerLoader(root,{credentials:new EnvironmentCredentials(fixtureEnv),scopes:{example_read:[]}});
 const invoke=async dispatch=>withExecutionContext({workspace:root,transactionId:'test-transaction',dispatch},async()=>(await loader.load('example')).execute('example_read',{}));
 const value=await invoke(async name=>{assert.equal(currentExecutionContext().transactionId,'test-transaction');assert.equal(name,'child_read');return 'child-ok';});
 assert.deepEqual(value,{context:'test-transaction',child:'child-ok'});
 await assert.rejects(invoke(async()=>{throw Object.assign(new Error('Denied test-only-account-a'),{code:'POLICY_DENIED'});}),e=>e.code==='POLICY_DENIED'&&!e.message.includes('test-only-account-a'));
});
test('process crashes, deadlines, log overflow and oversized results cannot report success',async t=>{
 const root=fixture(t,`export default {execute:async(name,args)=>{if(args.crash)process.exit(7);if(args.wait)await new Promise(resolve=>setTimeout(resolve,5000));if(args.log)console.log('test-only-account-a'.repeat(100));return args.large?'x'.repeat(10000):'ok';}};`);
 const loader=createProcessHandlerLoader(root,{credentials:new EnvironmentCredentials(fixtureEnv),scopes:{example_read:[]},timeoutMs:1500,maxMessageBytes:2048,maxLogBytes:50});
 const handler=await loader.load('example');
 for(const [args,code] of [[{crash:true},'PROVIDER_EXITED'],[{wait:true},'PROVIDER_TIMEOUT'],[{log:true},'PROVIDER_LOG_LIMIT'],[{large:true},'PROVIDER_RESULT_TOO_LARGE']]){
  await assert.rejects(handler.execute('example_read',args),e=>e.code===code&&e.operationMayHaveCompleted&&!e.message.includes('test-only-account-a'));
 }
 assert.equal(await handler.execute('example_read',{}),'ok');
 await assert.rejects(handler.execute('example_read',{oversized:'x'.repeat(5000)}),e=>e.code==='PROVIDER_REQUEST_TOO_LARGE'&&!e.operationMayHaveCompleted);
});
test('Core process selection executes a real local read without secrets or startup imports',async t=>{
 const workspace=mkdtempSync(join(tmpdir(),'rt-real-process-'));t.after(()=>rmSync(workspace,{recursive:true,force:true}));
 writeFileSync(join(workspace,'readme.txt'),'real filesystem');
 const core=await createToolkit({credentials:new EnvironmentCredentials({}),profile:{name:'process-test',workspace},providerExecution:{scopes:{local_list_directory:[]}}});
 assert.deepEqual(core.loadedNamespaces,[]);core.schema('local_list_directory');core.search('list directory');assert.deepEqual(core.loadedNamespaces,[]);
 const result=await core.execute('local_list_directory',{path:workspace});assert.match(JSON.stringify(result),/readme.txt/);
 assert.deepEqual(core.loadedNamespaces,['local']);
 await assert.rejects(createToolkit({profile:null,providerExecution:{scopes:{missing_tool:[]}}}),/existing canonical/);
});
test('real compound handler calls supplied Core dispatcher across process boundary',async()=>{
 const loader=createProcessHandlerLoader(toolkitRoot,{credentials:new EnvironmentCredentials({}),scopes:{compound_project_health_check:[]}});
 const calls=[];
 const result=await withExecutionContext({workspace:toolkitRoot,transactionId:'test-compound',dispatch:async name=>{calls.push(name);return []; }},async()=>(await loader.load('compound')).execute('compound_project_health_check',{github_owner:'test-only',github_repo:'test-only'}));
 assert.deepEqual(calls.sort(),['github_list_issues','github_list_pull_requests']);assert.deepEqual(result.health.github,{open_issues:0,open_prs:0});
});
test('Core profile denial is enforced for process child calls and provider HTTP status survives',async t=>{
 const contextUrl=pathToFileURL(join(toolkitRoot,'src/core/context.js')).href;
 const root=fixture(t,`import {currentDispatcher} from '${contextUrl}';export default {execute:async(name)=>{if(name==='example_workflow')return currentDispatcher()('example_child',{});throw Object.assign(new Error('Access denied'),{status:401});}};`);
 mkdirSync(join(root,'registry'));mkdirSync(join(root,'src/core'),{recursive:true});
 const names=['example_workflow','example_child'];
 writeFileSync(join(root,'registry/example.json'),JSON.stringify(names.map(name=>({name,namespace:'example',description:'Test fixture',inputSchema:{type:'object',properties:{}}}))));
 writeFileSync(join(root,'src/core/capability-metadata.json'),JSON.stringify({capabilities:Object.fromEntries(names.map(name=>[name,{namespace:'example',requirements:[{credentials:[],configuration:[],packages:[]}],childTools:[]}]))}));
 const core=await createToolkit({root,credentials:new EnvironmentCredentials({}),profile:{name:'deny-child',workspace:root,deniedCapabilities:['example_child']},providerExecution:{scopes:{example_workflow:[],example_child:[]}}});
 await assert.rejects(core.execute('example_workflow',{}),e=>e.code==='CAPABILITY_UNAVAILABLE');
 const allowed=await createToolkit({root,credentials:new EnvironmentCredentials({}),profile:{name:'allowed',workspace:root},providerExecution:{scopes:{example_child:[]}}});
 await assert.rejects(allowed.execute('example_child',{}),/Access denied/);
 assert.equal(allowed.schema('example_child').availability.state,'AUTHORIZATION_REQUIRED');
});
test('timed-out workflows report uncertainty while already dispatched children can still finish',async t=>{
 const contextUrl=pathToFileURL(join(toolkitRoot,'src/core/context.js')).href;
 const root=fixture(t,`import {currentDispatcher} from '${contextUrl}';export default {execute:async()=>currentDispatcher()('child_mutate',{})};`);
 const loader=createProcessHandlerLoader(root,{credentials:new EnvironmentCredentials({}),scopes:{example_read:[]},timeoutMs:1500});
 let release,started,finished=false;
 const ready=new Promise(resolve=>{started=resolve;});
 const gate=new Promise(resolve=>{release=resolve;});
 const operation=withExecutionContext({workspace:root,dispatch:async()=>{started();await gate;finished=true;return 'completed';}},async()=>(await loader.load('example')).execute('example_read',{}));
 await ready;
 await assert.rejects(operation,e=>e.code==='PROVIDER_TIMEOUT'&&e.operationMayHaveCompleted);
 assert.equal(finished,false);release();await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,true);
});
