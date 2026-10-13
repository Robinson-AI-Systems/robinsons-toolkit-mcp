import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {currentWorkspace,currentWriteRoots} from '../context.js';
import {sanitizedEnvironment,assertWriteAllowed} from './restricted-host.js';
import {findExecutable} from './executables.js';

/** Structured Git invocation. Repository configuration is still trusted code. */
export function workspaceGit(projectPath=''){
 const roots=currentWriteRoots()||[currentWorkspace()];
 const cwd=assertWriteAllowed(resolve(currentWorkspace(),projectPath),roots);
 const executable=findExecutable('git');
 if(!executable)throw Object.assign(new Error('Git must be installed on an absolute PATH entry'),{code:'CAPABILITY_UNAVAILABLE'});
 const options={cwd,env:sanitizedEnvironment(),encoding:'utf8',timeout:30000,maxBuffer:1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']};
 const invoke=args=>execFileSync(executable,args,options).trim();
 // Reject linked worktrees and redirected Git metadata outside the write roots.
 const paths=invoke(['rev-parse','--path-format=absolute','--git-dir','--git-common-dir','--show-toplevel']).split('\n');
 if(paths.length!==3)throw new Error('Unable to determine Git workspace boundaries');
 for(const path of paths)assertWriteAllowed(path,roots);
 return {
  stage(files){
   const paths=Array.isArray(files)?files:[files];
   if(!paths.length||paths.some(path=>typeof path!=='string'||!path.length))throw new Error('files must be a path string or non-empty array of paths');
   return invoke(['add','--',...paths]);
  },
  commit(message){if(typeof message!=='string'||!message.trim())throw new Error('A non-empty commit message is required');return invoke(['commit','--message',message]);},
  push(branch){
   if(branch!==undefined){if(typeof branch!=='string'||!branch)throw new Error('branch must be a non-empty branch name');invoke(['check-ref-format','--branch',branch]);}
   return invoke(branch?['push','--','origin',branch]:['push','--','origin','HEAD']);
  }
 };
}
