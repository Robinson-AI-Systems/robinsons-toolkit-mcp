import {currentWorkspace} from './src/core/context.js';
import {openSync,closeSync,readFileSync,writeSync,fsyncSync,fstatSync,fchmodSync,unlinkSync,constants} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// Receipt and rollback events are append-only. Historical receipt-only JSONL
// remains readable. Never follow a ledger symlink or silently skip corruption.
const ledgerPath=()=>join(currentWorkspace(),'.toolkit-ledger.jsonl');
export const LEDGER_FILE=ledgerPath();
const maximumBytes=64*1024*1024;
const ledgerError=(message,code='LEDGER_ERROR')=>Object.assign(new Error(message),{code});
function verifyFile(fd){
 const stat=fstatSync(fd);
 if(!stat.isFile()||stat.nlink!==1)throw ledgerError('Ledger must be a regular file with one link');
 if(stat.size>maximumBytes)throw ledgerError('Ledger exceeds 64 MiB; archive it before continuing');
}
function appendEvents(events){
 const bytes=Buffer.from(events.map(e=>JSON.stringify(e)+'\n').join(''));
 const fd=openSync(ledgerPath(),constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
 try{
  verifyFile(fd);fchmodSync(fd,0o600);
  if(fstatSync(fd).size+bytes.length>maximumBytes)throw ledgerError('Ledger exceeds 64 MiB; archive it before continuing');
  if(writeSync(fd,bytes)!==bytes.length)throw ledgerError('Ledger append was incomplete; inspect the ledger before retrying');
  fsyncSync(fd);
 }finally{closeSync(fd);}
}
function locked(action){
 const path=ledgerPath()+'.lock';let fd;
 try{fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
 catch(error){if(error.code==='EEXIST')throw ledgerError('Ledger is locked; inspect an abandoned lock before removing it','LEDGER_BUSY');throw error;}
 try{return action();}finally{closeSync(fd);unlinkSync(path);}
}
export function appendReceipt({tool_name,args,result,inverse,reversible=true,notes,transaction_id}){
 const entry={id:randomUUID(),timestamp:new Date().toISOString(),transaction_id,tool_name,args,result_summary:summarize(result),inverse,reversible,rolled_back:false,notes};
 locked(()=>{readLedger({include_rolled_back:true});appendEvents([entry]);});
 return entry;
}
export function readLedger({limit,since,transaction_id,include_rolled_back=false}={}){
 if(limit!==undefined&&(!Number.isInteger(limit)||limit<1||limit>10000))throw ledgerError('Ledger limit must be an integer between 1 and 10000','INVALID_ARGUMENTS');
 if(since!==undefined&&(typeof since!=='string'||!Number.isFinite(Date.parse(since))))throw ledgerError('since must be a valid timestamp','INVALID_ARGUMENTS');
 if(transaction_id!==undefined&&(typeof transaction_id!=='string'||!transaction_id))throw ledgerError('transaction_id must be a non-empty string','INVALID_ARGUMENTS');
 let fd;
 try{fd=openSync(ledgerPath(),constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 let text;
 try{verifyFile(fd);text=readFileSync(fd,'utf8');}finally{closeSync(fd);}
 const entries=new Map();
 for(const [i,line]of text.split('\n').entries()){
  if(!line.trim())continue;
  let event;try{event=JSON.parse(line);}catch{throw ledgerError(`Corrupt ledger JSON at line ${i+1}`);}
  if(!event||typeof event!=='object')throw ledgerError(`Invalid ledger event at line ${i+1}`);
  if(event.event==='rollback_completed'){
   if(!Array.isArray(event.ids)||event.ids.some(id=>!entries.has(id)))throw ledgerError(`Invalid rollback event at line ${i+1}`);
   for(const id of event.ids)Object.assign(entries.get(id),{rolled_back:true,rolled_back_at:event.timestamp});
  }else{
   if(typeof event.id!=='string'||!event.id||typeof event.tool_name!=='string'||entries.has(event.id))throw ledgerError(`Invalid receipt at line ${i+1}`);
   entries.set(event.id,event);
  }
 }
 let result=[...entries.values()];
 if(!include_rolled_back)result=result.filter(e=>!e.rolled_back);
 if(since)result=result.filter(e=>Date.parse(e.timestamp)>=Date.parse(since));
 if(transaction_id)result=result.filter(e=>e.transaction_id===transaction_id||e.id===transaction_id);
 return limit===undefined?result:result.slice(-limit);
}
export function markRolledBack(ids){
 const idSet=new Set(Array.isArray(ids)?ids:[ids]);
 return locked(()=>{
  const entries=readLedger().filter(e=>idSet.has(e.id));
  if(entries.length)appendEvents([{event:'rollback_completed',timestamp:new Date().toISOString(),ids:entries.map(e=>e.id)}]);
  return entries.length;
 });
}
function summarize(result){
 if(result==null)return null;
 if(typeof result!=='object')return result;
 const summary={};
 for(const key of ['id','name','sha','number','host','url'])if(result[key]!==undefined)summary[key]=result[key];
 if(result.branch?.id)summary.branch_id=result.branch.id;
 if(result.branch?.name)summary.branch_name=result.branch.name;
 if(result.project?.id)summary.project_id=result.project.id;
 if(result.object?.sha)summary.sha=result.object.sha;
 if(result.content?.sha)summary.file_sha=result.content.sha;
 return Object.keys(summary).length?summary:null;
}
export default {appendReceipt,readLedger,markRolledBack,LEDGER_FILE};
