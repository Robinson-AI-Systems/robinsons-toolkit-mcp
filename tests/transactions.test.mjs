import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {withExecutionContext} from '../src/core/context.js';
import {appendReceipt,readLedger,withRollbackLease} from '../ledger.js';
import {rollbackTransaction} from '../src/core/transactions.js';
function fixture(t){const workspace=mkdtempSync(join(tmpdir(),'rt-tx-'));t.after(()=>rmSync(workspace,{recursive:true,force:true}));return workspace;}
const receipt=(name,reversible=true)=>appendReceipt({tool_name:name,args:{},result:{},transaction_id:'test-only-group',reversible,inverse:reversible?{tool:'test-only-inverse',args:{name}}:null});
test('rollback compensates in reverse order and never calls irreversible actions undone',async t=>{
 const workspace=fixture(t);
 await withExecutionContext({workspace},async()=>{
  receipt('first');receipt('email',false);receipt('last');const calls=[];
  const preview=await rollbackTransaction({transaction_id:'test-only-group',dry_run:true},()=>assert.fail('dry-run dispatch'));
  assert.equal(preview.will_reverse,2);assert.equal(readLedger()[0].rollback_state,undefined);
  const result=await rollbackTransaction({transaction_id:'test-only-group'},async(_,args)=>{calls.push(args.name);return {done:true};});
  assert.deepEqual(calls,['last','first']);assert.equal(result.success,false);assert.equal(result.reverted,0);assert.equal(result.compensated,2);assert.equal(result.skipped[0].status,'IRREVERSIBLE');
  assert.equal(readLedger().length,1);
 });
});
test('uncertain rollback outcomes stop dependent compensation and cannot be automatically retried',async t=>{
 const workspace=fixture(t);
 await withExecutionContext({workspace},async()=>{
  receipt('first');receipt('last');let calls=0;
  const result=await rollbackTransaction({transaction_id:'test-only-group'},async()=>{calls++;throw new Error('test-only interrupted connection');});
  assert.equal(result.failed,1);assert.equal(result.not_attempted.length,1);assert.equal(result.failed_details[0].operationMayHaveCompleted,true);
  const retry=await rollbackTransaction({transaction_id:'test-only-group',dry_run:true},()=>assert.fail());
  assert.equal(retry.unresolved.length,1);assert.equal(retry.will_reverse,0);assert.equal(calls,1);
  const blocked=await rollbackTransaction({transaction_id:'test-only-group'},()=>assert.fail('must not skip past an uncertain dependency'));assert.equal(blocked.success,false);
  await withRollbackLease(async()=>assert.rejects(rollbackTransaction({transaction_id:'test-only-group'},()=>assert.fail()),{code:'LEDGER_BUSY'}));
 });
});
test('transaction CLI lists real receipts and previews rollback without executing it',t=>{
 const workspace=fixture(t);
 withExecutionContext({workspace},()=>receipt('test-only-created'));
 const cli=new URL('../bin/rt.js',import.meta.url).pathname;
 const env={PATH:process.env.PATH,WORKSPACE_ROOT:workspace,TOOLKIT_STATE_DIR:join(workspace,'state')};
 const list=spawnSync(process.execPath,[cli,'tx','list','--json'],{env,encoding:'utf8'});
 assert.equal(list.status,0,list.stdout);assert.equal(JSON.parse(list.stdout).result[0].tool_name,'test-only-created');
 const dry=spawnSync(process.execPath,[cli,'tx','rollback','test-only-group','--dry-run','--json'],{env,encoding:'utf8'});
 assert.equal(dry.status,0,dry.stdout);assert.equal(JSON.parse(dry.stdout).result.dry_run,true);
});
