import {readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';

export async function loadHandlers(root) {
  const handlers = {};
  const handlersDir = join(root, 'handlers');
  if (!existsSync(handlersDir)) return handlers;
  const files = readdirSync(handlersDir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const mod = await import(join(handlersDir, file).replace(/\\/g, '/'));
      const namespace = file.replace('.js', '');
      if (mod.default && typeof mod.default.execute === 'function') {
        handlers[namespace] = mod.default;
      }
    } catch (e) {
      console.error(`Handler load error in ${file}:`, e.message);
    }
  }
  return handlers;
}
