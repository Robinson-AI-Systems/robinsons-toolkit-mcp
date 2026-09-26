import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeHandler as parseHandler,duplicateCandidates} from '../scripts/inventory.mjs';
const analyzeHandler=(source,file)=>parseHandler('async function execute(tool,args) {\n'+source+'\n}',file);
test('dispatch scanner understands aliases and ignores commented-out handlers',()=>{
  const out=analyzeHandler("// if(tool === 'fake') {}\nif(tool === 'local_make' || tool === 'local_create') { return mkdir(args.path); }",'fixture.js');
  assert.deepEqual(out.branches.map(b=>b.name),['local_make','local_create']);
  assert.equal(out.branches[0].implementationFingerprint,out.branches[1].implementationFingerprint);
});
test('detects fabricated tool results, but not legitimate browser mocking',()=>{
  const fake=analyzeHandler('const value = `[Tool ${b.name} called with: ${JSON.stringify(b.input)}]`;','fixture.js');
  assert.equal(fake.findings[0].rule,'fabricated-tool-result');
  assert.equal(analyzeHandler("if (tool === 'playwright_mock_route') { return page.route(pattern, handler); }",'fixture.js').findings.length,0);
});
test('overlap alone cannot silently merge primitives and workflows',()=>{
  const branches=analyzeHandler("if(tool === 'create_branch'){return api('/branches');} if(tool === 'scaffold'){const b=await api('/branches'); return configure(b);}",'fixture.js').branches;
  const entries=branches.map(b=>({name:b.name,description:'Create a branch',inputSchema:{}}));
  const result=duplicateCandidates({branches,entries});
  assert.ok(result.every(x=>!x.autoMerge&&x.confidence!=='high'));
});
