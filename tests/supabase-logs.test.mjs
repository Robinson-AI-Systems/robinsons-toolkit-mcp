import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolkit} from '../src/core/index.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
const env={SUPABASE_ACCESS_TOKEN:'test-only-management',SUPABASE_SERVICE_ROLE_KEY:'test-only-project',SUPABASE_URL:'https://fixture.supabase.co'};
const range={iso_timestamp_start:'2026-09-27T12:00:00Z',iso_timestamp_end:'2026-09-27T13:00:00Z'};
async function coreFor(t,configured=env){
 for(const [key,value] of Object.entries(env)){const old=process.env[key];process.env[key]=value;t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});}
 return createToolkit({profile:null,credentials:new EnvironmentCredentials(configured)});
}
test('Supabase management and project APIs have independent credential requirements',async t=>{
 const management=await coreFor(t,{SUPABASE_ACCESS_TOKEN:env.SUPABASE_ACCESS_TOKEN});
 assert.equal(management.schema('supabase_list_projects').availability.state,'AVAILABLE');
 assert.equal(management.schema('supabase_get_logs').availability.state,'AVAILABLE');
 assert.equal(management.schema('supabase_select').availability.state,'MISSING_CREDENTIALS');
 const project=await createToolkit({profile:null,credentials:new EnvironmentCredentials({SUPABASE_SERVICE_ROLE_KEY:env.SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL:env.SUPABASE_URL})});
 assert.equal(project.schema('supabase_select').availability.state,'AVAILABLE');
 assert.equal(project.schema('supabase_list_projects').availability.state,'MISSING_CREDENTIALS');
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(url==='https://api.supabase.com/v1/projects'){assert.equal(init.headers.Authorization,'Bearer test-only-management');return Response.json([]);}
  assert.ok(url.startsWith('https://fixture.supabase.co/rest/v1/'));assert.equal(init.headers.Authorization,'Bearer test-only-project');return Response.json([]);
 });
 await management.execute('supabase_list_projects',{});await project.execute('supabase_select',{table:'fixture'});
});
test('recovered logs use the unified endpoint, real service filter and bounded time range',async t=>{
 const core=await coreFor(t);let calls=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls++;const parsed=new URL(url);assert.equal(parsed.pathname,'/v1/projects/fixture/analytics/endpoints/logs');
  assert.equal(init.headers.Authorization,'Bearer test-only-management');
  assert.match(parsed.searchParams.get('sql'),/source = 'postgres_logs'/);assert.match(parsed.searchParams.get('sql'),/LIMIT 1$/);
  assert.equal(parsed.searchParams.get('iso_timestamp_start'),'2026-09-27T12:00:00.000Z');
  return Response.json({result:[{id:'test-only-log',event_message:'ready'}],error:null});
 });
 for(const tool of ['supabase_get_logs','supabase_get_postgres_logs']){
  const value=await core.execute(tool,{project_id:'fixture',service:'postgres',limit:1,...range});
  assert.equal(value.rowCount,1);assert.equal(value.limitReached,true);assert.ok(value.warnings.length);assert.equal(value.timeRange.defaulted,false);
 }
 assert.equal(calls,2);
});
test('log search text stays inside one literal and default time window is explicit',async t=>{
 const core=await coreFor(t),search="x\\'); SELECT secret; --";
 t.mock.method(globalThis,'fetch',async url=>{
  const sql=new URL(url).searchParams.get('sql');
  const match=sql.match(/positionCaseInsensitiveUTF8\(event_message, '((?:\\.|[^'\\])*)'\) > 0 ORDER BY timestamp DESC LIMIT 100$/s);
  assert.ok(match);assert.equal(match[1].replace(/\\(.)/gs,'$1'),search);
  return Response.json({result:[],error:null});
 });
 const value=await core.execute('supabase_get_logs',{project_id:'fixture',service:'auth',search});
 assert.equal(value.timeRange.defaulted,true);assert.equal(Date.parse(value.timeRange.end)-Date.parse(value.timeRange.start),60000);
});
test('bad limits, traversal, services and invalid time windows fail before HTTP',async t=>{
 const core=await coreFor(t);let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;throw Error('unexpected HTTP');});
 for(const change of [{limit:0},{limit:1.5},{limit:1001},{project_id:'../projects'},{service:"postgres' OR 1=1"},{iso_timestamp_start:range.iso_timestamp_start},{...range,iso_timestamp_end:'2026-09-29T13:00:00Z'},{...range,iso_timestamp_end:range.iso_timestamp_start}]){
  await assert.rejects(core.execute('supabase_get_logs',{project_id:'fixture',service:'postgres',...change}));
 }
 assert.equal(calls,0);
});
test('HTTP-success query errors and malformed log responses are failures, not empty successes',async t=>{
 const core=await coreFor(t);
 for(const value of [{result:[],error:'invalid query'},{notResults:[]}]){
  t.mock.method(globalThis,'fetch',async()=>Response.json(value));
  await assert.rejects(core.execute('supabase_get_logs',{project_id:'fixture',service:'postgres'}),/query failed|invalid log result/);
 }
});
test('management authorization failure does not disable the project API',async t=>{
 const core=await coreFor(t);t.mock.method(globalThis,'fetch',async()=>Response.json({message:'denied'},{status:401}));
 await assert.rejects(core.execute('supabase_get_logs',{project_id:'fixture',service:'postgres'}),/401/);
 assert.equal(core.schema('supabase_get_logs').availability.state,'AUTHORIZATION_REQUIRED');
 assert.equal(core.schema('supabase_select').availability.state,'AVAILABLE');
});
