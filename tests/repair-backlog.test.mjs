import test from 'node:test';
import assert from 'node:assert/strict';
import {integrityItems,compareIntegrity,buildRepairBacklog} from '../scripts/repair-backlog.mjs';
const data=()=>({findings:[{file:'handlers/example.js',line:10,rule:'unreachable-dispatch',name:'example_read'}],mismatches:{registryWithoutHandler:[],handlerWithoutRegistry:[]},duplicateNames:[],repeatedDispatchNames:[],entries:[{name:'example_read',registryNamespace:'example'}],branches:[{name:'example_read',file:'handlers/example.js',unreachable:true,implementationFingerprint:'test-only'}]});
test('integrity ratchet ignores line drift but catches renamed, new and repeated defects',()=>{
 const before=data(),after=data();after.findings[0].line=400;
 assert.deepEqual(compareIntegrity(integrityItems(after),integrityItems(before)),{introduced:[],resolved:[]});
 after.findings.push({...after.findings[0]});assert.equal(compareIntegrity(integrityItems(after),integrityItems(before)).introduced[0].count,1);
 after.findings[0].name='example_new';assert.equal(compareIntegrity(integrityItems(after),integrityItems(before)).introduced.length,1);
 assert.equal(compareIntegrity([],integrityItems(before)).resolved.length,1);
});
test('repair matrix cannot turn a dispatch match into certification and includes orphan defects',()=>{
 const source=data();source.mismatches.handlerWithoutRegistry.push('example_orphan');
 const report=buildRepairBacklog(source,{capabilities:{example_read:{}},sources:{}});
 assert.equal(report.summary.integrityItems,2);
 assert.equal(report.capabilities[0].structural,'UNREACHABLE');
 assert.equal(report.capabilities[0].contractVerification,'UNREVIEWED');
 assert.equal(report.capabilities[0].liveVerification,'NOT_RUN');
 assert.equal(report.groups.some(g=>g.names.includes('example_orphan')),true);
 source.branches[0].unreachable=false;
 assert.equal(buildRepairBacklog(source,{capabilities:{},sources:{}}).capabilities[0].structural,'RESOLVED_NOT_CERTIFIED');
});
