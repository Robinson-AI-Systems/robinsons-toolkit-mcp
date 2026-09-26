import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadRegistry} from './registry.js';
import {buildCatalog,withAliasWarning} from './catalog.js';
import {validateArgs} from './validation.js';
import {createHandlerLoader} from './handlers.js';
import {CapabilityAvailability,Availability} from './capabilities.js';
import {EnvironmentCredentials} from './credentials.js';
import {searchTools} from './discovery.js';
import {routeToolCall} from './executor.js';
import {ResultStore} from './results.js';
import {appendReceipt} from '../../ledger.js';
export const toolkitRoot=fileURLToPath(new URL('../../',import.meta.url));

/** Transport-independent capability gateway; constructing it imports no handlers. */
export async function createToolkit({root=toolkitRoot,credentials=new EnvironmentCredentials(),packageExists,resultOptions={}}={}) {
  const results=new ResultStore({inlineBytes:Number(process.env.RT_MAX_INLINE_BYTES||16384),inlineRecords:Number(process.env.RT_MAX_INLINE_RECORDS||100),...resultOptions,redact:value=>credentials.redact(value)});
  const catalog=buildCatalog(loadRegistry(root));
  const registry=catalog.entries;
  const byName=catalog.byName;
  const metadata=JSON.parse(readFileSync(join(root,'src/core/capability-metadata.json'),'utf8')).capabilities;
  const handlers=createHandlerLoader(root);
  const availability=new CapabilityAvailability(metadata,{credentials,packageExists});
  const namespaces=()=>[...new Set(registry.map(t=>t.namespace))].sort().map(namespace=>{
    const members=registry.filter(t=>t.namespace===namespace);
    const states={};for(const tool of members){const state=availability.get(tool.name).state;states[state]=(states[state]||0)+1;}
    return {namespace,total:members.length,available:states.AVAILABLE||0,states};
  });
  return {
    registry, metadata, availability, results,
    get loadedNamespaces(){return handlers.loadedNamespaces;},
    namespaces,
    doctor:()=>({namespaces:namespaces(),providersProbed:false,note:'AVAILABLE means locally configured; authorization and reachability are checked lazily on execution.'}),
    redact:value=>credentials.redact(value),
    errorResult(error){
      const details=credentials.redact({code:error.code||'EXECUTION_FAILED',message:error.message,...(error.availability?{availability:error.availability}:{})});
      try{return results.deliver(details);}
      catch{return {code:details.code,message:'Error details could not be stored within output limits.',detailsUnavailable:true};}
    },
    search(query,limit=8,{includeUnavailable=false}={}){
      if(typeof query!=='string'||!query.trim())throw Object.assign(new Error('query must be a non-empty string'),{code:'INVALID_ARGUMENTS'});
      if(!Number.isInteger(limit)||limit<1||limit>20)throw Object.assign(new Error('limit must be an integer between 1 and 20'),{code:'INVALID_ARGUMENTS'});
      const states=new Map(registry.map(t=>[t.name,availability.get(t.name)]));
      const candidates=registry.filter(t=>!t.aliasOf&&(includeUnavailable||states.get(t.name).state===Availability.AVAILABLE));
      return searchTools(candidates,query,{},limit).map(t=>({name:t.name,description:t.description,namespace:t.namespace,availability:states.get(t.name),whyMatched:'Lexical name, description or tag match'}));
    },
    schema(name){const tool=byName.get(name);return tool?{...tool,availability:availability.get(name)}:undefined;},
    async execute(name,args={}){
      if(!byName.has(name))throw Object.assign(new Error(`Unknown capability: ${name}`),{code:'UNKNOWN_TOOL'});
      if(!args||typeof args!=='object'||Array.isArray(args))throw Object.assign(new Error('args must be an object'),{code:'INVALID_ARGUMENTS'});
      const resolved=catalog.resolve(name);
      const canonicalName=resolved.canonical.name;
      const status=availability.get(canonicalName);
      if(status.state!==Availability.AVAILABLE)throw Object.assign(new Error(`Capability ${name} unavailable: ${status.state}`),{code:'CAPABILITY_UNAVAILABLE',availability:status});
      const validationError=validateArgs(name,args,registry);
      if(validationError)throw Object.assign(new Error(validationError),{code:'INVALID_ARGUMENTS'});
      try {
        const result=await routeToolCall(canonicalName,args,handlers,registry,{appendReceipt:receipt=>appendReceipt(credentials.redact(receipt))});
        return results.deliver(name===canonicalName?result:withAliasWarning(result,name,canonicalName));
      }catch(error){
        availability.recordFailure(canonicalName,error);
        throw Object.assign(new Error(credentials.redact(error.message)),{code:error.code||'EXECUTION_FAILED'});
      }
    }
  };
}
