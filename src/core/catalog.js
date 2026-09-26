/** Resolve compatibility names without importing provider implementations. */
export function buildCatalog(entries) {
  const byName=new Map();
  for(const entry of entries){
    if(byName.has(entry.name))throw new Error(`Duplicate canonical tool: ${entry.name}`);
    byName.set(entry.name,{...entry});
  }
  for(const entry of byName.values()){
    if(!entry.aliasOf)continue;
    const target=byName.get(entry.aliasOf);
    if(!target)throw new Error(`Alias ${entry.name} targets unknown capability ${entry.aliasOf}`);
    if(target.aliasOf)throw new Error(`Alias chains or cycles are not allowed: ${entry.name}`);
    if(target.namespace!==entry.namespace)throw new Error(`Alias namespace differs: ${entry.name}`);
    target.aliases=[...new Set([...(target.aliases||[]),entry.name])];
    if(entry.deprecated)target.deprecatedAliases=[...new Set([...(target.deprecatedAliases||[]),entry.name])];
  }
  return {entries:[...byName.values()],byName,resolve:name=>{
    const entry=byName.get(name);
    return entry?{requested:entry,canonical:byName.get(entry.aliasOf||name)}:undefined;
  }};
}
export function withAliasWarning(result,requested,canonical){
  const warning=`Deprecated name ${requested}; use ${canonical}.`;
  if(result && typeof result==='object' && !Array.isArray(result)){
    return {...result,warnings:[...(Array.isArray(result.warnings)?result.warnings:[]),warning],canonicalName:canonical};
  }
  return {value:result,warnings:[warning],canonicalName:canonical};
}
