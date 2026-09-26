import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const bin=fileURLToPath(new URL('../bin/rt.js',import.meta.url));
function cli(args){const cwd=mkdtempSync(join(tmpdir(),'rt-cli-'));try{
 const p=spawnSync(process.execPath,[bin,...args],{cwd,env:{PATH:process.env.PATH,WORKSPACE_ROOT:cwd,DOTENV_CONFIG_PATH:join(cwd,'absent.env')},encoding:'utf8',timeout:15000});
 assert.equal(p.signal,null,p.stderr);return {status:p.status,body:JSON.parse(p.stdout)};
}finally{rmSync(cwd,{recursive:true,force:true});}}
test('CLI boots, discovers and executes local tools with zero secrets',()=>{
 for(const args of [['doctor','--json'],['auth','status','--json'],['namespaces'],['schema','stripe_list_customers'],['search','list directory'],['exec','local_list_directory','--json','{}']]){
  const r=cli(args);assert.equal(r.status,0,JSON.stringify(r));assert.equal(r.body.ok,true);
 }
 const r=cli(['mcp','inspect']);assert.equal(r.body.result.advertisedTools,6);assert.equal(r.body.result.providerSchemasAdvertisedDirectly,0);
});
test('CLI emits deterministic failure codes and valid JSON',()=>{
 assert.equal(cli(['exec','stripe_list_customers','--json','{}']).status,3);
 assert.equal(cli(['exec','not_a_tool','--json','{}']).status,2);
 assert.equal(cli(['exec','local_list_directory','--json','{']).status,2);
 assert.equal(cli(['exec','local_list_directory','--json','[]']).status,2);
 assert.equal(cli(['search','x','--limit','-1']).status,2);
 assert.equal(cli(['audit']).status,5);
});
test('CLI large result is readable from a separate invocation',()=>{
 const cwd=mkdtempSync(join(tmpdir(),'rt-cli-result-'));
 try{
  const run=args=>{
   const r=spawnSync(process.execPath,[bin,...args],{cwd,env:{PATH:process.env.PATH,WORKSPACE_ROOT:cwd,TOOLKIT_STATE_DIR:join(cwd,'state'),RT_MAX_INLINE_BYTES:'1024'},encoding:'utf8',timeout:15000});
   assert.equal(r.status,0,r.stdout);return JSON.parse(r.stdout).result;
  };
  const saved=run(['audit','duplicates']);assert.equal(saved.stored,true);
  const page=run(['result','read',saved.resultId,'--limit','500']);assert.equal(page.resultId,saved.resultId);assert.equal(page.nextCursor,500);
  const matches=run(['result','search',saved.resultId,'local_make_directory','--limit','1']);assert.equal(matches.matches.length,1);
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
