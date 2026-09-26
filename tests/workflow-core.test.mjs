import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createToolkit} from '../src/core/index.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
function workspace(t){const dir=mkdtempSync(join(tmpdir(),'rt-workflow-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function receipt(dir,inverse){writeFileSync(join(dir,'.toolkit-ledger.jsonl'),JSON.stringify({id:'test-only-receipt',timestamp:new Date().toISOString(),tool_name:'test-only-original',reversible:true,rolled_back:false,inverse})+'\n');}
test('dynamic compound child dispatch cannot bypass a profile deny rule',async t=>{
 const dir=workspace(t);receipt(dir,{tool:'local_write_file',args:{path:'blocked.txt',content:'must not write'}});
 const core=await createToolkit({credentials:new EnvironmentCredentials({}),profile:{name:'restricted',workspace:dir,allowedCapabilities:['compound_rollback_transaction']}});
 const result=await core.execute('compound_rollback_transaction',{last_n:1});
 assert.equal(result.success,false);assert.equal(result.reversed,0);assert.equal(result.failed,1);
 assert.equal(existsSync(join(dir,'blocked.txt')),false);
 assert.equal(JSON.parse(readFileSync(join(dir,'.toolkit-ledger.jsonl'),'utf8')).rolled_back,false);
 assert.deepEqual(core.loadedNamespaces,['compound']);
});
test('workflow intermediates stay raw while the final response goes through bounded result storage',async t=>{
 const dir=workspace(t);const content='actual-read-data '.repeat(200);writeFileSync(join(dir,'large.txt'),content);
 receipt(dir,{tool:'local_read_file',args:{path:'large.txt'}});
 const core=await createToolkit({credentials:new EnvironmentCredentials({}),profile:{name:'read',workspace:dir},resultOptions:{directory:join(dir,'results'),inlineBytes:1024}});
 const result=await core.execute('compound_rollback_transaction',{last_n:1});
 assert.equal(result.stored,true);
 const stored=JSON.parse(core.results.read(result.resultId,{limit:16384}).content);
 assert.equal(stored.executed[0].result.content,content);
 assert.equal(stored.executed[0].result.stored,undefined);
});
test('Core child operations share one transaction ID and preserve separate receipts',async t=>{
 const root=workspace(t);mkdirSync(join(root,'registry'));mkdirSync(join(root,'handlers'));mkdirSync(join(root,'src','core'),{recursive:true});
 writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));
 const contextUrl=new URL('../src/core/context.js',import.meta.url).href;
 writeFileSync(join(root,'handlers','compound.js'),`import {currentDispatcher} from ${JSON.stringify(contextUrl)};export default {async execute(){const call=currentDispatcher();await call('github_create_branch',{owner:'test',repo:'test',branch:'one'});await call('github_create_branch',{owner:'test',repo:'test',branch:'two'});return {success:true};}};`);
 writeFileSync(join(root,'handlers','github.js'),`export default {async execute(name,args){return {object:{sha:'test-only-sha'},name:args.branch};}};`);
 const entries=[{name:'compound_test',namespace:'compound',inputSchema:{type:'object'}},{name:'github_create_branch',namespace:'github',inputSchema:{type:'object'}}];
 writeFileSync(join(root,'registry','fixture.json'),JSON.stringify(entries));
 const capabilities=Object.fromEntries(entries.map(e=>[e.name,{namespace:e.namespace,requirements:[{credentials:[],configuration:[],packages:[]}],childTools:[]}])) ;
 writeFileSync(join(root,'src','core','capability-metadata.json'),JSON.stringify({capabilities}));
 const core=await createToolkit({root,credentials:new EnvironmentCredentials({}),profile:{name:'test',workspace:root}});
 await core.execute('compound_test');
 const receipts=readFileSync(join(root,'.toolkit-ledger.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(receipts.length,2);assert.ok(receipts[0].transaction_id);assert.equal(receipts[0].transaction_id,receipts[1].transaction_id);
 assert.notEqual(receipts[0].id,receipts[1].id);
});
