#!/usr/bin/env node
import 'dotenv/config';
import {createToolkit} from '../src/core/index.js';
import {PINNED_TOOLS} from '../src/adapters/mcp/surface.js';
import {auditToolkit} from '../src/core/audit.js';

const usage={commands:['search <intent> [--limit N] [--include-unavailable] [--json]','schema <tool> [--json]','exec <tool> --json <arguments-object>','namespaces [--json]','doctor [--json]','auth status [--json]','audit [duplicates] [--json]','mcp inspect [--json]','result read <id> [--cursor N] [--limit N]','result search <id> <query> [--cursor N] [--limit N]','serve'],exitCodes:{0:'success',2:'invalid input or unknown tool',3:'capability unavailable',4:'execution failure',5:'integrity failure'}};
let core;
try {
  const argv=process.argv.slice(2);
  if(!argv.length||argv.includes('--help')||argv[0]==='help'){
    process.stdout.write(JSON.stringify(usage,null,2)+'\n');
  }else{
    const positionals=[];let jsonArgs,limit,cursor=0,includeUnavailable=false;
    for(let i=0;i<argv.length;i++){
      const arg=argv[i];
      if(arg==='--json'){
        if(argv[0]==='exec'){
          if(jsonArgs!==undefined||argv[i+1]===undefined)throw new Error('exec requires one --json arguments object');
          jsonArgs=JSON.parse(argv[++i]);
        }
      }else if(arg==='--cursor'){
        if(argv[i+1]===undefined)throw new Error('--cursor requires an integer');cursor=Number(argv[++i]);
      }else if(arg==='--limit'){
        if(argv[i+1]===undefined)throw new Error('--limit requires an integer');limit=Number(argv[++i]);
      }else if(arg==='--include-unavailable')includeUnavailable=true;
      else if(arg.startsWith('--'))throw new Error('Unknown option: '+arg);
      else positionals.push(arg);
    }
    const [command,...args]=positionals;
    const arity=(min,max=min)=>{if(args.length<min||args.length>max)throw new Error('Invalid arguments for '+command);};
    core=await createToolkit();
    let result;
    switch(command){
      case 'search':arity(1,Infinity);result=core.search(args.join(' '),limit??8,{includeUnavailable});break;
      case 'schema':arity(1);result=core.schema(args[0]);if(!result)throw Object.assign(new Error('Unknown capability: '+args[0]),{code:'UNKNOWN_TOOL'});break;
      case 'exec':arity(1);if(jsonArgs===undefined)throw new Error('exec requires --json with an arguments object');result=await core.execute(args[0],jsonArgs);if(result?.success===false||result?.operationFailed===true)process.exitCode=4;break;
      case 'namespaces':arity(0);result=core.namespaces();break;
      case 'doctor':arity(0);result=core.doctor();break;
      case 'auth':arity(1);if(args[0]!=='status')throw new Error('Use auth status');result=core.doctor();break;
      case 'audit':arity(0,1);if(args.length&&args[0]!=='duplicates')throw new Error('Use audit or audit duplicates');result=await auditToolkit({duplicates:args[0]==='duplicates'});if(!result.passed)process.exitCode=5;break;
      case 'mcp':arity(1);if(args[0]!=='inspect')throw new Error('Use mcp inspect');result={underlyingCapabilities:core.registry.length,advertisedTools:PINNED_TOOLS.length,advertisedSchemaBytes:Buffer.byteLength(JSON.stringify(PINNED_TOOLS)),providerSchemasAdvertisedDirectly:0};break;
      case 'result':
        if(args[0]==='read'){arity(2);result=core.results.read(args[1],{cursor,limit:limit??4096});}
        else if(args[0]==='search'){arity(3);result=core.results.search(args[1],args[2],{cursor,limit:limit??10});}
        else throw new Error('Use result read or result search');
        break;
      case 'serve':arity(0);await import('../index.js');break;
      default:throw new Error('Unknown command: '+command);
    }
    if(command!=='serve')process.stdout.write(JSON.stringify({ok:!process.exitCode,result:core.results.deliver(result)},null,2)+'\n');
  }
}catch(error){
  const code=error.code||'INVALID_ARGUMENTS';
  process.exitCode=code==='CAPABILITY_UNAVAILABLE'?3:['INVALID_ARGUMENTS','UNKNOWN_TOOL'].includes(code)||error instanceof SyntaxError?2:4;
  const result={ok:false,error:core?core.errorResult(error):{code,message:error.message.slice(0,2048),...(error.message.length>2048?{truncated:true}:{})}};
  process.stdout.write(JSON.stringify(core?core.redact(result):result)+'\n');
}
