import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createToolkit,toolkitRoot} from '../src/core/index.js';
import {EnvironmentCredentials} from '../src/core/credentials.js';
import {inventory,duplicateCandidates} from './inventory.mjs';
import {PINNED_TOOLS} from '../src/adapters/mcp/surface.js';
const core=await createToolkit({credentials:new EnvironmentCredentials({}),packageExists:()=>false,binaryExists:()=>false,profile:null});
const inventoryData=inventory(toolkitRoot);
const duplicateReport=duplicateCandidates(inventoryData);
const canonical=core.registry.filter(t=>!t.aliasOf);
const aliases=core.registry.filter(t=>t.aliasOf);
const countBy=(entries,fn)=>Object.fromEntries([...entries.reduce((map,t)=>map.set(fn(t),(map.get(fn(t))||0)+1),new Map())].sort(([a],[b])=>a.localeCompare(b)));
const summary={registryNames:core.registry.length,canonicalCapabilities:canonical.length,aliases:aliases.length,
 namespaces:new Set(canonical.map(t=>t.namespace)).size,byNamespace:countBy(canonical,t=>t.namespace),
 risk:countBy(canonical,t=>t.risk||'UNREVIEWED'),
 zeroCredentialAvailability:countBy(canonical,t=>core.availability.get(t.name).state),
 duplicates:{candidatePairs:duplicateReport.length,byClassification:countBy(duplicateReport,c=>c.classification)},
 availabilityAssumptions:'Empty credential environment; optional packages and executables assumed absent; no provider probes.',
 mcp:{advertisedTools:PINNED_TOOLS.length,advertisedSchemaBytes:Buffer.byteLength(JSON.stringify(PINNED_TOOLS)),providerSchemasAdvertisedDirectly:0},
 integrity:{duplicateNames:inventoryData.duplicateNames.length,repeatedDispatchNames:inventoryData.repeatedDispatchNames.length,
 registryWithoutHandler:inventoryData.mismatches.registryWithoutHandler.length,handlerWithoutRegistry:inventoryData.mismatches.handlerWithoutRegistry.length,findings:inventoryData.findings.length},
 certification:'Counts describe catalog structure, not upstream correctness or production readiness.'};
const manifest=core.registry.map(t=>({...t,implementation:core.metadata[t.name],zeroCredentialAvailability:core.availability.get(t.name)}));
const duplicates=duplicateReport.map(candidate=>({...candidate,
 reviewedAlias:candidate.tools.some(name=>core.schema(name)?.aliasOf&&candidate.tools.includes(core.schema(name).aliasOf))}));
const markdown=`# Generated capability catalog\n\nRegistry names: ${summary.registryNames}\n\nCanonical capabilities: ${summary.canonicalCapabilities}\n\nCompatibility aliases: ${summary.aliases}\n\nNamespaces: ${summary.namespaces}\n\nMCP broker tools: ${summary.mcp.advertisedTools}; schema bytes: ${summary.mcp.advertisedSchemaBytes}; directly exposed provider schemas: 0.\n\n${summary.certification}\n\nSee [summary](summary.json), [capability manifest](capabilities.jsonl), and [duplicate candidates](duplicates.json).\n\nRegenerate with npm run catalog:generate. CI checks freshness with npm run catalog:check. Availability is a reproducible zero-credential snapshot; rt doctor reports the current runtime environment.\n`;
const files={'summary.json':JSON.stringify(summary,null,2)+'\n','capabilities.jsonl':manifest.map(t=>JSON.stringify(t)).join('\n')+'\n','duplicates.json':'[\n'+duplicates.map(item=>'  '+JSON.stringify(item)).join(',\n')+'\n]\n','README.md':markdown};
const directory=join(toolkitRoot,'reports/catalog');
if(!process.argv.includes('--check'))mkdirSync(directory,{recursive:true});
for(const [name,content] of Object.entries(files)){
 const path=join(directory,name);
 if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw Error('Generated catalog is stale: '+name);}
 else writeFileSync(path,content);
}
console.log(JSON.stringify(summary));
