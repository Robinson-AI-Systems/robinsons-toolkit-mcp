import test from 'node:test';
import assert from 'node:assert/strict';
import neonHandler from '../handlers/neon.js';
import {createToolkit} from '../src/core/index.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
const uri='postgresql://fixture:test-only-password@ep-fixture.us-east-2.aws.neon.tech/neondb?sslmode=require';
const result={command:'SELECT',rowCount:1,fields:[{name:'answer',dataTypeID:23}],rows:[['42']]};
function credentials(t){const old=process.env.NEON_API_KEY;process.env.NEON_API_KEY='test-only-management-key';t.after(()=>{if(old===undefined)delete process.env.NEON_API_KEY;else process.env.NEON_API_KEY=old;});}
test('Neon connection lookup uses documented API and forwards encoded selectors',async t=>{
 credentials(t);let calls=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls++;const parsed=new URL(url);assert.equal(parsed.pathname,'/api/v2/projects/test-project/connection_uri');
  assert.equal(parsed.searchParams.get('database_name'),'db & name');assert.equal(parsed.searchParams.get('role_name'),'role/name');
  assert.equal(parsed.searchParams.get('branch_id'),'br-test');assert.equal(parsed.searchParams.get('pooled'),'false');
  assert.equal(init.headers.Authorization,'Bearer test-only-management-key');
  return Response.json({uri});
 });
 const data=await neonHandler.execute('neon_get_connection_string',{project_id:'test-project',branch_id:'br-test',database:'db & name',role:'role/name',pooled:false});
 assert.equal(data.connection_string,uri);assert.equal(calls,1);
});
test('Neon rejects missing/passwordless URIs and propagates authorization failures',async t=>{
 credentials(t);
 for(const response of [{},{uri:'postgresql://fixture@fixture.invalid/db'}]){
  t.mock.method(globalThis,'fetch',async()=>Response.json(response));
  await assert.rejects(neonHandler.execute('neon_get_connection_string',{project_id:'fixture'}),/invalid|incomplete/);
 }
 t.mock.method(globalThis,'fetch',async()=>Response.json({message:'denied'},{status:403}));
 await assert.rejects(neonHandler.execute('neon_get_connection_string',{project_id:'fixture'}),/403/);
});
test('Neon alias stays callable but discovery is canonical and output secrets are redacted',async t=>{
 credentials(t);t.mock.method(globalThis,'fetch',async()=>Response.json({uri}));
 const core=await createToolkit({profile:null,credentials:new EnvironmentCredentials({NEON_API_KEY:'test-only-management-key'})});
 const value=await core.execute('neon_get_connection_uri',{project_id:'fixture'});
 assert.equal(value.connection_string,'[REDACTED]');assert.match(value.warnings[0],/Deprecated name/);
 assert.ok(!core.search('neon connection',20).some(r=>r.name==='neon_get_connection_uri'));
});
test('Neon SQL uses actual official driver with database authentication and typed full results',async t=>{
 credentials(t);let sqlCalls=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(String(url).startsWith('https://console.neon.tech/'))return Response.json({uri});
  sqlCalls++;assert.equal(new Headers(init.headers).get('Neon-Connection-String'),uri);
  assert.equal(new Headers(init.headers).get('Authorization'),null);
  assert.equal(JSON.parse(init.body).query,'SELECT 42 AS answer');
  return Response.json(result);
 });
 const value=await neonHandler.execute('neon_run_sql',{project_id:'fixture',sql:'SELECT 42 AS answer'});
 assert.deepEqual(value.rows,[{answer:42}]);assert.equal(value.rowCount,1);assert.equal(sqlCalls,1);
});
test('Neon SQL transaction uses an atomic driver batch and errors are never success objects',async t=>{
 credentials(t);
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(String(url).startsWith('https://console.neon.tech/'))return Response.json({uri});
  const body=JSON.parse(init.body);assert.deepEqual(body.queries.map(q=>q.query),['SELECT 42','SELECT 42']);
  return Response.json({results:[result,result]});
 });
 const value=await neonHandler.execute('neon_run_sql_transaction',{project_id:'fixture',statements:['SELECT 42','SELECT 42']});assert.equal(value.length,2);
 t.mock.method(globalThis,'fetch',async url=>String(url).startsWith('https://console.neon.tech/')?Response.json({uri}):Response.json({message:'denied test-only-password',code:'42501'},{status:400}));
 await assert.rejects(neonHandler.execute('neon_run_sql',{project_id:'fixture',sql:'SELECT 42'}),e=>e.code==='EXECUTION_FAILED'&&!e.message.includes('test-only-password'));
});
test('Missing SQL driver disables SQL but not management or connection URI retrieval',async()=>{
 const core=await createToolkit({profile:null,credentials:new EnvironmentCredentials({NEON_API_KEY:'test-only-management-key'}),packageExists:()=>false});
 assert.equal(core.schema('neon_run_sql').availability.state,'MISSING_CONFIGURATION');
 assert.equal(core.schema('neon_get_connection_string').availability.state,'AVAILABLE');
 assert.deepEqual(core.loadedNamespaces,[]);
});
