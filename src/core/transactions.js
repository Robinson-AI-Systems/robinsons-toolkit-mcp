import {readLedger,markRolledBack,recordRollbackAttempt,recordRollbackUncertain,withRollbackLease} from '../../ledger.js';
const invalid=message=>Object.assign(new Error(message),{code:'INVALID_ARGUMENTS'});
function selection({last_n,since,transaction_id}){
 if(last_n===undefined&&since===undefined&&transaction_id===undefined)throw invalid('Provide last_n, since or transaction_id');
 const entries=readLedger({limit:last_n,since,transaction_id});
 if(!entries.length)throw invalid('No outstanding receipts match this transaction selection');
 const pending=entries.filter(e=>e.rollback_state==='IN_PROGRESS'||e.rollback_state==='UNKNOWN');
 const irreversible=entries.filter(e=>!pending.includes(e)&&(!e.reversible||!e.inverse?.tool));
 const eligible=entries.filter(e=>!pending.includes(e)&&!irreversible.includes(e)).reverse();
 return {eligible,pending,irreversible};
}
export async function rollbackTransaction(options,execute){
 if(options.dry_run!==undefined&&typeof options.dry_run!=='boolean')throw invalid('dry_run must be a boolean');
 const run=async()=>{
  const {eligible,pending,irreversible}=selection(options);
  const plan=eligible.map(e=>({id:e.id,timestamp:e.timestamp,original:e.tool_name,inverse:e.inverse.tool,inverse_args:e.inverse.args}));
  const skipped=irreversible.map(e=>({id:e.id,tool:e.tool_name,status:'IRREVERSIBLE',notes:e.notes}));
  const unresolved=pending.map(e=>({id:e.id,tool:e.tool_name,status:'UNKNOWN',note:'An earlier rollback may have reached the provider. Manual reconciliation is required before retrying.'}));
  if(options.dry_run)return {dry_run:true,will_reverse:unresolved.length?0:plan.length,blocked:unresolved.length>0,skipped_non_reversible:skipped.length,plan,skipped,unresolved};
  if(unresolved.length)return {success:false,reverted:0,compensated:0,reversed:0,failed:0,skipped_non_reversible:skipped.length,executed:[],failed_details:[],skipped,unresolved,not_attempted:plan.map(e=>e.id)};
  const executed=[],failed=[];
  for(const step of plan){
   let attempted=false;
   try{
    recordRollbackAttempt(step.id);attempted=true;
    const result=await execute(step.inverse,step.inverse_args);
    if(result?.success===false||result?.operationFailed===true)throw new Error('Inverse operation reported failure');
    if(markRolledBack(step.id)!==1)throw new Error('Rollback completion receipt could not be recorded');
    executed.push({id:step.id,inverse:step.inverse,status:'COMPENSATED',result});
   }catch(error){
    if(attempted){try{recordRollbackUncertain(step.id);}catch{/* The durable attempt still prevents automatic replay. */}}
    failed.push({id:step.id,inverse:step.inverse,status:'ROLLBACK_FAILED',error:error.message,operationMayHaveCompleted:attempted});
    // A failed dependent compensation makes earlier actions unsafe to reverse.
    break;
   }
  }
  return {success:failed.length===0&&skipped.length===0&&unresolved.length===0,reverted:0,compensated:executed.length,reversed:executed.length,failed:failed.length,skipped_non_reversible:skipped.length,executed,failed_details:failed,skipped,unresolved,not_attempted:plan.slice(executed.length+failed.length).map(e=>e.id)};
 };
 return options.dry_run?run():withRollbackLease(run);
}
