import {PINNED_TOOLS} from './surface.js';
import {callBroker} from './broker.js';
async function modernSdk(){
 if(Number(process.versions.node.split('.')[0])<20)throw new Error('Modern MCP requires Node.js 20 or newer; use legacy stdio on Node.js 18.');
 try{return await import('@modelcontextprotocol/server');}
 catch(error){if(error.code==='ERR_MODULE_NOT_FOUND')throw new Error('Modern MCP dependency is unavailable. Install optional dependencies to enable this adapter.');throw error;}
}
function factory(Server,core){
 return ()=>{
  const server=new Server({name:'robinsons-toolkit',version:'2.0.0'},{capabilities:{tools:{}}});
  server.setRequestHandler('tools/list',async()=>({tools:PINNED_TOOLS}));
  server.setRequestHandler('tools/call',async({params:{name,arguments:args={}}})=>callBroker(core,name,args));
  return server;
 };
}
export async function startModernStdio(core){
 const {Server}=await modernSdk();
 const {serveStdio}=await import('@modelcontextprotocol/server/stdio');
 return serveStdio(factory(Server,core),{legacy:'serve',onerror:error=>console.error(core.redact(error.message))});
}
/** Host-owned authentication: one Core/profile per adapter, no public listener. */
export async function createAuthenticatedHttpAdapter({core,authorize}){
 if(!core||typeof authorize!=='function')throw new Error('HTTP requires a Core instance and an explicit authorization callback');
 const {Server,createMcpHandler}=await modernSdk();
 const handler=createMcpHandler(factory(Server,core),{legacy:'stateless'});
 return {
  async fetch(request){
   // The host must verify tokens, scopes and Origin before returning true.
   let allowed=false;try{allowed=await authorize(request)===true;}catch{return new Response('Authorization unavailable',{status:503});}
   if(!allowed)return new Response('Unauthorized',{status:401,headers:{'Cache-Control':'no-store'}});
   return handler.fetch(request);
  },
  close:()=>handler.close()
 };
}
