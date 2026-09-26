import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {inventory,duplicateCandidates} from './inventory.mjs';
import {probeMcp} from './probe-mcp.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const out=process.argv[2]||join(root,'reports/recovery');mkdirSync(out,{recursive:true});
const data=inventory(root);
const duplicates=duplicateCandidates(data);
const old=spawnSync(process.execPath,['audit.js'],{cwd:root,encoding:'utf8'});
const runtime=await probeMcp(root);
const imports=spawnSync(process.execPath,['--input-type=module','-e',`
  import {readdirSync} from 'node:fs';
  const results=[];
  for(const f of readdirSync('./handlers').filter(f=>f.endsWith('.js')).sort()){
    try{const m=await import('./handlers/'+f);results.push({file:f,passed:typeof m.default?.execute==='function'});}
    catch(e){results.push({file:f,passed:false,error:e.message});}
  }
  process.stdout.write(JSON.stringify(results));
`],{cwd:root,env:{PATH:process.env.PATH},encoding:'utf8',timeout:15000});
const manifest=data.entries.map(e=>({...e,implementationLocations:data.branches.filter(b=>b.name===e.name).map(b=>({file:b.file,line:b.line,fingerprint:b.implementationFingerprint})),verification:'structural only; provider behavior not certified'}));
const report={sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,
 counts:data.counts,mismatches:data.mismatches,duplicateNames:data.duplicateNames,repeatedDispatchNames:data.repeatedDispatchNames,
 findings:data.findings,dependencies:data.modules,handlerImports:imports.status===0?JSON.parse(imports.stdout):{error:imports.stderr},
 legacyAudit:{exitCode:old.status,stdout:old.stdout},runtime,duplicateCandidateCount:duplicates.length,
 limits:['Branch presence does not prove a working implementation.','Duplicate analysis is conservative static evidence, not semantic equivalence proof.','No provider mutation or authenticated network tests were performed.']};
for(const [name,value]of Object.entries({'baseline.json':report,'capability-manifest.json':manifest,'duplicate-candidates.json':duplicates}))writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n');
console.log(JSON.stringify({counts:report.counts,mismatches:report.mismatches,findings:report.findings,runtime:{...runtime,noSecretSearch:undefined,stderr:undefined},duplicates:duplicates.length},null,2));
