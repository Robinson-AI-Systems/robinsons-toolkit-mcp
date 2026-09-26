import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ProfileStore} from '../src/core/profiles.js';
import {createToolkit} from '../src/core/index.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
function fixture(t){const root=mkdtempSync(join(tmpdir(),'rt-profile-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
test('profile store rejects secrets, traversal, symlinks and missing selected profiles',t=>{
 const root=fixture(t),store=new ProfileStore(join(root,'profiles'));
 assert.equal(store.active(),null);
 for(const extra of [{name:'../escape'},{name:'active'},{credentials:{key:'test-only-secret'}},{apiKey:'test-only-secret'}])assert.throws(()=>store.create({name:'dev',workspace:root,...extra}));
 store.create({name:'dev',workspace:root,allowedCapabilities:['local_*']});
 store.use('dev');assert.equal(store.active().name,'dev');
 assert.throws(()=>store.create({name:'dev',workspace:root}),{code:'EEXIST'});
 rmSync(join(root,'profiles','dev.json'));assert.throws(()=>store.active());
 symlinkSync(join(root,'profiles','active.json'),join(root,'profiles','dev.json'));assert.throws(()=>store.get('dev'));
});
test('concurrent Core profiles isolate local writes and results; aliases cannot bypass policy',async t=>{
 const root=fixture(t),a=join(root,'a'),b=join(root,'b');mkdirSync(a);mkdirSync(b);
 const options={credentials:new EnvironmentCredentials({}),resultOptions:{inlineBytes:32}};
 const ca=await createToolkit({...options,profile:{name:'a',workspace:a,allowedCapabilities:['local_write_file','local_read_file','local_list_directory']}});
 const cb=await createToolkit({...options,profile:{name:'b',workspace:b,allowedCapabilities:['local_write_file']}});
 assert.notEqual(ca.results.directory,cb.results.directory);
 await Promise.all([ca.execute('local_write_file',{path:'sample.txt',content:'A'}),cb.execute('local_write_file',{path:'sample.txt',content:'B'})]);
 assert.equal(readFileSync(join(a,'sample.txt'),'utf8'),'A');assert.equal(readFileSync(join(b,'sample.txt'),'utf8'),'B');
 await assert.rejects(ca.execute('local_write_file',{path:join(b,'bad.txt'),content:'bad'}),/Write blocked/);
 await assert.rejects(ca.execute('local_create_directory',{path:'not-allowed'}),{code:'CAPABILITY_UNAVAILABLE'});
 assert.equal(ca.schema('local_create_directory').availability.state,'DISABLED');
 assert.ok(!ca.search('create directory',20).some(t=>t.name==='local_make_directory'));
});
test('CLI profile create/use/list persists selection and applies workspace and denied capabilities',t=>{
 const root=fixture(t),workspace=join(root,'workspace');mkdirSync(workspace);
 const bin=fileURLToPath(new URL('../bin/rt.js',import.meta.url));
 const run=args=>{const r=spawnSync(process.execPath,[bin,...args],{cwd:root,env:{PATH:process.env.PATH,TOOLKIT_STATE_DIR:join(root,'state')},encoding:'utf8',timeout:10000});return {status:r.status,body:JSON.parse(r.stdout)};};
 assert.equal(run(['profile','create','dev','--json',JSON.stringify({workspace,deniedCapabilities:['local_run_command']})]).status,0);
 assert.equal(run(['profile','use','dev']).status,0);
 assert.equal(run(['profile','list']).body.result.active,'dev');
 assert.equal(run(['exec','local_write_file','--json',JSON.stringify({path:'cli.txt',content:'actual write'})]).status,0);
 assert.equal(readFileSync(join(workspace,'cli.txt'),'utf8'),'actual write');
 assert.equal(run(['exec','local_run_command','--json','{"command":"echo blocked"}']).status,3);
});
