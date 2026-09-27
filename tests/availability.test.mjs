import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolkit} from '../src/core/index.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
import {CapabilityAvailability} from '../src/core/capabilities.js';
import {createHandlerLoader} from '../src/core/handlers.js';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('unreachable expansion capabilities are disabled even with credentials and excluded from discovery',async()=>{
  const core=await createToolkit({credentials:new EnvironmentCredentials({CLOUDFLARE_API_TOKEN:'test-only-cloudflare'})});
  assert.equal(core.schema('cf_enable_email_routing').availability.state,'DISABLED');
  assert.equal(core.schema('cf_list_zones').availability.state,'AVAILABLE');
  assert.ok(!core.search('cf_enable_email_routing',20).some(t=>t.name==='cf_enable_email_routing'));
  await assert.rejects(core.execute('cf_enable_email_routing',{zone_id:'test-only-zone'}),{code:'CAPABILITY_UNAVAILABLE'});
  assert.deepEqual(core.loadedNamespaces,[]);
});
test('zero secrets: discovery and schema never import handlers; execution is gated',async()=>{
  const core=await createToolkit({credentials:new EnvironmentCredentials({}),packageExists:()=>false});
  assert.deepEqual(core.loadedNamespaces,[]);
  assert.equal(core.schema('stripe_list_customers').availability.state,'MISSING_CREDENTIALS');
  assert.deepEqual(core.search('stripe'),[]);
  assert.ok(core.search('stripe',8,{includeUnavailable:true}).length);
  assert.ok(!core.search('search',20).some(t=>t.namespace==='search'));
  assert.equal(core.schema('playwright_goto').availability.state,'MISSING_CONFIGURATION');
  await assert.rejects(core.execute('stripe_list_customers'),{code:'CAPABILITY_UNAVAILABLE'});
  await assert.rejects(core.execute('unknown_capability'),{code:'UNKNOWN_TOOL'});
  assert.deepEqual(core.loadedNamespaces,[]);
  await core.execute('local_list_directory',{});
  assert.deepEqual(core.loadedNamespaces,['local']);
});
test('partial configuration respects subservice credentials and never reveals values',async()=>{
  const core=await createToolkit({credentials:new EnvironmentCredentials({BRAVE_SEARCH_API_KEY:'test-brave-secret',UPSTASH_API_KEY:'test-management-secret',UPSTASH_EMAIL:'test@example.invalid'})});
  assert.equal(core.schema('brave_web_search').availability.state,'AVAILABLE');
  assert.equal(core.schema('tavily_search').availability.state,'MISSING_CREDENTIALS');
  assert.equal(core.schema('upstash_list_redis_databases').availability.state,'AVAILABLE');
  assert.equal(core.schema('upstash_redis_get').availability.state,'MISSING_CREDENTIALS');
  assert.ok(!JSON.stringify(core.doctor()).includes('test-brave-secret'));
});
test('authorization health affects only the failing credential group',()=>{
  const metadata={a:{namespace:'x',requirements:[{credentials:['A'],configuration:[],packages:[]}],childTools:[]},b:{namespace:'y',requirements:[{credentials:['B'],configuration:[],packages:[]}],childTools:[]}};
  const state=new CapabilityAvailability(metadata,{credentials:new EnvironmentCredentials({A:'test-a',B:'test-b'})});
  state.recordFailure('a',new Error('Provider 401: unauthorized'));
  assert.equal(state.get('a').state,'AUTHORIZATION_REQUIRED');assert.equal(state.get('b').state,'AVAILABLE');
  state.clearHealth();assert.equal(state.get('a').state,'AVAILABLE');
});
test('broken lazy module does not prevent loading a separate namespace',async()=>{
 const root=mkdtempSync(join(tmpdir(),'rt-lazy-'));
 try{
  mkdirSync(join(root,'handlers'));writeFileSync(join(root,'package.json'),' {"type":"module"}');
  writeFileSync(join(root,'handlers','bad.js'),'invalid JavaScript {');
  writeFileSync(join(root,'handlers','good.js'),'export default {execute:async()=>42}');
  const loader=createHandlerLoader(root);
  await assert.rejects(loader.load('bad'),{code:'HANDLER_UNAVAILABLE'});
  const [a,b]=await Promise.all([loader.load('good'),loader.load('good')]);assert.equal(a,b);assert.equal(await a.execute(),42);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('native executable requirements disable only the affected capability',async()=>{
 const core=await createToolkit({profile:null,credentials:new EnvironmentCredentials({POSTGRES_CONNECTION_STRING:'postgres://test:test@fixture.invalid/test'}),packageExists:()=>false,binaryExists:()=>false});
 const status=core.schema('postgres_dump_schema').availability;
 assert.equal(status.state,'MISSING_CONFIGURATION');assert.deepEqual(status.requirements[0].missingBinaries,['pg_dump']);
 assert.equal(core.schema('local_list_directory').availability.state,'AVAILABLE');
 const configured=await createToolkit({profile:null,credentials:new EnvironmentCredentials({POSTGRES_CONNECTION_STRING:'postgres://test:test@fixture.invalid/test'}),packageExists:()=>false,binaryExists:()=>true});
 assert.equal(configured.schema('postgres_dump_schema').availability.state,'AVAILABLE');
 assert.equal(configured.schema('postgres_run_sql').availability.state,'MISSING_CONFIGURATION');
});
