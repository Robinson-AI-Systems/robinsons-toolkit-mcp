import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadRegistry} from '../src/core/registry.js';
import {toolkitRoot,createToolkit} from '../src/core/index.js';
import {routeToolCall} from '../src/core/executor.js';
import {PINNED_TOOLS} from '../src/adapters/mcp/surface.js';
import {probeMcp} from '../scripts/probe-mcp.mjs';
const baseline=JSON.parse(readFileSync(new URL('../reports/recovery/baseline.json',import.meta.url)));
const registry=loadRegistry(toolkitRoot);
test('catalog preserves every registry name while MCP advertises only brokers',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../reports/recovery/capability-manifest.json',import.meta.url)));
  const currentNames = new Set(registry.map(t=>t.name));
  assert.equal(currentNames.size, registry.length);
  for (const original of manifest) assert.ok(currentNames.has(original.name), `Missing original capability: ${original.name}`);
  assert.deepEqual(PINNED_TOOLS.slice(0,4).map(t=>t.name),baseline.runtime.advertisedNames.slice(0,4));
  assert.ok(Buffer.byteLength(JSON.stringify(PINNED_TOOLS))<baseline.runtime.advertisedSchemaBytes);
});
test('shared executor validates before dispatch and preserves special namespaces',async()=>{
  const calls=[];
  const handler={execute:async(name,args)=>{calls.push(name);return {name,args};}};
  await assert.rejects(routeToolCall('github_create_branch',{}, {github:handler},registry),/Missing required/);
  assert.equal(calls.length,0);
  for(const [name,ns] of [['gmail_list_messages','google'],['brave_web_search','search'],['cf_list_zones','cloudflare']]) {
    const result=await routeToolCall(name,{query:'test'}, {[ns]:handler},registry);
    assert.equal(result.name,name);
  }
});
test('shared executor preserves inverse receipts',async()=>{
  const receipts=[];
  await routeToolCall('github_create_branch',{owner:'fixture',repo:'fixture',branch:'fixture'},
    {github:{execute:async()=>({object:{sha:'test-only'}})}},registry,{appendReceipt:r=>receipts.push(r)});
  assert.equal(receipts[0].inverse.tool,'github_delete_branch');
  assert.equal(receipts[0].inverse.args.branch,'fixture');
});
test('MCP boots without optional secrets and advertises only brokers',async()=>{
  const r=await probeMcp(toolkitRoot);
  assert.equal(r.largeOutputStored,true);assert.equal(r.resultReadPassed,true);
  assert.equal(r.booted,true);assert.equal(r.localCallPassed,true);assert.equal(r.missingStripeIsError,true);
  assert.ok(r.advertisedSchemaBytes<baseline.runtime.advertisedSchemaBytes);
  assert.equal(r.advertisedToolCount,6);
});
test('core supports execution and discovery independently of MCP',async()=>{
  const core=await createToolkit();
  assert.ok(core.schema('local_list_directory'));
  assert.ok(core.search('list directory').some(t=>t.name==='local_list_directory'));
  const result=await core.execute('local_list_directory',{path:toolkitRoot});
  assert.ok(result);
});
