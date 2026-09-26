import {pathToFileURL} from 'node:url';
import {join} from 'node:path';

/** Imports only a requested namespace; concurrent callers share the same promise. */
export function createHandlerLoader(root){
  const pending=new Map();
  return {
    get loadedNamespaces(){return [...pending.keys()];},
    async load(namespace){
      if(!/^[a-z][a-z0-9]*$/.test(namespace))throw new Error('Invalid handler namespace');
      if(!pending.has(namespace)){
        const promise=import(pathToFileURL(join(root,'handlers',namespace+'.js')).href).then(module=>{
          if(typeof module.default?.execute!=='function')throw new Error('Handler has no execute function');
          return module.default;
        }).catch(error=>{pending.delete(namespace);throw Object.assign(new Error(`Handler unavailable: ${namespace}: ${error.message}`),{code:'HANDLER_UNAVAILABLE'});});
        pending.set(namespace,promise);
      }
      return pending.get(namespace);
    }
  };
}
