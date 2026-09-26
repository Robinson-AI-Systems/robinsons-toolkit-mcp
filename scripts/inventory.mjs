import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';

export function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
export const canonical = value => JSON.stringify(value, (key, item) =>
  ['start', 'end', 'loc', 'raw'].includes(key) ? undefined : item);
const hash = value => createHash('sha256').update(value).digest('hex');
function dispatchNames(node) {
  const names = [];
  walk(node, n => {
    if (n.type === 'BinaryExpression' && ['===','=='].includes(n.operator)) {
      for (const [a,b] of [[n.left,n.right],[n.right,n.left]])
        if (a.type === 'Identifier' && a.name === 'tool' && typeof b.value === 'string') names.push(b.value);
    }
  });
  return names;
}
export function analyzeHandler(source, file) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const branches = [];
  const findings = [];
  const imports = [];
  walk(ast, node => {
    if (node.type === 'ImportDeclaration' || node.type === 'ImportExpression') {
      if (typeof node.source?.value === 'string') imports.push(node.source.value);
    }
    if (node.type === 'IfStatement') {
      for (const name of dispatchNames(node.test)) {
        const calls = [];
        walk(node.consequent, child => {
          if (child.type === 'CallExpression') calls.push(source.slice(child.start, child.end));
        });
        branches.push({ name, file, line: node.loc.start.line,
          implementationFingerprint: hash(canonical(node.consequent)), calls,
          body: source.slice(node.consequent.start,node.consequent.end) });
      }
    }
    // Literal inspection excludes comments and legitimate route interception tools.
    const text = node.type === 'Literal' && typeof node.value === 'string' ? node.value :
      node.type === 'TemplateLiteral' ? source.slice(node.start,node.end) : null;
    if (text && /\b(TODO|not implemented|placeholder|dummy response|fake response)\b/i.test(text))
      findings.push({file, line:node.loc.start.line, rule:'placeholder-literal', evidence:text.slice(0,200), disposition:'review-required'});
    if (text && /\[Tool .*called with:/.test(text))
      findings.push({file, line:node.loc.start.line, rule:'fabricated-tool-result', evidence:text.slice(0,200), disposition:'confirmed-false-tool-result'});
    if (node.type === 'FunctionDeclaration' && node.body.body.length === 0)
      findings.push({file,line:node.loc.start.line,rule:'empty-function', disposition:'review-required'});
  });
  return {branches, findings, imports:[...new Set(imports)]};
}
export function inventory(root) {
  const entries=[], branches=[], findings=[], modules=[];
  for (const file of readdirSync(join(root,'registry')).filter(f=>f.endsWith('.json')).sort()) {
    const namespace=file.slice(0,-5);
    for (const tool of JSON.parse(readFileSync(join(root,'registry',file),'utf8')))
      entries.push({...tool, registryNamespace:namespace, registryFile:`registry/${file}`});
  }
  for (const file of readdirSync(join(root,'handlers')).filter(f=>f.endsWith('.js')).sort()) {
    const path=`handlers/${file}`;
    const source=readFileSync(join(root,path),'utf8');
    let analysis;
    try { analysis=analyzeHandler(source,path); }
    catch(error) {
      analysis={branches:[...source.matchAll(/tool === ['"]([^'"]+)['"]/g)].map(m=>({name:m[1],file:path,line:source.slice(0,m.index).split('\n').length,calls:[],body:null,implementationFingerprint:null,unparsed:true})),
        findings:[{file:path,line:error.loc?.line,rule:'syntax-error',evidence:error.message,disposition:'confirmed-broken-module'}],imports:[]};
    }
    branches.push(...analysis.branches);
    findings.push(...analysis.findings);
    modules.push({file:path, imports:analysis.imports});
  }
  const scanAdditional=(directory)=>{
    for(const entry of readdirSync(join(root,directory),{withFileTypes:true})){
      const path=directory+'/'+entry.name;
      if(entry.isDirectory())scanAdditional(path);
      else if(entry.name.endsWith('.js')){
        try{findings.push(...analyzeHandler(readFileSync(join(root,path),'utf8'),path).findings);}
        catch(error){findings.push({file:path,rule:'syntax-error',evidence:error.message,disposition:'confirmed-broken-module'});}
      }
    }
  };
  for(const path of ['index.js','ledger.js','inverses.js'])findings.push(...analyzeHandler(readFileSync(join(root,path),'utf8'),path).findings);
  try{scanAdditional('src');}catch(error){if(error.code!=='ENOENT')throw error;}
  const grouped=new Map();
  for (const e of entries) grouped.set(e.name,[...(grouped.get(e.name)||[]),e.registryNamespace]);
  const uniqueHandlers=new Set(branches.map(b=>b.name));
  const mismatches={
    registryWithoutHandler:entries.filter(e=>!branches.some(b=>b.name===e.name && b.file===`handlers/${e.registryNamespace}.js`)).map(e=>e.name),
    handlerWithoutRegistry:[...uniqueHandlers].filter(n=>!grouped.has(n)).sort()
  };
  const duplicateNames=[...grouped].filter(([,ns])=>ns.length>1).map(([name,namespaces])=>({name,namespaces}));
  const repeatedDispatchNames=[...uniqueHandlers].flatMap(name=>{
    const matches=branches.filter(b=>b.name===name);
    return matches.length>1?[{name,locations:matches.map(b=>`${b.file}:${b.line}`)}]:[];
  });
  return {counts:{registryEntries:entries.length,uniqueNames:grouped.size,handlerDispatchBranches:branches.length,
    uniqueHandlerNames:uniqueHandlers.size,namespaces:new Set(entries.map(e=>e.registryNamespace)).size,
    duplicateNames:duplicateNames.length},mismatches,duplicateNames,repeatedDispatchNames,findings,modules,entries,branches};
}
export function duplicateCandidates(data) {
  const candidates=[];
  const schemaKey=e=>JSON.stringify(e.inputSchema);
  const byName=new Map(data.entries.map(e=>[e.name,e]));
  const tokens=s=>new Set(s.toLowerCase().match(/[a-z0-9]+/g)||[]);
  for (let i=0;i<data.branches.length;i++) for(let j=i+1;j<data.branches.length;j++) {
    const a=data.branches[i],b=data.branches[j];
    if(a.name===b.name || a.file!==b.file)continue;
    const ea=byName.get(a.name),eb=byName.get(b.name);
    if(!ea || !eb)continue;
    const sameBody=!!a.implementationFingerprint && a.implementationFingerprint===b.implementationFingerprint;
    // Same full call expression preserves HTTP method, endpoint, arguments and transformations.
    const sameCalls=a.calls.length && canonical(a.calls)===canonical(b.calls);
    const ta=tokens(ea.description||''),tb=tokens(eb.description||'');
    const similarity=[...ta].filter(t=>tb.has(t)).length/(new Set([...ta,...tb]).size||1);
    if(!sameBody && !sameCalls && similarity<0.88)continue;
    const sameSchema=schemaKey(ea)===schemaKey(eb);
    candidates.push({tools:[a.name,b.name],confidence:sameBody?'high':sameCalls?'medium':'low',
      classification:sameBody?'identical-branch-candidate':sameCalls?'same-call-different-wrapper':'description-overlap-only',
      reasons:[...(sameBody?['Identical implementation AST']:[]),...(sameCalls?['Identical ordered call expressions']:[]),
        ...(sameSchema?['Identical input schema']:['Input schemas differ']),`Description token Jaccard ${similarity.toFixed(3)}`],
      locations:[`${a.file}:${a.line}`,`${b.file}:${b.line}`],autoMerge:false});
  }
  return candidates;
}
