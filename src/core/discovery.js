const stopWords=new Set(['a','an','the','i','me','my','please','want','need','how','to','for','with','and','of','in']);
const tokens=text=>String(text||'').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];

/** One immutable lexical index per Core. Never loads handlers or calls providers. */
export function createDiscovery(registry){
 const documents=registry.filter(tool=>!tool.aliasOf).map(tool=>{
  const terms=new Map();
  const add=(text,weight)=>{for(const token of tokens(text))terms.set(token,(terms.get(token)||0)+weight);};
  add(tool.name,3);add(tool.namespace,1);add(tool.description,1);
  add((tool.tags||[]).join(' '),2);add((tool.aliases||[]).join(' '),2);
  return {tool,terms,length:[...terms.values()].reduce((a,b)=>a+b,0)||1};
 });
 const averageLength=documents.reduce((sum,doc)=>sum+doc.length,0)/(documents.length||1);
 const postings=new Map();
 documents.forEach((doc,index)=>{for(const [term,frequency]of doc.terms){if(!postings.has(term))postings.set(term,[]);postings.get(term).push({index,frequency});}});
 return {
  size:documents.length,
  search(query,{limit=8,accept=()=>true}={}){
   const queryTerms=[...new Set(tokens(query).filter(token=>!stopWords.has(token)))];
   const scores=new Map(),matches=new Map();
   for(const term of queryTerms){
    const hits=postings.get(term)||[];
    const idf=Math.log(1+(documents.length-hits.length+0.5)/(hits.length+0.5));
    for(const {index,frequency}of hits){
     const normalization=1.2*(0.25+0.75*documents[index].length/averageLength);
     scores.set(index,(scores.get(index)||0)+idf*frequency*2.2/(frequency+normalization));
     if(!matches.has(index))matches.set(index,[]);matches.get(index).push(term);
    }
   }
   const exact=String(query).trim().toLowerCase();
   const results=[];
   for(const [index,score]of scores){
    const tool=documents[index].tool;if(!accept(tool))continue;
    const exactName=tool.name.toLowerCase()===exact||(tool.aliases||[]).some(alias=>alias.toLowerCase()===exact);
    const coverage=matches.get(index).length/(queryTerms.length||1);
    // An explicit workflow layer is a small tie-breaker, never a substitute for
    // intent relevance. Do not infer safety or workflow status from a name.
    const boost=tool.layer===2&&coverage===1?1.05:1;
    results.push({tool,score:(score*(0.5+coverage)*boost)+(exactName?1000:0),matchedTerms:matches.get(index)});
   }
   return results.sort((a,b)=>b.score-a.score||a.tool.name.localeCompare(b.tool.name)).slice(0,limit);
  }
 };
}
// Compatibility entry for callers that previously used the lexical helper.
export function searchTools(registry,query,activeNamespaces={},limit=10){
 return createDiscovery(registry).search(query,{limit,accept:tool=>activeNamespaces[tool.namespace]!==false}).map(hit=>hit.tool);
}
