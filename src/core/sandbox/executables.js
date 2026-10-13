import {accessSync,statSync,constants} from 'node:fs';
import {delimiter,isAbsolute,join} from 'node:path';
/** Resolve a named native executable without invoking a shell or searching cwd. */
export function findExecutable(name,path=process.env.PATH||''){
 if(!/^[a-zA-Z0-9_.-]+$/.test(name))return undefined;
 const suffixes=process.platform==='win32'?['.exe','.com']:[''];
 for(const directory of path.split(delimiter).filter(isAbsolute))for(const suffix of suffixes){
  const candidate=join(directory,name+suffix);
  try{if(statSync(candidate).isFile()){accessSync(candidate,constants.X_OK);return candidate;}}catch{}
 }
 return undefined;
}
