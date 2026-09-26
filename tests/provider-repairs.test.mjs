import test from 'node:test';
import assert from 'node:assert/strict';
import anthropic from '../handlers/anthropic.js';
import {readdirSync} from 'node:fs';
test('every provider module parses and imports without credentials',async()=>{
  for(const f of readdirSync(new URL('../handlers/',import.meta.url)).filter(f=>f.endsWith('.js'))) {
    const mod=await import(new URL('../handlers/'+f,import.meta.url));
    assert.equal(typeof mod.default.execute,'function',f);
  }
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
