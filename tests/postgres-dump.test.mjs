import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import postgres from '../handlers/postgres.js';
import {dumpPostgres} from '../src/integrations/postgres/dump.js';
import {withExecutionContext} from '../src/core/context.js';
function fixture(t,script){
 const workspace=mkdtempSync(join(tmpdir(),'rt-dump-test-'));const bin=join(workspace,'bin');mkdirSync(bin);
 writeFileSync(join(bin,'pg_dump'),'#!'+process.execPath+'\n'+script,{mode:0o700});
 const saved={...process.env};process.env.PATH=bin;process.env.STRIPE_SECRET_KEY='test-only-unrelated-secret';
 t.after(()=>{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);rmSync(workspace,{recursive:true,force:true});});
 return workspace;
}
const connectionString='postgresql://fixture:test-only-password@fixture.invalid/testdb?sslmode=require';
test('backup process uses argument vectors and a private password file, with no ambient provider secrets',{skip:process.platform==='win32'},async t=>{
 const workspace=fixture(t,`const fs=require('node:fs');process.stdout.write(JSON.stringify({args:process.argv.slice(2),env:process.env,passfile:fs.readFileSync(process.env.PGPASSFILE,'utf8'),mode:fs.statSync(process.env.PGPASSFILE).mode&511}));process.stderr.write('test-only warning');`);
 process.env.POSTGRES_CONNECTION_STRING=connectionString;
 await withExecutionContext({workspace},async()=>{
  const outputPath='backup $(touch INJECTED).sql';
  const result=await postgres.execute('postgres_dump_table',{output_path:outputPath,table_name:'items; touch INJECTED',format:'custom'});
  assert.equal(result.success,true);assert.equal(result.warnings,'test-only warning');
  const captured=JSON.parse(readFileSync(join(workspace,outputPath),'utf8'));
  assert.ok(!JSON.stringify(captured.args).includes('test-only-password'));
  assert.equal(captured.env.STRIPE_SECRET_KEY,undefined);assert.equal(captured.env.POSTGRES_CONNECTION_STRING,undefined);assert.equal(captured.env.PGPASSWORD,undefined);
  assert.match(captured.passfile,/test-only-password/);assert.equal(captured.mode,0o600);
  assert.equal(existsSync(captured.env.PGPASSFILE),false);assert.equal(existsSync(join(workspace,'INJECTED')),false);
 });
});
test('failed backup preserves the previous file and redacts a provider-echoed password',{skip:process.platform==='win32'},t=>{
 const workspace=fixture(t,`process.stderr.write('test-only-password rejected');process.exitCode=1;`);
 writeFileSync(join(workspace,'existing.sql'),'preserve me');
 withExecutionContext({workspace},()=>{
  assert.throws(()=>dumpPostgres({connectionString,outputPath:'existing.sql',schemaOnly:true}),e=>!e.message.includes('test-only-password')&&e.message.includes('[REDACTED]'));
  assert.equal(readFileSync(join(workspace,'existing.sql'),'utf8'),'preserve me');
  assert.throws(()=>dumpPostgres({connectionString,outputPath:'../escape.sql',schemaOnly:true}),/Write blocked/);
  const external=mkdtempSync(join(tmpdir(),'rt-dump-outside-'));t.after(()=>rmSync(external,{recursive:true,force:true}));symlinkSync(external,join(workspace,'escape'));
  assert.throws(()=>dumpPostgres({connectionString,outputPath:'escape/data.sql',schemaOnly:true}),/Write blocked/);
 });
});
