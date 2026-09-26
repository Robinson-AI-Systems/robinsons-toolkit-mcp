import {createRequire} from 'node:module';
import {accessSync,constants} from 'node:fs';
import {EnvironmentCredentials} from './credentials.js';
const require=createRequire(import.meta.url);
export const Availability=Object.freeze(Object.fromEntries(['AVAILABLE','MISSING_CREDENTIALS','MISSING_CONFIGURATION','AUTHORIZATION_REQUIRED','UNREACHABLE','DISABLED','DEPRECATED'].map(s=>[s,s])));

export class CapabilityAvailability {
  #metadata; #credentials; #health=new Map(); #packages=new Map();
  constructor(metadata,{credentials=new EnvironmentCredentials(),packageExists}={}){
    this.#metadata=metadata;this.#credentials=credentials;
    this.packageExists=packageExists||((name)=>{if(!this.#packages.has(name)){try{require.resolve(name);this.#packages.set(name,true);}catch{this.#packages.set(name,false);}}return this.#packages.get(name);});
  }
  get(name,visited=new Set()){
    const meta=this.#metadata[name];
    if(!meta)return {state:Availability.DISABLED,reason:'No capability metadata'};
    if(meta.disabled)return {state:Availability.DISABLED,reason:meta.disabled};
    if(visited.has(name))return {state:Availability.DISABLED,reason:'Circular capability dependency'};
    const statuses=meta.requirements.map(g=>{
      const missingCredentials=g.credentials.filter(n=>!this.#credentials.has(n));
      const missingConfiguration=g.configuration.filter(n=>!this.#credentials.has(n));
      if(g.configuration.includes('GOOGLE_SERVICE_ACCOUNT_KEY_PATH')&&!missingConfiguration.length){
        try{accessSync(this.#credentials.configuration('GOOGLE_SERVICE_ACCOUNT_KEY_PATH'),constants.R_OK);}catch{missingConfiguration.push('GOOGLE_SERVICE_ACCOUNT_KEY_PATH (readable file required)');}
      }
      const missingPackages=g.packages.filter(n=>!this.packageExists(n));
      return {state:missingCredentials.length?Availability.MISSING_CREDENTIALS:missingConfiguration.length||missingPackages.length?Availability.MISSING_CONFIGURATION:Availability.AVAILABLE,missingCredentials,missingConfiguration,missingPackages};
    });
    if(!statuses.some(s=>s.state===Availability.AVAILABLE))return {state:statuses.some(s=>s.state===Availability.MISSING_CONFIGURATION)?Availability.MISSING_CONFIGURATION:Availability.MISSING_CREDENTIALS,requirements:statuses};
    const scope=this.scope(name);
    const health=this.#health.get(scope);
    if(health&&health.until>Date.now())return {state:health.state,reason:health.reason,retryAfter:health.until};
    const dependencies=meta.childTools.map(child=>({name:child,availability:this.get(child,new Set([...visited,name]))})).filter(c=>c.availability.state!==Availability.AVAILABLE);
    if(dependencies.length)return {state:dependencies[0].availability.state,reason:'Required child capabilities unavailable (conservative static dependency check)',dependencies};
    return {state:Availability.AVAILABLE,authorization:'NOT_PROBED',reachability:'NOT_PROBED'};
  }
  scope(name){const m=this.#metadata[name];return m?JSON.stringify([m.namespace,m.requirements]):name;}
  recordFailure(name,error){
    const message=String(error?.message||error);
    const status=error?.status||error?.statusCode||Number(message.match(/\b(401|403|502|503|504)\b/)?.[1]);
    if(error?.code==='HANDLER_UNAVAILABLE')this.#health.set(this.scope(name),{state:Availability.DISABLED,reason:'Provider implementation failed to import',until:Date.now()+60000});
    else if(status===401||status===403)this.#health.set(this.scope(name),{state:Availability.AUTHORIZATION_REQUIRED,reason:`Provider returned HTTP ${status}`,until:Date.now()+60000});
    else if([502,503,504].includes(status)||['ECONNREFUSED','ENOTFOUND','ETIMEDOUT'].includes(error?.cause?.code||error?.code))this.#health.set(this.scope(name),{state:Availability.UNREACHABLE,reason:'Provider is temporarily unreachable',until:Date.now()+30000});
  }
  clearHealth(){this.#health.clear();}
}
