import {currentWorkspace} from './context.js';
import {mkdirSync,lstatSync,openSync,closeSync,writeFileSync,readFileSync,readSync,fstatSync,readdirSync,unlinkSync,constants} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
const validId=/^res_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail=(message,code='INVALID_ARGUMENTS')=>Object.assign(new Error(message),{code});
export function defaultResultDirectory(){
 const workspace=resolve(currentWorkspace());
 return join(process.env.TOOLKIT_STATE_DIR||join(homedir(),'.local','state','robinsons-toolkit'),createHash('sha256').update(workspace).digest('hex').slice(0,20),'results');
}
export class ResultStore {
 constructor({directory=defaultResultDirectory(),inlineBytes=16384,inlineRecords=100,maxResultBytes=32*1024*1024,maxStoreBytes=128*1024*1024,ttlMs=86400000,redact=value=>value}={}){
  for(const value of [inlineBytes,inlineRecords,maxResultBytes,maxStoreBytes,ttlMs])if(!Number.isSafeInteger(value)||value<1)throw fail('Result limits must be positive safe integers');
  this.directory=resolve(directory);Object.assign(this,{inlineBytes,inlineRecords,maxResultBytes,maxStoreBytes,ttlMs,redact});
 }
 ensure(){mkdirSync(this.directory,{recursive:true,mode:0o700});if(lstatSync(this.directory).isSymbolicLink())throw fail('Result directory must not be a symlink','RESULT_STORE_FAILED');}
 path(id){if(!validId.test(id))throw fail('Invalid result ID');return join(this.directory,id+'.json');}
 open(id){
  this.ensure();
  let fd;
  try{
   const path=this.path(id);if(lstatSync(path).isSymbolicLink())throw fail('Result file must not be a symlink');
   fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
   const stat=fstatSync(fd);
   if(!stat.isFile()||stat.size>this.maxResultBytes)throw fail('Invalid result file');
   if(Date.now()-stat.mtimeMs>this.ttlMs)throw fail('Result expired','RESULT_EXPIRED');
   return {fd,stat};
  }catch(error){if(fd!==undefined)closeSync(fd);if(error.code==='ENOENT')throw fail('Result not found','RESULT_NOT_FOUND');throw error;}
 }
 deliver(input){
  const value=this.redact(input);
  const text=JSON.stringify(value);
  if(text===undefined)return null;
  const bytes=Buffer.byteLength(text);
  const arrays=Array.isArray(value)?[value]:value&&typeof value==='object'?Object.values(value).filter(Array.isArray):[];
  const records=arrays.length?Math.max(...arrays.map(a=>a.length)):null;
  if(bytes<=this.inlineBytes&&(records===null||records<=this.inlineRecords))return value;
  let fd,path,lock;
  try{
   if(bytes>this.maxResultBytes)throw new Error('Result exceeds configured storage limit');
   this.ensure();
   lock=openSync(join(this.directory,'.write-lock'),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);
   let used=0;
   for(const file of readdirSync(this.directory)){
    if(!validId.test(file.replace(/\.json$/,'')))continue;
    const p=join(this.directory,file),stat=lstatSync(p);
    if(stat.isSymbolicLink()||!stat.isFile())continue;
    if(Date.now()-stat.mtimeMs>this.ttlMs)unlinkSync(p);else used+=stat.size;
   }
   if(used+bytes>this.maxStoreBytes)throw new Error('Result store quota exceeded');
   const id='res_'+randomUUID();path=this.path(id);
   fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW||0),0o600);
   writeFileSync(fd,text,'utf8');closeSync(fd);fd=undefined;
   return {stored:true,resultId:id,byteCount:bytes,recordCount:records,operationFailed:value?.success===false||value?.isError===true,
    summary:'Full redacted output stored; no payload was silently truncated.',
    warnings:['Use result read with nextCursor to retrieve the entire output.'],
    read:{command:`rt result read ${id}`,cursor:0},search:{command:`rt result search ${id} <query>`}};
  }catch(error){
   if(fd!==undefined)closeSync(fd);
   if(path){try{unlinkSync(path);}catch{}}
   throw fail(`Output could not be stored: ${error.message}. The operation may already have completed; do not automatically repeat a mutation.`,'RESULT_STORE_FAILED');
  }finally{if(lock!==undefined){closeSync(lock);unlinkSync(join(this.directory,'.write-lock'));}}
 }
 read(id,{cursor=0,limit=4096}={}){
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<4||limit>16384)throw fail('cursor must be nonnegative; limit must be 4–16384 bytes');
  const {fd,stat}=this.open(id);
  try{
   if(cursor>stat.size)throw fail('Cursor exceeds result size');
   const buffer=Buffer.alloc(Math.min(limit+1,stat.size-cursor));
   const n=readSync(fd,buffer,0,buffer.length,cursor);
   if(n&&(buffer[0]&0xc0)===0x80)throw fail('Cursor is not a UTF-8 boundary');
   let end=Math.min(n,limit);
   while(end>0&&end<n&&(buffer[end]&0xc0)===0x80)end--;
   return {resultId:id,byteCount:stat.size,cursor,nextCursor:cursor+end<stat.size?cursor+end:null,content:buffer.subarray(0,end).toString('utf8'),complete:cursor+end===stat.size};
  }finally{closeSync(fd);}
 }
 search(id,query,{cursor=0,limit=10}={}){
  if(typeof query!=='string'||!query||query.length>256||!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>20)throw fail('Provide a 1–256 character query, nonnegative cursor and limit 1–20');
  const {fd,stat}=this.open(id);
  try{
   const text=readFileSync(fd,'utf8');
   if(cursor>text.length)throw fail('Cursor exceeds result length');
   const matches=[];let position=cursor;
   while(matches.length<limit){const found=text.indexOf(query,position);if(found<0){position=text.length;break;}matches.push({offset:found,snippet:text.slice(Math.max(0,found-80),found+query.length+80)});position=found+query.length;}
   return {resultId:id,query,byteCount:stat.size,matches,nextCursor:position<text.length?position:null,cursorUnit:'UTF-16 characters; read cursors use bytes'};
  }finally{closeSync(fd);}
 }
}
