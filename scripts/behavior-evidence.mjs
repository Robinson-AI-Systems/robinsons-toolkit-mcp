import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean=node=>JSON.parse(JSON.stringify(node,(key,value)=>['start','end','loc','raw'].includes(key)?undefined:value));
const methods=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
function visit(node,fn){if(!node||typeof node!=='object')return;if(node.type)fn(node);for(const [key,value]of Object.entries(node)){if(key==='loc')continue;if(Array.isArray(value))value.forEach(n=>visit(n,fn));else if(value&&typeof value==='object')visit(value,fn);}}
function route(node){
 if(node?.type==='Literal'&&typeof node.value==='string'&&/^(\/|https?:\/\/)/.test(node.value))return node.value;
 if(node?.type==='TemplateLiteral'&&node.quasis.some(q=>q.value.cooked?.includes('/')))return node.quasis.map((q,i)=>q.value.cooked+(i<node.expressions.length?'{parameter}':'')).join('');
 return undefined;
}
export function behaviorEvidence(node){
 const endpoints=[],returns=[],childTools=[];
 visit(node,child=>{
  if(child.type==='ReturnStatement')returns.push(clean(child.argument));
  if(child.type!=='CallExpression')return;
  if(child.callee.type==='MemberExpression'&&child.callee.property?.name==='execute'&&typeof child.arguments[0]?.value==='string')childTools.push(child.arguments[0].value);
  const path=child.arguments.map(route).find(Boolean);if(!path)return;
  let method=child.arguments.find(arg=>arg.type==='Literal'&&methods.has(arg.value))?.value;
  for(const arg of child.arguments)if(arg.type==='ObjectExpression')for(const property of arg.properties)if((property.key?.name||property.key?.value)==='method'&&methods.has(property.value?.value))method=property.value.value;
  const helper=child.callee.type==='Identifier'?child.callee.name:child.callee.property?.name||'dynamic';
  if(!method&&helper==='fetch')method='GET';
  endpoints.push({helper,method:method||'UNKNOWN',route:path});
 });
 const knownMethods=endpoints.filter(e=>e.method!=='UNKNOWN').map(e=>e.method);
 return {endpoints,childTools:[...new Set(childTools)],outputFingerprint:digest(returns),
  transportBehavior:knownMethods.length===0?'UNKNOWN':knownMethods.every(m=>['GET','HEAD','OPTIONS'].includes(m))?'READ_REQUESTS':'INCLUDES_NON_READ_HTTP_METHOD',
  limits:'Static direct calls only; dynamic helpers, SQL/GraphQL semantics and external side effects require review.'};
}
export function stableSchema(value){
 if(Array.isArray(value))return value.map(stableSchema);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,key==='required'&&Array.isArray(value[key])?[...value[key]].sort():stableSchema(value[key])]));
 return value;
}
export function compareBehavior(a,b,ea,eb){
 const aa=a.behavior||{},bb=b.behavior||{};
 const endpointKey=e=>`${e.method} ${e.route}`;
 const as=new Set((aa.endpoints||[]).filter(e=>e.method!=='UNKNOWN').map(endpointKey));
 const bs=new Set((bb.endpoints||[]).filter(e=>e.method!=='UNKNOWN').map(endpointKey));
 const sharedEndpoints=[...as].filter(e=>bs.has(e));
 const ap=Object.keys(ea.inputSchema?.properties||{}),bp=Object.keys(eb.inputSchema?.properties||{});
 const subset=(x,y)=>x.length<y.length&&x.every(v=>y.includes(v));
 const sameSchema=JSON.stringify(stableSchema(ea.inputSchema))===JSON.stringify(stableSchema(eb.inputSchema));
 return {sameSchema,sharedEndpoints,sameEndpoints:as.size>0&&as.size===bs.size&&sharedEndpoints.length===as.size,
  schemaRelation:sameSchema?'IDENTICAL':subset(ap,bp)?'A_PROPERTIES_SUBSET':subset(bp,ap)?'B_PROPERTIES_SUBSET':'DIFFERENT',
  requiredParameters:[...(ea.inputSchema?.required||[])].sort().join(',')===[...(eb.inputSchema?.required||[])].sort().join(',')?'SAME':'DIFFERENT',
  outputBehavior:aa.outputFingerprint&&aa.outputFingerprint===bb.outputFingerprint?'IDENTICAL_RETURN_AST':'DIFFERENT_OR_UNKNOWN',
  transportBehavior:[aa.transportBehavior||'UNKNOWN',bb.transportBehavior||'UNKNOWN'],
  semanticSimilarity:null,semanticNote:'No embedding model configured; description overlap is lexical evidence only.'};
}
