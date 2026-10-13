import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withExecutionContext} from '../src/core/context.js';
import {appendReceipt,readLedger,markRolledBack} from '../ledger.js';
import {routeToolCall} from '../src/core/executor.js';
import {inverses} from '../inverses.js';
const entry={tool_name:'test-only-mutation',args:{},result:{id:'test-only-resource'},inverse:null,reversible:false};
function fixture(t){const workspace=mkdtempSync(join(tmpdir(),'rt-ledger-'));t.after(()=>rmSync(workspace,{recursive:true,force:true}));return workspace;}
test('ledger rollback marks append events and historical receipts remain readable',t=>{
 const workspace=fixture(t);
 withExecutionContext({workspace},()=>{
  const first=appendReceipt({...entry,transaction_id:'test-only-transaction'});
  const path=join(workspace,'.toolkit-ledger.jsonl'),before=readFileSync(path,'utf8');
  assert.equal(markRolledBack(first.id),1);assert.equal(markRolledBack(first.id),0);
  assert.ok(readFileSync(path,'utf8').startsWith(before));
  assert.equal(readLedger().length,0);assert.equal(readLedger({transaction_id:first.transaction_id,include_rolled_back:true})[0].rolled_back,true);
  assert.equal(statSync(path).mode&0o777,0o600);
  assert.throws(()=>readLedger({limit:-1}),/limit/);
 });
});
test('ledger rejects symlinks, corruption and competing writers',t=>{
 const workspace=fixture(t),path=join(workspace,'.toolkit-ledger.jsonl'),outside=join(workspace,'outside');
 writeFileSync(outside,'must stay unchanged');symlinkSync(outside,path);
 withExecutionContext({workspace},()=>{
  assert.throws(()=>appendReceipt(entry));assert.throws(()=>readLedger());assert.equal(readFileSync(outside,'utf8'),'must stay unchanged');
  rmSync(path);writeFileSync(path,'{broken}\n');assert.throws(()=>readLedger(),/Corrupt ledger/);assert.throws(()=>appendReceipt(entry),/Corrupt ledger/);
  writeFileSync(path+'.lock','');assert.throws(()=>appendReceipt(entry),{code:'LEDGER_BUSY'});
 });
});
test('receipt failures report completed side effects and failed operations do not receive inverse receipts',async()=>{
 const registry=[{name:'github_create_branch',namespace:'github',inputSchema:{type:'object'}}];
 let calls=0,receipts=0;
 const handler={execute:async()=>{calls++;return {name:'test-only-branch'};}};
 await assert.rejects(routeToolCall('github_create_branch',{}, {github:handler},registry,{appendReceipt(){throw new Error('test-only disk failure');}}),e=>e.code==='LEDGER_WRITE_FAILED'&&e.operationMayHaveCompleted);
 assert.equal(calls,1);
 const result=await routeToolCall('github_create_branch',{}, {github:{execute:async()=>({success:false})}},registry,{appendReceipt(){receipts++;}});
 assert.equal(result.success,false);assert.equal(receipts,0);
 assert.equal(inverses.github_create_or_update_file({}, {content:{sha:'test-only-sha'}}).reversible,false);
});
