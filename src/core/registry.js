import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';

export function loadRegistry(root) {
  const registryDir = join(root, 'registry');
  const allTools = [];
  if (!existsSync(registryDir)) return allTools;
  const files = readdirSync(registryDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const content = JSON.parse(readFileSync(join(registryDir, file), 'utf-8'));
      if (Array.isArray(content)) allTools.push(...content);
    } catch (e) {
      console.error(`Registry load error in ${file}:`, e.message);
    }
  }
  return allTools;
}
