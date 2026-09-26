import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ResultStore} from '../src/core/results.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
function fixture(t,options={}){const directory=mkdtempSync(join(tmpdir(),'rt-results-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));return new ResultStore({directory,inlineBytes:64,...options});}
test('large output round-trips through UTF-8 byte cursors and literal search',t=>{
 const store=fixture(t);const value={rows:Array.from({length:5000},(_,i)=>({i,text:'💡 café '+i}))};
 const delivered=store.deliver(value);assert.equal(delivered.stored,true);assert.equal(delivered.recordCount,5000);assert.ok(JSON.stringify(delivered).length<1500);
 let cursor=0,text='';do{const page=store.read(delivered.resultId,{cursor,limit:4095});text+=page.content;cursor=page.nextCursor;}while(cursor!==null);
 assert.deepEqual(JSON.parse(text),value);
 assert.ok(store.search(delivered.resultId,'café 42').matches.length>0);
});
test('small outputs inline, secrets redacted before storage, numeric values preserved',t=>{
 const resolver=new EnvironmentCredentials({STRIPE_SECRET_KEY:'test-secret-1234'});
 const store=fixture(t,{redact:v=>resolver.redact(v)});
 assert.deepEqual(store.deliver({number:1234}),{number:1234});
 const result=store.deliver({text:('test-secret-1234 ').repeat(50)});
 const raw=readFileSync(store.path(result.resultId),'utf8');assert.ok(!raw.includes('test-secret-1234'));assert.ok(raw.includes('[REDACTED]'));
});
test('result IDs cannot traverse paths or follow symlink files',t=>{
 const store=fixture(t);assert.throws(()=>store.read('../escape'),/Invalid result ID/);
 const id='res_00000000-0000-0000-0000-000000000000';const outside=join(store.directory,'outside');writeFileSync(outside,'private');symlinkSync(outside,store.path(id));assert.throws(()=>store.read(id),/symlink/);
});
test('quota errors explicitly warn that execution may have completed',t=>{
 const store=fixture(t,{maxStoreBytes:100});assert.throws(()=>store.deliver('x'.repeat(200)),/may already have completed/);
});
