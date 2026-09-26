import {fileURLToPath} from 'node:url';
import {inventory} from './inventory.mjs';
const data=inventory(fileURLToPath(new URL('../',import.meta.url)));
const registered=new Set(data.entries.map(entry=>entry.name));
const findings=data.findings.filter(f=>f.rule==='unreachable-dispatch');
const byNamespace={};
for(const finding of findings){
  const namespace=finding.file.slice('handlers/'.length,-3);
  byNamespace[namespace]=(byNamespace[namespace]||0)+1;
}
console.log(JSON.stringify({
  counts:{registryEntries:data.counts.registryEntries,unreachableDispatches:findings.length,
    unreachableRegisteredNames:new Set(findings.filter(f=>registered.has(f.name)).map(f=>f.name)).size},
  byNamespace,findings,
  limits:['Detects direct unconditional return/throw in execute; not a complete control-flow or provider-correctness proof.',
    'Affected registered capabilities are disabled by generated metadata, not deleted.',
    'Other capabilities may also be unavailable due to credentials, configuration or disabled child dependencies.']
},null,2));
