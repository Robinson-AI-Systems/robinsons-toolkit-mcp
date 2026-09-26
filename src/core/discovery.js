export function searchTools(registry, query, activeNamespaces, limit = 10) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];

  for (const tool of registry) {
    // Skip tools whose namespace is not active (no credentials)
    const ns = tool.namespace || tool.name.split('_')[0];
    if (activeNamespaces[ns] === false) continue;

    // Score this tool
    const text = `${tool.name} ${tool.description || ''} ${tool.tags?.join(' ') || ''}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (tool.name.toLowerCase().includes(term)) score += 3;
      else if (text.includes(term)) score += 1;
    }
    if (score > 0) results.push({ ...tool, _score: score });
  }

  return results
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...tool }) => tool);
}
