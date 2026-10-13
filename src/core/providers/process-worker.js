import {withExecutionContext} from '../context.js';
const pending=new Map();
let started=false,sequence=0;
const send=message=>new Promise((resolve,reject)=>process.send(message,error=>error?reject(error):resolve()));
const errorData=error=>({message:String(error?.message||'Provider failed'),code:typeof error?.code==='string'?error.code:'EXECUTION_FAILED',operationMayHaveCompleted:!!error?.operationMayHaveCompleted,...(Number.isInteger(error?.status||error?.statusCode)?{status:error.status||error.statusCode}:{}),...(typeof error?.cause?.code==='string'?{cause:{code:error.cause.code}}:{})});
process.on('message',async message=>{
 if(message?.type==='child-result'){
  const request=pending.get(message.id);if(!request)return;pending.delete(message.id);
  if(message.error)request.reject(Object.assign(new Error(message.error.message),message.error));else request.resolve(message.value);
  return;
 }
 if(message?.type!=='execute'||started)return;
 started=true;
 const dispatch=(name,args)=>new Promise((resolve,reject)=>{
  const id=++sequence;pending.set(id,{resolve,reject});
  send({type:'dispatch',id,name,args}).catch(error=>{pending.delete(id);reject(error);});
 });
 try{
  let handler;try{handler=await import(message.module);}catch{throw Object.assign(new Error('Provider implementation failed to import'),{code:'HANDLER_UNAVAILABLE'});}
  if(typeof handler.default?.execute!=='function')throw new Error('Provider module has no execute function');
  const value=await withExecutionContext({...message.context,dispatch},()=>handler.default.execute(message.name,message.args));
  const response={type:'result',value};
  if(Buffer.byteLength(JSON.stringify(response))>message.maxMessageBytes)throw Object.assign(new Error('Provider result exceeds process transport limit; operation may have completed.'),{code:'PROVIDER_RESULT_TOO_LARGE',operationMayHaveCompleted:true});
  await send(response);
 }catch(error){await send({type:'failure',error:errorData(error)}).catch(()=>{process.exitCode=1;});}
 // Parent owns termination, including handlers that leave timers or connections open.
});
process.on('disconnect',()=>process.exit(0));
