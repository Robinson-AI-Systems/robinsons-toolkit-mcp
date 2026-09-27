import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,statSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareSchemaPush,writeDatabaseEnvironment} from '../src/core/sandbox/project-migration.js';
import {withExecutionContext} from '../src/core/context.js';
import compound from '../handlers/compound.js';
function fixture(t,script){
 const workspace=mkdtempSync(join(tmpdir(),'rt-migration-'));t.after(()=>rmSync(workspace,{recursive:true,force:true}));
 if(script){const dir=join(workspace,'node_modules','prisma');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'package.json'),JSON.stringify({name:'prisma',bin:{prisma:'cli.cjs'}}));writeFileSync(join(dir,'cli.cjs'),script);}
 return workspace;
}
const database='postgresql://fixture:test-only-database-password@fixture.invalid/db';
test('fixed schema push grants only its database credential and does not invoke a shell',t=>{
 const workspace=fixture(t,'process.stdout.write(JSON.stringify({args:process.argv.slice(2),env:process.env}));');
 const previous=process.env.NEON_API_KEY;process.env.NEON_API_KEY='test-only-control-plane-secret';
 t.after(()=>{if(previous===undefined)delete process.env.NEON_API_KEY;else process.env.NEON_API_KEY=previous;});
 withExecutionContext({workspace},()=>{
  const output=JSON.parse(prepareSchemaPush()(database));assert.deepEqual(output.args,['db','push']);
  assert.equal(output.env.DATABASE_URL,database);assert.equal(output.env.NEON_API_KEY,undefined);assert.equal(output.env.NODE_OPTIONS,undefined);
  assert.throws(()=>prepareSchemaPush('npx prisma db push; touch INJECTED'),{code:'INVALID_ARGUMENTS'});
  assert.equal(existsSync(join(workspace,'INJECTED')),false);
 });
});
test('schema-push failures preserve uncertainty and redact password echoes',t=>{
 const workspace=fixture(t,"process.stderr.write('test-only-database-password');process.exitCode=1;");
 withExecutionContext({workspace},()=>assert.throws(()=>prepareSchemaPush()(database),error=>error.operationMayHaveCompleted&&!error.message.includes('test-only-database-password')&&error.message.includes('[REDACTED]')));
});
test('environment writes are private, bounded and resistant to traversal and symlinks',t=>{
 const workspace=fixture(t),outside=fixture(t);writeFileSync(join(outside,'env'),'preserve');
 withExecutionContext({workspace},()=>{
  const path=writeDatabaseEnvironment('.env.local',database);assert.equal(statSync(path).mode&0o777,0o600);assert.ok(readFileSync(path,'utf8').includes('DATABASE_URL="postgresql://'));
  assert.throws(()=>writeDatabaseEnvironment(join(outside,'env'),database),/Write blocked/);
  symlinkSync(join(outside,'env'),join(workspace,'escape'));assert.throws(()=>writeDatabaseEnvironment('escape',database),/Write blocked/);
  assert.equal(readFileSync(join(outside,'env'),'utf8'),'preserve');
 });
});
test('scaffold rejects unsupported commands and missing CLI before any provider side effect',async t=>{
 const workspace=fixture(t);let dispatched=0;
 await withExecutionContext({workspace,dispatch:async()=>{dispatched++;throw new Error('must not dispatch');}},async()=>{
  await assert.rejects(compound.execute('compound_scaffold_feature',{feature_name:'fixture',run_migrations:true,migration_command:'arbitrary shell'}),{code:'INVALID_ARGUMENTS'});
  await assert.rejects(compound.execute('compound_scaffold_feature',{feature_name:'fixture',run_migrations:true}),{code:'CAPABILITY_UNAVAILABLE'});
 });
 assert.equal(dispatched,0);assert.equal(existsSync(join(workspace,'.env.local')),false);
});

test('scaffold cannot report ready when the provider omits its connection string',async t=>{
 const workspace=fixture(t);
 const result=await withExecutionContext({workspace,dispatch:async(tool)=>tool==='neon_create_branch'?{branch:{id:'test-only-branch'}}:{}},()=>compound.execute('compound_scaffold_feature',{feature_name:'fixture'}));
 assert.equal(result.success,false);assert.equal(result.status,'partial');
 assert.ok(result.steps.some(step=>step.success===false&&step.error.includes('no database connection string')));
 assert.equal(existsSync(join(workspace,'.env.local')),false);
});
