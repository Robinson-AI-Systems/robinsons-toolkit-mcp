import {validateArgs} from '../../core/validation.js';
import {PINNED_TOOLS} from './surface.js';
export async function callBroker(core,name,args={}){
  try{
    const invalid=validateArgs(name,args,PINNED_TOOLS);
    if(invalid)throw Object.assign(new Error(invalid),{code:'INVALID_ARGUMENTS'});
    let result;
    switch(name){
      case 'search_toolkit':result=core.search(args.query,args.limit??8,{includeUnavailable:args.include_unavailable===true});break;
      case 'list_namespaces':result=core.doctor();break;
      case 'get_tool_schema':
        result=core.schema(args.tool_name);
        if(!result)throw Object.assign(new Error('Unknown capability: '+args.tool_name),{code:'UNKNOWN_TOOL'});
        break;
      case 'toolkit_transaction':
        result=args.action==='list'?core.transactions.list({limit:args.limit}):await core.transactions.rollback(args.id,{dryRun:args.dry_run});break;
      case 'toolkit_result_read':result=core.results.read(args.id,{cursor:args.cursor,limit:args.limit});break;
      case 'toolkit_result_search':result=core.results.search(args.id,args.query,{cursor:args.cursor,limit:args.limit});break;
      case 'execute_tool':result=await core.execute(args.tool_name,args.args);break;
      default:
        // Existing directly pinned tool calls still work, but their schemas stay hidden.
        if(!core.schema(name))throw Object.assign(new Error('Unknown tool: '+name),{code:'UNKNOWN_TOOL'});
        result=await core.execute(name,args);
    }
    return {isError:result?.success===false||result?.operationFailed===true,content:[{type:'text',text:JSON.stringify(core.results.deliver(result))}]};
  }catch(error){return {isError:true,content:[{type:'text',text:JSON.stringify(core.errorResult(error))}]};}
}
