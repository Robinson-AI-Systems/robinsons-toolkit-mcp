import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import compound from '../handlers/compound.js';
import {withExecutionContext} from '../src/core/context.js';
import {workspaceGit} from '../src/core/sandbox/git.js';
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'rt-git-test-'));const workspace=join(root,'workspace'),remote=join(root,'remote.git');mkdirSync(workspace);
 const run=(args,cwd=workspace)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 run(['init','--bare',remote],root);run(['init']);run(['config','user.name','Test Fixture']);run(['config','user.email','fixture@example.invalid']);run(['remote','add','origin',remote]);
 t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,workspace,run};
}
test('compound Git stages literal paths and commits literal messages without shell expansion',async t=>{
 const {workspace,run}=fixture(t);const name='file $(touch INJECTED).txt';writeFileSync(join(workspace,name),'actual fixture content');
 const message='literal $(touch INJECTED) `touch INJECTED` "commit"';
 const result=await withExecutionContext({workspace},()=>compound.execute('compound_git_commit_push',{files:[name],message}));
 assert.equal(result.success,true,JSON.stringify(result));assert.equal(existsSync(join(workspace,'INJECTED')),false);
 assert.equal(run(['log','-1','--format=%B']).trim(),message);assert.equal(run(['show','HEAD:'+name]),'actual fixture content');
});
test('Git hooks do not inherit toolkit provider credentials', {skip:process.platform==='win32'},async t=>{
 const {workspace}=fixture(t);const previous=process.env.STRIPE_SECRET_KEY;process.env.STRIPE_SECRET_KEY='test-only-compound-secret';
 t.after(()=>{if(previous===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=previous;});
 const captured=join(workspace,'hook-environment.json');
 writeFileSync(join(workspace,'.git','hooks','pre-commit'),'#!'+process.execPath+'\nrequire("node:fs").writeFileSync('+JSON.stringify(captured)+',JSON.stringify(process.env));',{mode:0o700});
 writeFileSync(join(workspace,'file.txt'),'fixture');
 const result=await withExecutionContext({workspace},()=>compound.execute('compound_git_commit_push',{files:'file.txt',message:'fixture'}));
 assert.equal(result.success,true,JSON.stringify(result));assert.equal(JSON.parse(readFileSync(captured,'utf8')).STRIPE_SECRET_KEY,undefined);
});
test('Git workspace preflight rejects traversal, symlink escapes and external linked metadata',t=>{
 const {root,workspace,run}=fixture(t);const other=join(root,'other');mkdirSync(other);run(['init'],other);
 withExecutionContext({workspace},()=>{
  assert.throws(()=>workspaceGit('../other'),/Write blocked/);
  symlinkSync(other,join(workspace,'escape'),'dir');assert.throws(()=>workspaceGit('escape'),/Write blocked/);
  const nested=join(workspace,'linked');mkdirSync(nested);writeFileSync(join(nested,'.git'),'gitdir: '+join(other,'.git')+'\n');
  assert.throws(()=>workspaceGit('linked'),/Write blocked/);
 });
});
