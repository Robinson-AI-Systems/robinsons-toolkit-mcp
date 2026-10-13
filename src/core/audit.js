import {fileURLToPath} from 'node:url';
export async function auditToolkit({duplicates=false,root=fileURLToPath(new URL('../../',import.meta.url))}={}){
  const {inventory,duplicateCandidates}=await import('../../scripts/inventory.mjs');
  const data=inventory(root);
  if(duplicates){
    const candidates=duplicateCandidates(data);
    return {passed:data.duplicateNames.length===0,exactDuplicateNames:data.duplicateNames,candidates,notice:'Candidates require review; no automatic merges.'};
  }
  const failures=[...data.duplicateNames,...data.repeatedDispatchNames,...data.mismatches.registryWithoutHandler,...data.mismatches.handlerWithoutRegistry,...data.findings];
  return {passed:failures.length===0,counts:data.counts,failures};
}
