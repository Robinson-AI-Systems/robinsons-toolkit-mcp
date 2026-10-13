import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createToolkit} from '../src/core/index.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
const env={SLACK_BOT_TOKEN:'test-only-bot-token',SLACK_ADMIN_TOKEN:'test-only-admin-token',SENTRY_AUTH_TOKEN:'test-only-sentry',SENTRY_ORG_SLUG:'fixture-org'};
async function fixture(t,{configured=env,deny=[]}={}){
 const workspace=mkdtempSync(join(tmpdir(),'rt-orphans-'));t.after(()=>rmSync(workspace,{recursive:true,force:true}));
 for(const [name,value] of Object.entries(env)){const old=process.env[name];process.env[name]=value;t.after(()=>{if(old===undefined)delete process.env[name];else process.env[name]=old;});}
 return createToolkit({profile:{name:'fixture',workspace,deniedCapabilities:deny},credentials:new EnvironmentCredentials(configured)});
}
test('Slack channel privacy uses admin endpoint/token and records a non-automatic rollback receipt',async t=>{
 const core=await fixture(t);let calls=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls++;assert.equal(url,'https://slack.com/api/admin.conversations.convertToPrivate');
  assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'Bearer test-only-admin-token');
  assert.equal(new URLSearchParams(init.body).get('channel_id'),'C123TEST');return Response.json({ok:true});
 });
 const value=await core.execute('slack_convert_channel_to_private',{channel:'C123TEST'});assert.equal(value.ok,true);assert.equal(calls,1);
 const receipts=core.transactions.list();assert.equal(receipts.length,1);assert.equal(receipts[0].reversible,false);assert.equal(receipts[0].inverse,null);
 assert.match(receipts[0].notes,/No validated automated inverse/);
});
test('bot-only credentials, denied profiles and malformed channel IDs cannot dispatch admin mutations',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;throw Error('unexpected HTTP');});
 const bot=await fixture(t,{configured:{SLACK_BOT_TOKEN:env.SLACK_BOT_TOKEN}});
 assert.equal(bot.schema('slack_convert_channel_to_private').availability.state,'MISSING_CREDENTIALS');
 await assert.rejects(bot.execute('slack_convert_channel_to_private',{channel:'C123TEST'}),{code:'CAPABILITY_UNAVAILABLE'});
 const denied=await fixture(t,{deny:['slack_convert_channel_to_private']});
 await assert.rejects(denied.execute('slack_convert_channel_to_private',{channel:'C123TEST'}),{code:'CAPABILITY_UNAVAILABLE'});
 const core=await fixture(t);await assert.rejects(core.execute('slack_convert_channel_to_private',{channel:'C123&other=1'}),{code:'INVALID_ARGUMENTS'});
 assert.equal(calls,0);
});
test('Slack missing-scope responses isolate admin authorization and create no success receipts',async t=>{
 const core=await fixture(t);t.mock.method(globalThis,'fetch',async()=>Response.json({ok:false,error:'missing_scope'}));
 await assert.rejects(core.execute('slack_convert_channel_to_private',{channel:'C123TEST'}),/missing_scope/);
 assert.equal(core.schema('slack_convert_channel_to_private').availability.state,'AUTHORIZATION_REQUIRED');
 assert.equal(core.schema('slack_send_message').availability.state,'AVAILABLE');assert.deepEqual(core.transactions.list(),[]);
});
test('Slack malformed success and failed HTTP responses do not create receipts',async t=>{
 const core=await fixture(t);
 for(const [body,status] of [[{},200],[{ok:true},500]]){
  t.mock.method(globalThis,'fetch',async()=>Response.json(body,{status}));
  await assert.rejects(core.execute('slack_convert_channel_to_private',{channel:'C123TEST'}));
 }
 assert.deepEqual(core.transactions.list(),[]);
});
test('Sentry orphan becomes a callable canonical alias without duplicating discovery',async t=>{
 const core=await fixture(t);const expected={id:'test-only-project',options:{'sentry:require_scrub_data':true}};
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  assert.equal(url,'https://sentry.io/api/0/projects/fixture-org/fixture-project/');assert.equal(init.method,'GET');return Response.json(expected);
 });
 const alias=await core.execute('sentry_get_project_data_scrubbing',{project_slug:'fixture-project'});
 assert.deepEqual(alias.options,expected.options);assert.equal(alias.canonicalName,'sentry_get_project');assert.ok(alias.warnings.length);
 const canonical=await core.execute('sentry_get_project',{project_slug:'fixture-project'});assert.deepEqual(canonical,expected);
 assert.ok(!core.search('sentry project data scrubbing',20).some(x=>x.name==='sentry_get_project_data_scrubbing'));
});
