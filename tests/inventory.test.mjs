import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeHandler as parseHandler,duplicateCandidates} from '../scripts/inventory.mjs';
const analyzeHandler=(source,file)=>parseHandler('async function execute(tool,args) {\n'+source+'\n}',file);
test('dispatch after unconditional termination is reported without misclassifying guarded returns',()=>{
  for (const terminal of ["throw new Error('Unknown tool');", 'return null;']) {
    const result = analyzeHandler(`if(tool === 'working'){ return api(); } ${terminal} if(tool === 'broken'){ return api(); }`, 'fixture.js');
    assert.equal(result.branches[0].unreachable, false);
    assert.equal(result.branches[1].unreachable, true);
    assert.deepEqual(result.findings.map(f=>[f.rule,f.name]), [['unreachable-dispatch','broken']]);
  }
});
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
test('different names and parameter variables reveal the same endpoint without automatically merging',()=>{
 const branches=analyzeHandler("if(tool==='get_widget'){return api('GET',`/widgets/${args.widget_id}`);} if(tool==='fetch_widget'){return api('GET',`/widgets/${args.id}`);} if(tool==='delete_widget'){return api('DELETE',`/widgets/${args.id}`);}",'fixture.js').branches;
 const entries=branches.map(b=>({name:b.name,description:b.name,inputSchema:{type:'object',properties:{id:{type:'string'}}}}));
 const results=duplicateCandidates({branches,entries});
 const same=results.find(r=>r.tools.includes('get_widget')&&r.tools.includes('fetch_widget'));
 assert.equal(same.classification,'same-endpoint-candidate');assert.equal(same.autoMerge,false);assert.ok(same.comparison.sharedEndpoints.includes('GET /widgets/{parameter}'));
 assert.ok(!results.some(r=>r.tools.includes('delete_widget')));
});
test('schema property subsets and workflow composition remain review evidence, not aliases',()=>{
 const branches=analyzeHandler("if(tool==='primitive'){return api('GET','/widgets');} if(tool==='filtered'){return api('GET','/widgets',args);} if(tool==='workflow'){return provider.execute('primitive',args);}",'fixture.js').branches;
 const entries=branches.map(b=>({name:b.name,description:b.name,inputSchema:{type:'object',properties:b.name==='filtered'?{filter:{type:'string'}}:{}}}));
 const results=duplicateCandidates({branches,entries});
 assert.equal(results.find(r=>r.classification==='same-endpoint-candidate').comparison.schemaRelation,'A_PROPERTIES_SUBSET');
 const workflow=results.find(r=>r.classification==='primitive-workflow-overlap');assert.deepEqual(workflow.tools,['primitive','workflow']);assert.equal(workflow.autoMerge,false);
});
