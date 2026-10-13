import {fork} from 'node:child_process';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHandlerLoader} from '../handlers.js';
import {currentExecutionContext} from '../context.js';
import {sanitizedEnvironment} from '../sandbox/restricted-host.js';

const worker=new URL('./process-worker.js',import.meta.url);
const invalid=message=>Object.assign(new Error(message),{code:'INVALID_PROVIDER_EXECUTION'});
const unsafeEnvironment=/^(?:NODE_|LD_|DYLD_|PYTHON|RUBY|PERL|BASH_ENV$|ENV$|HOME$|USERPROFILE$|PATH$|COMSPEC$)/i;
/** One process per selected invocation: no ambient credential or module cache sharing. */
export function createProcessHandlerLoader(root,{credentials,scopes={},timeoutMs=30000,maxMessageBytes=8*1024*1024,maxLogBytes=65536}={}){
 if(!credentials||typeof credentials.configuration!=='function'||typeof credentials.redact!=='function')throw invalid('Credential resolver is required');
 if(!scopes||typeof scopes!=='object'||Array.isArray(scopes))throw invalid('Scopes must map capability names to environment variable names');
 for(const [name,variables] of Object.entries(scopes)){
  if(!/^[a-z][a-z0-9_]*$/.test(name)||!Array.isArray(variables)||variables.some(v=>typeof v!=='string'||! /^[A-Z][A-Z0-9_]*$/.test(v)||unsafeEnvironment.test(v)))throw invalid('Invalid provider credential/configuration scope');
 }
 for(const value of [timeoutMs,maxMessageBytes,maxLogBytes])if(!Number.isSafeInteger(value)||value<1)throw invalid('Process limits must be positive integers');
 if(timeoutMs>2147483647)throw invalid('Process deadline is too large');
 scopes=structuredClone(scopes);
 const legacy=createHandlerLoader(root),loaded=new Set();
 const failure=(code,message,uncertain=true)=>Object.assign(new Error(message),{code,...(uncertain?{operationMayHaveCompleted:true}:{})});
 async function execute(namespace,name,args){
  if(!Object.hasOwn(scopes,name))return (await legacy.load(namespace)).execute(name,args);
  const parent=currentExecutionContext();
  const context=Object.fromEntries(['workspace','writeRoots','depth','transactionId','rollback'].filter(key=>parent[key]!==undefined).map(key=>[key,parent[key]]));
  const request={type:'execute',module:pathToFileURL(join(root,'handlers',namespace+'.js')).href,name,args,context,maxMessageBytes};
  if(Buffer.byteLength(JSON.stringify(request))>maxMessageBytes)throw failure('PROVIDER_REQUEST_TOO_LARGE','Provider request exceeds process transport limit',false);
  const env=sanitizedEnvironment();
  for(const variable of scopes[name]){const value=credentials.configuration(variable);if(typeof value==='string')env[variable]=value;}
  return new Promise((resolve,reject)=>{
   let child,settled=false,timer,logBytes=0,terminal,stopping=false,closed=false;
   const inflight=new Set();
   const finish=()=>{
    if(settled||!terminal||!closed)return;settled=true;clearTimeout(timer);
    if(terminal.error)reject(terminal.error);else resolve(terminal.value);
   };
   const stop=(error,value)=>{
    if(stopping)return;stopping=true;terminal={error,value};clearTimeout(timer);
    if(child?.pid){
     child.kill('SIGKILL');
     // Descendants may retain inherited pipe handles; failed calls must not wait
     // forever for those diagnostics. This is not process-tree confinement.
     if(error){child.stdout?.destroy();child.stderr?.destroy();}
    }else {closed=true;finish();}
   };
   const safeSend=message=>{
    if(stopping||!child.connected)return;
    let size;try{size=Buffer.byteLength(JSON.stringify(message));}catch{stop(failure('PROVIDER_SERIALIZATION_FAILED','Provider response could not be serialized'));return;}
    if(size>maxMessageBytes){stop(failure('PROVIDER_RESULT_TOO_LARGE','Child result exceeds process transport limit'));return;}
    try{child.send(message,error=>{if(error&&!stopping)stop(failure('PROVIDER_CHANNEL_FAILED','Provider IPC channel failed'));});}
    catch{stop(failure('PROVIDER_CHANNEL_FAILED','Provider IPC channel failed'));}
   };
   try{child=fork(worker,[],{env,execArgv:[],cwd:parent.workspace||root,stdio:['ignore','pipe','pipe','ipc'],serialization:'json',windowsHide:true});}
   catch{reject(failure('PROVIDER_START_FAILED','Provider process could not start',false));return;}
   loaded.add(namespace);
   // Never write a provider's raw diagnostic stream into the MCP stream or logs.
   for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{
    logBytes+=chunk.length;if(logBytes>maxLogBytes)stop(failure('PROVIDER_LOG_LIMIT','Provider diagnostic output exceeded its limit; raw diagnostics were discarded'));
   });
   child.on('error',()=>stop(failure('PROVIDER_PROCESS_FAILED','Provider process failed',!!child.pid)));
   child.on('close',()=>{closed=true;
    if(!terminal)terminal={error:failure('PROVIDER_EXITED','Provider exited before returning a result')};
    if(logBytes&&!terminal.error)terminal={error:failure('PROVIDER_UNEXPECTED_OUTPUT',`Provider emitted ${logBytes} diagnostic bytes outside the result channel; diagnostics were discarded`)};
    finish();});
   child.on('message',message=>{
    if(stopping)return;
    if(message?.type==='dispatch'){
     if(!Number.isSafeInteger(message.id)||inflight.has(message.id)||typeof message.name!=='string'||typeof parent.dispatch!=='function'){
      stop(failure('PROVIDER_DISPATCH_INVALID','Provider child dispatch is unavailable or invalid'));return;
     }
     // This callback captures the originating Core context; no direct handler dispatch.
     inflight.add(message.id);
     Promise.resolve().then(()=>parent.dispatch(message.name,message.args)).then(value=>safeSend({type:'child-result',id:message.id,value}),error=>safeSend({type:'child-result',id:message.id,error:{code:error.code||'EXECUTION_FAILED',message:credentials.redact(String(error.message)),operationMayHaveCompleted:!!error.operationMayHaveCompleted}})).finally(()=>{inflight.delete(message.id);if(stopping)finish();});
    }else if(message?.type==='result'){
     if(inflight.size)stop(failure('PROVIDER_PENDING_CHILDREN','Provider returned while child operations were still running; their outcomes remain pending'));
     else if(logBytes)stop(failure('PROVIDER_UNEXPECTED_OUTPUT',`Provider emitted ${logBytes} diagnostic bytes outside the result channel; diagnostics were discarded`));
     else stop(null,message.value);
    }else if(message?.type==='failure'){
     const error=message.error||{};
     const forwarded=failure(typeof error.code==='string'?error.code:'EXECUTION_FAILED',credentials.redact(String(error.message||'Provider failed')),!!error.operationMayHaveCompleted);
     if(Number.isInteger(error.status))forwarded.status=error.status;
     if(typeof error.cause?.code==='string')forwarded.cause={code:error.cause.code};
     stop(forwarded);
    }else stop(failure('PROVIDER_PROTOCOL_FAILED','Provider sent an invalid response'));
   });
   timer=setTimeout(()=>stop(failure('PROVIDER_TIMEOUT','Provider deadline exceeded; dispatched operations may have completed. Do not retry blindly.')),timeoutMs);
   safeSend(request);
  });
 }
 return {get loadedNamespaces(){return [...new Set([...loaded,...legacy.loadedNamespaces])];},async load(namespace){
  if(!/^[a-z][a-z0-9]*$/.test(namespace))throw invalid('Invalid handler namespace');
  return {execute:(name,args)=>execute(namespace,name,args)};
 }};
}
