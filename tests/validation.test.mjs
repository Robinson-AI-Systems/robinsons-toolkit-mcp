import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {loadRegistry} from '../src/core/registry.js';
import {toolkitRoot} from '../src/core/index.js';
import {routeToolCall} from '../src/core/executor.js';
test('all registered input schemas compile using the shared JSON Schema implementation',()=>{
 const ajv=new Ajv({strict:false});addFormats(ajv);
 for(const tool of loadRegistry(toolkitRoot))assert.doesNotThrow(()=>ajv.compile(tool.inputSchema),tool.name);
});
test('nested constraints and integer limits block dispatch without leaking values or coercing inputs',async()=>{
 let calls=0;const registry=[{name:'fixture_read',namespace:'fixture',inputSchema:{type:'object',required:['items'],additionalProperties:false,properties:{items:{type:'array',minItems:1,maxItems:2,uniqueItems:true,items:{type:'object',required:['count','id'],properties:{count:{type:'integer',minimum:1,maximum:3},id:{type:'string',pattern:'^[a-z]+$'}},additionalProperties:false}}}}}];
 const handlers={fixture:{execute:async(name,args)=>{calls++;return args;}}};
 for(const args of [{items:[]},{items:[{count:1.5,id:'a'}]},{items:[{count:'2',id:'a'}]},{items:[{count:4,id:'a'}]},{items:[{count:1,id:'PRIVATE-SECRET'}]},{items:[{count:1,id:'a'}],extra:true}]){
  await assert.rejects(routeToolCall('fixture_read',args,handlers,registry),error=>error.code==='INVALID_ARGUMENTS'&&!error.message.includes('PRIVATE-SECRET'));
 }
 assert.equal(calls,0);
 const args={items:[{count:2,id:'abc'}]};assert.deepEqual(await routeToolCall('fixture_read',args,handlers,registry),args);assert.equal(calls,1);
});
