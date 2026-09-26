import {fileURLToPath} from 'node:url';
import {loadRegistry} from './registry.js';
import {loadHandlers} from './handlers.js';
import {getActiveNamespaces} from './capabilities.js';
import {searchTools} from './discovery.js';
import {routeToolCall} from './executor.js';

export const toolkitRoot=fileURLToPath(new URL('../../',import.meta.url));

/** Shared behavior for adapters. No MCP, dotenv, or stdio side effects on import. */
export async function createToolkit({root=toolkitRoot}={}) {
  const registry=loadRegistry(root);
  const handlers=await loadHandlers(root);
  const activeNamespaces=getActiveNamespaces();
  const namespaceCounts={};
  for (const tool of registry) {
    const ns=tool.namespace||tool.name.split('_')[0];
    if(activeNamespaces[ns]!==false) namespaceCounts[ns]=(namespaceCounts[ns]||0)+1;
  }
  const totalActiveTools=Object.values(namespaceCounts).reduce((a,b)=>a+b,0);
  const activeNs=Object.entries(activeNamespaces).filter(([,v])=>v).map(([k])=>k);
  return {
    registry,activeNamespaces,namespaceCounts,totalActiveTools,activeNs,
    search:(query,limit=10)=>searchTools(registry,query,activeNamespaces,limit),
    schema:name=>registry.find(t=>t.name===name),
    execute:(name,args,options)=>routeToolCall(name,args,handlers,registry,options)
  };
}
