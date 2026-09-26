import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCatalog,withAliasWarning} from '../src/core/catalog.js';
import {createToolkit} from '../src/core/index.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('catalog rejects ambiguous, missing, chained and cross-provider aliases',()=>{
 const a={name:'a',namespace:'x'};
 for(const entries of [[a,a],[{...a,aliasOf:'missing'}],[{...a,aliasOf:'b'},{name:'b',namespace:'x',aliasOf:'a'}],[a,{name:'b',namespace:'y',aliasOf:'a'}]])assert.throws(()=>buildCatalog(entries));
 assert.equal(withAliasWarning([1],'old','new').value[0],1);
});
test('local aliases execute canonical operations while discovery returns only canonical names',async()=>{
 const previous=process.env.ALLOWED_WRITE_PATHS;
 const directory=mkdtempSync(join(tmpdir(),'rt-alias-'));
 process.env.ALLOWED_WRITE_PATHS=directory;
 try{
  const core=await createToolkit({credentials:new EnvironmentCredentials({})});
  const path=join(directory,'nested');
  const result=await core.execute('local_create_directory',{path});
  assert.ok(existsSync(path));assert.equal(result.canonicalName,'local_make_directory');assert.match(result.warnings[0],/Deprecated name/);
  const env_file=join(directory,'fixture.env');
  await core.execute('local_set_env',{key:'TEST_ONLY_KEY',value:'fixture',env_file});
  assert.match(readFileSync(env_file,'utf8'),/TEST_ONLY_KEY=fixture/);
  for(const [alias,canonical] of [['local_create_directory','local_make_directory'],['local_search_files','local_find_files'],['local_set_env','local_update_env_var']]){
   assert.equal(core.schema(alias).aliasOf,canonical);
   assert.ok(core.schema(canonical).aliases.includes(alias));
   assert.ok(!core.search(alias,20).some(t=>t.name===alias));
  }
  const found=await core.execute('local_search_files',{directory,contains:'TEST_ONLY_KEY'});
  assert.equal(found.canonicalName,'local_find_files');assert.ok(found.total>0);
 }finally{if(previous===undefined)delete process.env.ALLOWED_WRITE_PATHS;else process.env.ALLOWED_WRITE_PATHS=previous;rmSync(directory,{recursive:true,force:true});}
});
