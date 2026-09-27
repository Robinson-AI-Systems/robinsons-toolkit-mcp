import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscovery} from '../src/core/discovery.js';
import {createToolkit} from '../src/core/index.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
test('indexed ranking combines rare terms, tags and exact aliases without returning alias rows',()=>{
 const index=createDiscovery([
  {name:'local_create_directory',namespace:'local',description:'Create a directory',aliases:['local_make_directory'],tags:['folder']},
  {name:'local_make_directory',namespace:'local',aliasOf:'local_create_directory'},
  {name:'provider_list_resources',namespace:'provider',description:'List resources in a directory folder'},
  {name:'provider_create_branch',namespace:'provider',description:'Create a database branch',tags:['postgres']}
 ]);
 assert.equal(index.size,3);
 assert.equal(index.search('local_make_directory')[0].tool.name,'local_create_directory');
 assert.equal(index.search('please create postgres branch')[0].tool.name,'provider_create_branch');
 assert.equal(index.search('folder',{accept:t=>t.namespace==='local'})[0].tool.name,'local_create_directory');
 assert.deepEqual(index.search('unmatchedword'),[]);
});
test('large catalogs remain bounded and ties are deterministic',()=>{
 const catalog=Array.from({length:10000},(_,i)=>({name:`provider_resource_${String(i).padStart(5,'0')}`,namespace:'provider',description:'Read resource metadata'}));
 const index=createDiscovery(catalog);
 assert.equal(index.search('read resource',{limit:5}).length,5);
 assert.equal(index.search('provider_resource_07891',{limit:1})[0].tool.name,'provider_resource_07891');
 assert.deepEqual(index.search('read resource',{limit:3}).map(r=>r.tool.name),index.search('read resource',{limit:3}).map(r=>r.tool.name));
});
test('Core discovery provides concise risk and match metadata without loading providers',async()=>{
 const core=await createToolkit({profile:null,credentials:new EnvironmentCredentials({})});
 const available=core.search('stripe customers');assert.ok(available.every(t=>t.availability.state==='AVAILABLE'));
 const all=core.search('stripe customers',5,{includeUnavailable:true});assert.ok(all.some(t=>t.namespace==='stripe'));
 assert.ok(all.every(t=>t.risk&&t.whyMatched&&t.inputSchema===undefined&&t.description.length<=240));
 assert.deepEqual(core.loadedNamespaces,[]);
});
