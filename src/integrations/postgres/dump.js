import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,openSync,closeSync,rmSync,renameSync,statSync,constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {currentWorkspace,currentWriteRoots} from '../../core/context.js';
import {sanitizedEnvironment,assertWriteAllowed} from '../../core/sandbox/restricted-host.js';
import {findExecutable} from '../../core/sandbox/executables.js';
import {EnvironmentCredentials} from '../../core/credentials.js';

function connection(uri){
 let url;try{url=new URL(uri);}catch{throw new Error('Backup requires a valid PostgreSQL connection URI');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username)throw new Error('Backup requires a PostgreSQL URI with an explicit host and user');
 // Service/passfile references may resolve unrelated host credentials. A backup
 // uses only the credential supplied for this connection.
 for(const key of ['service','servicefile','passfile'])if(url.searchParams.has(key))throw new Error(`Backup does not accept connection option ${key}`);
 let user,password,database;
 try{user=decodeURIComponent(url.username);password=url.searchParams.get('password')??decodeURIComponent(url.password);database=decodeURIComponent(url.pathname.slice(1))||user;}catch{throw new Error('Invalid percent encoding in PostgreSQL connection URI');}
 if([user,password,database].some(s=>/[\r\n\0]/.test(s)))throw new Error('PostgreSQL connection fields must not contain line breaks or NUL');
 // Host/user/database overrides would make the password-file entry ambiguous.
 for(const key of ['host','hostaddr','port','user','dbname'])if(url.searchParams.has(key))throw new Error(`Place ${key} in the URI authority/path for backup operations`);
 const escape=value=>value.replace(/\\/g,'\\\\').replace(/:/g,'\\:');
 const passwordLine=[url.hostname.replace(/^\[|\]$/g,''),url.port||'5432',database,user,password].map(escape).join(':')+'\n';
 url.password='';url.searchParams.delete('password');
 return {safeUri:url.href,password,passwordLine};
}
export function dumpPostgres({connectionString,outputPath,schema='public',table,format='plain',schemaOnly=false}){
 if(typeof outputPath!=='string'||!outputPath)throw new Error('output_path is required');
 if(!['plain','custom'].includes(format))throw new Error('Backup format must be plain or custom');
 const executable=findExecutable('pg_dump');
 if(!executable)throw Object.assign(new Error('pg_dump must be installed on an absolute PATH entry'),{code:'CAPABILITY_UNAVAILABLE'});
 const workspace=currentWorkspace();
 const roots=currentWriteRoots()||[workspace];
 const target=assertWriteAllowed(resolve(workspace,outputPath),roots);
 const config=connection(connectionString);
 const redact=new EnvironmentCredentials({POSTGRES_CONNECTION_STRING:connectionString,POSTGRES_PASSWORD:config.password});
 const temporary=mkdtempSync(join(tmpdir(),'rt-pgpass-'));
 const passfile=join(temporary,'pgpass');
 const pending=join(dirname(target),'.'+basename(target)+'.'+randomUUID()+'.partial');
 let fd;
 try{
  writeFileSync(passfile,config.passwordLine,{mode:0o600,flag:'wx'});
  fd=openSync(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  const args=['--no-password','--dbname',config.safeUri];
  if(schemaOnly)args.push('--schema-only','--schema',schema);
  else args.push('--table',`${schema}.${table}`,'--format',format);
  const child=spawnSync(executable,args,{cwd:workspace,env:{...sanitizedEnvironment(),PGPASSFILE:passfile,PGCONNECT_TIMEOUT:'10'},stdio:['ignore',fd,'pipe'],encoding:'utf8',timeout:120000,maxBuffer:1024*1024,windowsHide:true});
  closeSync(fd);fd=undefined;
  if(child.error||child.status!==0)throw Object.assign(new Error(redact.redact(`pg_dump failed: ${child.error?.code||child.signal||child.status}; ${child.stderr||''}`)),{code:child.error?.code==='ENOENT'?'CAPABILITY_UNAVAILABLE':'EXECUTION_FAILED'});
  assertWriteAllowed(target,roots);
  const bytes=statSync(pending).size;
  renameSync(pending,target);
  return {success:true,output_path:target,bytes,format,warnings:child.stderr?redact.redact(child.stderr):undefined};
 }finally{
  if(fd!==undefined)closeSync(fd);
  rmSync(pending,{force:true});rmSync(temporary,{recursive:true,force:true});
 }
}
