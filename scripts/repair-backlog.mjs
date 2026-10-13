import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inventory,canonical} from './inventory.mjs';

const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
// Location changes must not reset a defect's identity. Multiplicity is checked separately.
export function integrityItems(data){
 const items=[...data.findings.map(({line,...finding})=>finding),
  ...data.mismatches.registryWithoutHandler.map(name=>({rule:'registry-without-handler',name})),
  ...data.mismatches.handlerWithoutRegistry.map(name=>({rule:'handler-without-registry',name})),
  ...data.duplicateNames.map(item=>({rule:'duplicate-name',...item})),
  ...data.repeatedDispatchNames.map(({name,locations})=>({rule:'repeated-dispatch',name,files:locations.map(s=>s.replace(/:\d+$/,'')).sort()}))];
 return items.map(item=>({...item,id:digest(item)})).sort((a,b)=>a.id.localeCompare(b.id));
}
export function compareIntegrity(current,accepted){
 const count=items=>{const counts=new Map();for(const item of items)counts.set(item.id,(counts.get(item.id)||0)+1);return counts;};
 const now=count(current),before=count(accepted);
 return {introduced:[...now].filter(([id,n])=>n>(before.get(id)||0)).map(([id,n])=>({id,count:n-(before.get(id)||0)})),
  resolved:[...before].filter(([id,n])=>n>(now.get(id)||0)).map(([id,n])=>({id,count:n-(now.get(id)||0)}))};
}
export function buildRepairBacklog(data,metadata){
 const items=integrityItems(data),groups=new Map();
 for(const item of items){
  const branch=data.branches.find(b=>b.name===item.name);
  const file=item.file||branch?.file||data.entries.find(e=>e.name===item.name)?.registryFile||'catalog';
  const key=file+'|'+item.rule;
  if(!groups.has(key))groups.set(key,{id:digest(key),file,rootCause:item.rule,status:'OPEN',names:[],findings:[],
   nextAction:item.rule==='unreachable-dispatch'?'Review official contracts and repair a coherent operation family before enabling dispatch.':'Review source evidence; repair or document a supported compatibility disposition.',
   closure:['Strict integrity no longer reports the defect','Regression and contract/error tests pass','Required metadata and migration records regenerated']});
  const group=groups.get(key);if(item.name&&!group.names.includes(item.name))group.names.push(item.name);group.findings.push(item.id);
 }
 const capabilities=data.entries.map(entry=>{
  const branches=data.branches.filter(b=>b.name===entry.name&&b.file===`handlers/${entry.registryNamespace}.js`);
  const meta=metadata.capabilities[entry.name];
  return {name:entry.name,namespace:entry.registryNamespace,canonical:entry.aliasOf||entry.name,
   structural:branches.length!==1?'UNRESOLVED':branches[0].unreachable?'UNREACHABLE':'RESOLVED_NOT_CERTIFIED',
   implementation:branches[0]?.implementationFingerprint||null,risk:entry.risk||'UNREVIEWED',
   metadataPresent:!!meta,contractVerification:'UNREVIEWED',liveVerification:'NOT_RUN',
   findings:items.filter(item=>item.name===entry.name).map(item=>item.id)};
 });
 return {version:1,scope:'Static structural evidence only; resolved dispatch is not provider certification. Contract and live labels are conservative until explicit per-capability evidence is maintained.',
  sources:metadata.sources,summary:{capabilities:capabilities.length,integrityItems:items.length,rootCauseGroups:groups.size},
  groups:[...groups.values()].sort((a,b)=>a.file.localeCompare(b.file)||a.rootCause.localeCompare(b.rootCause)),capabilities};
}
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const data=inventory(root),items=integrityItems(data);
 const baselinePath=join(root,'reports/repair/integrity-baseline.json');
 const reportPath=join(root,'reports/repair/backlog.json');
 const report=buildRepairBacklog(data,JSON.parse(readFileSync(join(root,'src/core/capability-metadata.json'),'utf8')));
 const files=new Map();
 const namespaces=[...new Set(report.capabilities.map(c=>c.namespace))].sort();
 for(const namespace of namespaces){
  const entries=report.capabilities.filter(c=>c.namespace===namespace);
  files.set(join(root,'reports/repair/capabilities',namespace+'.json'),'[\n'+entries.map(e=>JSON.stringify(e)).join(',\n')+'\n]\n');
 }
 report.capabilityFiles=namespaces.map(namespace=>'capabilities/'+namespace+'.json');
 delete report.capabilities;
 files.set(reportPath,JSON.stringify(report,null,2)+'\n');
 if(process.argv.includes('--initialize-baseline')){
  mkdirSync(join(root,'reports/repair'),{recursive:true});
  // Exclusive creation: an inherited baseline must never silently absorb new defects.
  writeFileSync(baselinePath,JSON.stringify({version:1,items},null,2)+'\n',{flag:'wx'});
 }
 const baseline=JSON.parse(readFileSync(baselinePath,'utf8'));
 const comparison=compareIntegrity(items,baseline.items);
 let fresh=true;
 for(const [path,output] of files){
  if(process.argv.includes('--check')){try{if(readFileSync(path,'utf8')!==output)fresh=false;}catch(error){if(error.code==='ENOENT')fresh=false;else throw error;}}
  else {mkdirSync(join(root,'reports/repair/capabilities'),{recursive:true});writeFileSync(path,output);}
 }
 console.log(JSON.stringify({fresh,...comparison,strictIntegrityPassed:items.length===0,remaining:items.length}));
 if(!fresh||comparison.introduced.length)process.exitCode=1;
}
