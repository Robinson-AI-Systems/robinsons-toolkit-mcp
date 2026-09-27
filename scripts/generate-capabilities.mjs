import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inventory} from './inventory.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const data=inventory(root);
const group=(credentials=[],configuration=[],packages=[])=>({credentials,configuration,packages});
const defaults={
  github:[group(['GITHUB_TOKEN'])],vercel:[group(['VERCEL_TOKEN'])],neon:[group(['NEON_API_KEY'])],
  fly:[group(['FLY_API_TOKEN'])],stripe:[group(['STRIPE_SECRET_KEY'])],resend:[group(['RESEND_API_KEY'])],
  twilio:[group(['TWILIO_AUTH_TOKEN'],['TWILIO_ACCOUNT_SID'])],cloudflare:[group(['CLOUDFLARE_API_TOKEN'])],
  openai:[group(['OPENAI_API_KEY'])],anthropic:[group(['ANTHROPIC_API_KEY'])],
  supabase:[group(['SUPABASE_SERVICE_ROLE_KEY'],['SUPABASE_URL'])],mapbox:[group(['MAPBOX_ACCESS_TOKEN'])],
  clerk:[group(['CLERK_SECRET_KEY'])],sentry:[group(['SENTRY_AUTH_TOKEN'])],
  google:[group(['GOOGLE_ACCESS_TOKEN']),group([],['GOOGLE_SERVICE_ACCOUNT_KEY_PATH'])],
  qdrant:[group([],['QDRANT_URL'])],n8n:[group(['N8N_API_KEY'],['N8N_BASE_URL'])],
  postgres:[group(['POSTGRES_CONNECTION_STRING'],[],['postgres'])],context7:[group(['CONTEXT7_API_KEY'])],
  linear:[group(['LINEAR_API_KEY'])],slack:[group(['SLACK_BOT_TOKEN'])],gemini:[group(['GEMINI_API_KEY'])],
  moonshot:[group(['MOONSHOT_API_KEY'])],voyage:[group(['VOYAGE_API_KEY'])],
  sam:[group(['SAM_API_KEY']),group(['INTAKE_SAM_TOKEN'])],local:[group()],compound:[group()],
  playwright:[group([],[],['playwright'])],ollama:[group()],
  search:[group(['TAVILY_API_KEY']),group(['BRAVE_SEARCH_API_KEY'])],
  upstash:[group(['UPSTASH_REDIS_REST_TOKEN'],['UPSTASH_REDIS_REST_URL'])]
};
const capabilities={};
const sources={};
for(const entry of data.entries){
 const ns=entry.registryNamespace;
 const sourcePath=`handlers/${ns}.js`;
 sources[sourcePath] ||= createHash('sha256').update(readFileSync(join(root,sourcePath))).digest('hex');
 const branch=data.branches.find(b=>b.name===entry.name&&b.file===sourcePath);
 const body=branch?.body||'';
 let requirements=structuredClone(defaults[ns]);
 if(!requirements)throw Error('Missing namespace requirements: '+ns);
 if(ns==='postgres'&&['postgres_dump_schema','postgres_dump_table'].includes(entry.name))requirements=[{...group(['POSTGRES_CONNECTION_STRING']),binaries:['pg_dump']}];
 if(entry.name==='compound_git_commit_push')requirements=[{...group(),binaries:['git']}];
 if(ns==='neon'&&/\brunSQL\(/.test(body))requirements=[{...group(['NEON_API_KEY'],[],['@neondatabase/serverless']),nodeMajor:19}];
 if(ns==='search'){
   if(entry.name.startsWith('brave_'))requirements=[group(['BRAVE_SEARCH_API_KEY'])];
   else if(entry.name.startsWith('tavily_')||entry.name==='search_and_summarize')requirements=[group(['TAVILY_API_KEY'])];
   else if(entry.name.startsWith('serp_'))requirements=[group(['SERPAPI_KEY'])];
 }
 if(ns==='upstash'){
   if(/\bmgmt\(/.test(body))requirements=[group(['UPSTASH_API_KEY'],['UPSTASH_EMAIL'])];
   else if(/\bqstash\(/.test(body))requirements=[group(['UPSTASH_QSTASH_TOKEN'])];
   else if(/\bvec\(/.test(body))requirements=[group(['UPSTASH_VECTOR_REST_TOKEN'],['UPSTASH_VECTOR_REST_URL'])];
   else if(/\bkafka\(/.test(body))requirements=[group(['UPSTASH_KAFKA_REST_TOKEN'],['UPSTASH_KAFKA_REST_URL'])];
 }
 if(ns==='openai' && (/admin:\s*true|\badmin\(/.test(body)))requirements=[group(['OPENAI_ADMIN_KEY'])];
 if(ns==='anthropic' && (/admin:\s*true|\banthAdmin\(/.test(body)))requirements=[group(['ANTHROPIC_ADMIN_KEY'])];
 if(ns==='cloudflare'&&/\bACCT\(/.test(body))requirements.forEach(g=>g.configuration.push('CLOUDFLARE_ACCOUNT_ID'));
 if(ns==='sentry'&&/\bORG\(/.test(body))requirements.forEach(g=>g.configuration.push('SENTRY_ORG_SLUG'));
 if(ns==='mapbox'&&/process.env.MAPBOX_USERNAME/.test(body))requirements.forEach(g=>g.configuration.push('MAPBOX_USERNAME'));
 const childTools=[...body.matchAll(/(?:\.execute|\bexecute)\(\s*['"]([^'"]+)['"]/g)].map(m=>m[1]).filter(n=>n!==entry.name);
 capabilities[entry.name]={namespace:ns,handlerModule:sourcePath,requirements,childTools:[...new Set(childTools)],
   dependencyMode:childTools.length?'conservative-all-static-children':'direct',
   ...(!branch||branch.unparsed?{disabled:'Implementation does not parse or has no dispatch branch'}:
     branch.unreachable?{disabled:'Implementation is unreachable after an unconditional return or throw; pending provider review'}:{})};
}
const serialized=JSON.stringify({version:1,sources,capabilities},null,2)+'\n';
const path=join(root,'src/core/capability-metadata.json');
if(process.argv.includes('--check')){
 if(readFileSync(path,'utf8')!==serialized)throw Error('Capability metadata is stale: node scripts/generate-capabilities.mjs');
 console.log('Capability metadata matches source');
}else{writeFileSync(path,serialized);console.log(`Generated metadata for ${Object.keys(capabilities).length} capabilities`);}
