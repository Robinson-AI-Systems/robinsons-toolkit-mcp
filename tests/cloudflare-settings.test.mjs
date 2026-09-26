import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolkit} from '../src/core/index.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
const zone='a'.repeat(32);
async function coreFor(t){
 const old=process.env.CLOUDFLARE_API_TOKEN;process.env.CLOUDFLARE_API_TOKEN='test-only-settings';
 t.after(()=>{if(old===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=old;});
 return createToolkit({credentials:new EnvironmentCredentials({CLOUDFLARE_API_TOKEN:'test-only-settings'})});
}
test('settings migration uses individual endpoints and preserves requested order with bounded concurrency',async t=>{
 const core=await coreFor(t);let active=0,peak=0;const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  assert.equal(init.method,'GET');const prefix=`https://api.cloudflare.com/client/v4/zones/${zone}/settings/`;
  assert.ok(url.startsWith(prefix));const id=url.slice(prefix.length);calls.push(id);active++;peak=Math.max(peak,active);
  await new Promise(resolve=>setImmediate(resolve));active--;
  return new Response(JSON.stringify({success:true,result:{id,value:'on'}}));
 });
 const ids=['ssl','http2','brotli','min_tls_version','always_use_https','ssl'];
 const result=await core.execute('cf_get_zone_settings',{zone_id:zone,setting_ids:ids});
 assert.deepEqual(result.settings.map(s=>s.id),ids.slice(0,5));
 assert.equal(calls.length,5);assert.ok(peak<=4);assert.equal(result.complete,true);
 assert.equal(result.scope,'explicitly-requested-settings');
 const alias=await core.execute('cf_get_all_zone_settings',{zone_id:zone,setting_ids:['ssl']});
 assert.match(alias.warnings[0],/Deprecated name/);
 assert.ok(!core.search('zone settings',20).some(t=>t.name==='cf_get_all_zone_settings'));
 assert.equal(core.schema('cf_get_all_zone_settings').aliasOf,'cf_get_zone_settings');
});
test('missing selection and unsafe setting IDs never call the deprecated bulk endpoint',async t=>{
 const core=await coreFor(t);let calls=0;
 t.mock.method(globalThis,'fetch',()=>{calls++;throw Error('Unexpected HTTP');});
 for(const setting_ids of [undefined,[],['../ssl'],['ssl?x=y'],Array(51).fill('ssl'),[null]]){
  await assert.rejects(core.execute('cf_get_zone_settings',{zone_id:zone,setting_ids}));
 }
 assert.equal(calls,0);
});
test('settings migration fails honestly for denied or malformed upstream reads',async t=>{
 const core=await coreFor(t);
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({success:true,result:{id:'ssl'}})));
 await assert.rejects(core.execute('cf_get_zone_settings',{zone_id:zone,setting_ids:['ssl']}),/invalid setting response/);
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({success:false,errors:[{message:'Denied'}]}),{status:403}));
 await assert.rejects(core.execute('cf_get_all_zone_settings',{zone_id:zone,setting_ids:['ssl']}),/403/);
 assert.equal(core.schema('cf_get_zone_settings').availability.state,'AUTHORIZATION_REQUIRED');
});
