import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readFileSync,openSync,closeSync,fstatSync,writeFileSync,fsyncSync,renameSync,rmSync,constants} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {currentWorkspace,currentWriteRoots} from '../context.js';
import {EnvironmentCredentials} from '../credentials.js';
import {sanitizedEnvironment,assertWriteAllowed} from './restricted-host.js';
export const supportedMigrationCommands=['npx prisma db push','prisma db push','npm exec -- prisma db push'];
const roots=()=>currentWriteRoots()||[currentWorkspace()];
export const environmentFilePath=path=>assertWriteAllowed(resolve(currentWorkspace(),path||'.env.local'),roots());

/** Fixed, installed project CLI; never npx-download or interpolate a shell. */
export function prepareSchemaPush(command='npx prisma db push'){
 if(!supportedMigrationCommands.includes(command))throw Object.assign(new Error('Automatic schema push supports the installed Prisma db push command only. Custom shell commands cannot receive Toolkit database credentials.'),{code:'INVALID_ARGUMENTS'});
 const workspace=currentWorkspace();
 let packageFile;
 try{packageFile=createRequire(join(workspace,'package.json')).resolve('prisma/package.json');}
 catch{throw Object.assign(new Error('Install Prisma in the selected project before requesting schema push'),{code:'CAPABILITY_UNAVAILABLE'});}
 packageFile=assertWriteAllowed(packageFile,roots());
 const pkg=JSON.parse(readFileSync(packageFile,'utf8'));
 const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.prisma;
 if(pkg.name!=='prisma'||typeof bin!=='string'||!bin)throw new Error('Installed Prisma package has no CLI entry');
 const entry=assertWriteAllowed(resolve(dirname(packageFile),bin),roots());
 const fd=openSync(entry,constants.O_RDONLY|constants.O_NOFOLLOW);try{if(!fstatSync(fd).isFile())throw new Error('Prisma CLI entry must be a regular file');}finally{closeSync(fd);}
 return connectionString=>{
  if(typeof connectionString!=='string'||!connectionString)throw new Error('A database connection is required for schema push');
  let password;try{password=decodeURIComponent(new URL(connectionString).password);}catch{}
  const redact=new EnvironmentCredentials({DATABASE_URL:connectionString,DATABASE_PASSWORD:password});
  try{
   const result=spawnSync(process.execPath,[entry,'db','push'],{cwd:workspace,env:{...sanitizedEnvironment(),DATABASE_URL:connectionString},encoding:'utf8',timeout:120000,maxBuffer:1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']});
   if(result.error||result.status!==0)throw new Error(`${result.error?.code||result.signal||result.status}: ${result.stderr||''}`);
   return (result.stdout||'')+(result.stderr?'\n[stderr]\n'+result.stderr:'');
  }catch(error){throw Object.assign(new Error(redact.redact(`Prisma schema push failed: ${error.message}`)),{code:'EXECUTION_FAILED',operationMayHaveCompleted:true});}
 };
}
export function writeDatabaseEnvironment(path,connectionString){
 if(typeof connectionString!=='string'||!connectionString||/[\r\n\0]/.test(connectionString))throw new Error('Database connection must be a single-line string');
 const target=environmentFilePath(path);let content='';let fd;
 try{
  fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW);
  const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>1024*1024)throw new Error('Environment file must be a regular, single-link file under 1 MiB');
  content=readFileSync(fd,'utf8');
 }catch(error){if(error.code!=='ENOENT')throw error;}finally{if(fd!==undefined)closeSync(fd);}
 const line='DATABASE_URL='+JSON.stringify(connectionString);
 content=/^DATABASE_URL=.*/m.test(content)?content.replace(/^DATABASE_URL=.*/m,()=>line):content.trimEnd()+'\n'+line+'\n';
 const temporary=join(dirname(target),'.'+basename(target)+'.'+randomUUID()+'.tmp');
 try{
  fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,content);fsyncSync(fd);}finally{closeSync(fd);}
  environmentFilePath(target);renameSync(temporary,target);
 }finally{rmSync(temporary,{force:true});}
 return target;
}
