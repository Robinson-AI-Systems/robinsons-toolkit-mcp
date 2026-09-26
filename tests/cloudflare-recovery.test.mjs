import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolkit} from '../src/core/index.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
const names=['cf_list_api_tokens','cf_verify_api_token','cf_get_email_routing'];
const zone='b'.repeat(32);
function setup(t){
  const previous=process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_API_TOKEN='test-only-recovery-token';
  t.after(()=>{if(previous===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=previous;});
  return createToolkit({credentials:new EnvironmentCredentials({CLOUDFLARE_API_TOKEN:'test-only-recovery-token'})});
}
test('restored Cloudflare reads execute through Core with pagination and lazy loading',async t=>{
  const core=await setup(t);
  assert.deepEqual(core.loadedNamespaces,[]);
  for(const name of names){
    assert.equal(core.schema(name).availability.state,'AVAILABLE');
    assert.ok(core.search(name,20).some(result=>result.name===name));
  }
  const calls=[];
  const tokens={success:true,result:[{id:'a'.repeat(32)}],result_info:{page:2,per_page:5,total_count:11}};
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    calls.push(url);assert.equal(init.method,'GET');assert.equal(init.body,undefined);
    assert.equal(init.headers.Authorization,'Bearer test-only-recovery-token');
    const path=new URL(url).pathname;
    if(path==='/client/v4/user/tokens')return new Response(JSON.stringify(tokens));
    if(path==='/client/v4/user/tokens/verify')return new Response(JSON.stringify({success:true,result:{status:'active'}}));
    if(path===`/client/v4/zones/${zone}/email/routing`)return new Response(JSON.stringify({success:true,result:{enabled:false}}));
    throw Error('Unexpected endpoint: '+url);
  });
  const listed=await core.execute(names[0],{page:2,per_page:5,direction:'desc',include_expired:false});
  assert.deepEqual(listed,tokens);
  assert.equal(calls[0],'https://api.cloudflare.com/client/v4/user/tokens?page=2&per_page=5&direction=desc&include_expired=false');
  assert.deepEqual(await core.execute(names[1]),{status:'active'});
  assert.deepEqual(await core.execute(names[2],{zone_id:zone}),{enabled:false});
  assert.equal(calls.length,3);assert.deepEqual(core.loadedNamespaces,['cloudflare']);
  assert.equal(core.schema('cf_enable_email_routing').availability.state,'DISABLED');
  assert.equal(core.schema('cf_get_all_zone_settings').availability.state,'DISABLED');
});
test('restored reads reject missing credentials and invalid inputs before HTTP',async t=>{
  const empty=await createToolkit({credentials:new EnvironmentCredentials({})});
  const core=await setup(t);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Unexpected network request');});
  for(const name of names){
    assert.equal(empty.schema(name).availability.state,'MISSING_CREDENTIALS');
    await assert.rejects(empty.execute(name),{code:'CAPABILITY_UNAVAILABLE'});
  }
  for(const args of [{page:0},{page:1.5},{per_page:51},{per_page:4},{direction:'sideways'},{include_expired:'false'}]){
    await assert.rejects(core.execute('cf_list_api_tokens',args));
  }
  for(const zone_id of ['../settings','', 'z'.repeat(32)])await assert.rejects(core.execute('cf_get_email_routing',{zone_id}));
  assert.equal(calls,0);assert.deepEqual(empty.loadedNamespaces,[]);
});
test('restored reads isolate authorization failures and preserve empty pages',async t=>{
  const core=await setup(t);
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({success:true,result:[],result_info:{page:1,per_page:20,total_count:0}})));
  assert.deepEqual((await core.execute('cf_list_api_tokens')).result,[]);
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({success:false,errors:[{message:'Permission denied'}]}),{status:403}));
  await assert.rejects(core.execute('cf_verify_api_token'),/Cloudflare 403/);
  assert.equal(core.schema('cf_list_api_tokens').availability.state,'AUTHORIZATION_REQUIRED');
  assert.equal(core.schema('local_list_directory').availability.state,'AVAILABLE');
});
