import test from 'node:test';
import assert from 'node:assert/strict';
import anthropic from '../handlers/anthropic.js';
import cloudflare from '../handlers/cloudflare.js';
import slack from '../handlers/slack.js';
import {createToolkit} from '../src/core/index.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
import {readdirSync} from 'node:fs';
test('every provider module parses and imports without credentials',async()=>{
  for(const f of readdirSync(new URL('../handlers/',import.meta.url)).filter(f=>f.endsWith('.js'))) {
    const mod=await import(new URL('../handlers/'+f,import.meta.url));
    assert.equal(typeof mod.default.execute,'function',f);
  }
});

test('recovered Cloudflare token metadata capability gates credentials and validates requests', async t => {
  const old = process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_API_TOKEN = 'test-only-cloudflare';
  t.after(() => { if (old === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = old; });
  const unconfigured = await createToolkit({credentials:new EnvironmentCredentials({})});
  assert.equal(unconfigured.schema('cf_get_api_token').availability.state, 'MISSING_CREDENTIALS');
  await assert.rejects(unconfigured.execute('cf_get_api_token', {token_id:'a'.repeat(32)}), {code:'CAPABILITY_UNAVAILABLE'});
  assert.deepEqual(unconfigured.loadedNamespaces, []);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++;
    assert.equal(url, `https://api.cloudflare.com/client/v4/user/tokens/${'a'.repeat(32)}`);
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, 'Bearer test-only-cloudflare');
    return new Response(JSON.stringify({success:true,result:{id:'a'.repeat(32),status:'active'}}));
  });
  for (const token_id of ['', '../verify', 'z'.repeat(32)]) {
    await assert.rejects(cloudflare.execute('cf_get_api_token', {token_id}), /token_id/);
  }
  assert.equal(calls, 0);
  const configured = await createToolkit({credentials:new EnvironmentCredentials({CLOUDFLARE_API_TOKEN:'test-only-cloudflare'})});
  assert.equal((await configured.execute('cf_get_api_token',{token_id:'a'.repeat(32)})).status, 'active');
  assert.equal(calls, 1);
});

test('Cloudflare HTTP failures cannot be returned as successful tool results', async t => {
  const old = process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_API_TOKEN = 'test-only-cloudflare';
  t.after(() => { if (old === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = old; });
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', {status:403,statusText:'Forbidden'}));
  await assert.rejects(cloudflare.execute('cf_get_api_token',{token_id:'a'.repeat(32)}), /Cloudflare 403/);
});

test('retired Slack setActive orphan never sends a nonfunctional API request', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request'); });
  await assert.rejects(slack.execute('slack_set_user_active',{}), /Unknown Slack tool/);
});
test('Anthropic returns tool requests without inventing results or retrying',async t=>{
  const old=process.env.ANTHROPIC_API_KEY;process.env.ANTHROPIC_API_KEY='test-only-key';
  t.after(()=>{if(old===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=old;});
  const bodies=[];
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    assert.equal(url,'https://api.anthropic.com/v1/messages');bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({content:[{type:'tool_use',id:'test-only-id',name:'read',input:{path:'x'}}],stop_reason:'tool_use'}));
  });
  const result=await anthropic.execute('anthropic_message_with_tools',{user_message:'read x',tools:[{name:'read',input_schema:{type:'object'}}],max_turns:3});
  assert.equal(bodies.length,1);assert.equal(result.pending_tool_calls.length,1);
  assert.equal(result.final_response,null);
  assert.equal(result.messages.length,2);
  assert.ok(!JSON.stringify(bodies).includes('tool_result'));
});
