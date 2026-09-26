import {mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,readdirSync,lstatSync,realpathSync,openSync,closeSync,fstatSync,constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
const namePattern=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const invalid=message=>Object.assign(new Error(message),{code:'INVALID_ARGUMENTS'});
export function validateProfile(profile){
 if(!profile||typeof profile!=='object'||Array.isArray(profile))throw invalid('Profile must be an object');
 for(const key of Object.keys(profile))if(!['name','workspace','allowedCapabilities','deniedCapabilities'].includes(key))throw invalid('Unknown profile field; secrets and provider defaults are not accepted');
 if(typeof profile.name!=='string'||profile.name==='active'||!namePattern.test(profile.name))throw invalid('Invalid profile name');
 if(typeof profile.workspace!=='string')throw invalid('Profile workspace must be an existing directory path');
 const workspace=realpathSync(resolve(profile.workspace));
 if(!lstatSync(workspace).isDirectory())throw invalid('Profile workspace must be a directory');
 const copy={name:profile.name,workspace};
 for(const key of ['allowedCapabilities','deniedCapabilities'])if(profile[key]!==undefined){
  if(!Array.isArray(profile[key])||profile[key].some(name=>typeof name!=='string'||!/^([a-z][a-z0-9_]*\*?|\*)$/.test(name)))throw invalid('Capability policies must contain names or prefix patterns');
  copy[key]=[...new Set(profile[key])];
 }
 return copy;
}
export class ProfileStore{
 constructor(directory=join(process.env.TOOLKIT_STATE_DIR||join(homedir(),'.local','state','robinsons-toolkit'),'profiles')){this.directory=resolve(directory);}
 ensure(){mkdirSync(this.directory,{recursive:true,mode:0o700});if(lstatSync(this.directory).isSymbolicLink())throw invalid('Profile directory cannot be a symlink');}
 path(name){if(typeof name!=='string'||!namePattern.test(name))throw invalid('Invalid profile name');return join(this.directory,name+'.json');}
 readFile(path){
  let fd;try{fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const st=fstatSync(fd);if(!st.isFile()||st.size>65536)throw invalid('Invalid profile file');return JSON.parse(readFileSync(fd,'utf8'));}finally{if(fd!==undefined)closeSync(fd);}
 }
 get(name){this.ensure();const p=validateProfile(this.readFile(this.path(name)));if(p.name!==name)throw invalid('Profile filename/name mismatch');return p;}
 create(profile){const value=validateProfile(profile);this.ensure();writeFileSync(this.path(value.name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});return value;}
 list(){try{if(lstatSync(this.directory).isSymbolicLink())throw invalid('Profile directory cannot be a symlink');return readdirSync(this.directory).filter(n=>n.endsWith('.json')&&n!=='active.json').sort().map(n=>this.get(n.slice(0,-5)));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 active(){
  let marker;
  try{if(lstatSync(this.directory).isSymbolicLink())throw invalid('Profile directory cannot be a symlink');marker=this.readFile(join(this.directory,'active.json'));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  return this.get(marker.name);
 }
 use(name){const profile=this.get(name);const temp=join(this.directory,`active-${randomUUID()}.tmp`);try{writeFileSync(temp,JSON.stringify({name})+'\n',{flag:'wx',mode:0o600});renameSync(temp,join(this.directory,'active.json'));}finally{try{unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}return profile;}
}
const matches=(name,pattern)=>pattern==='*'||(pattern.endsWith('*')?name.startsWith(pattern.slice(0,-1)):name===pattern);
export function policyAllows(profile,name){
 if(!profile)return true;
 if(profile.deniedCapabilities?.some(p=>matches(name,p)))return false;
 return !profile.allowedCapabilities||profile.allowedCapabilities.some(p=>matches(name,p));
}
