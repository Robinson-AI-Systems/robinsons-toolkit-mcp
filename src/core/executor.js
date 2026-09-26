import {validateArgs} from './validation.js';
import {appendReceipt} from '../../ledger.js';
import {inverses} from '../../inverses.js';

export async function routeToolCall(toolName, args, handlers, registry, opts = {}) {
  // Validate args against the registry schema BEFORE hitting the network
  const capability = registry.find(tool => tool.name === toolName);
  if (!capability) throw Object.assign(new Error(`Unknown capability: ${toolName}`), {code:'UNKNOWN_TOOL'});
  const validationError = validateArgs(toolName, args, registry);
  if (validationError) throw Object.assign(new Error(validationError), {code:'INVALID_ARGUMENTS'});

  // Determine namespace from tool name prefix
  const parts = toolName.split('_');
  let namespace = parts[0];

  // Map Google sub-service prefixes to the google handler
  if (['gmail','drive','calendar','sheets','docs','slides','tasks','people','admin','forms','chat'].includes(namespace)) {
    namespace = 'google';
  }

  // Map brave/tavily/serp prefixes to the unified search handler
  if (namespace === 'brave' || namespace === 'tavily' || namespace === 'serp') namespace = 'search';

  // Map cf_ prefix to the cloudflare handler
  if (namespace === 'cf') namespace = 'cloudflare';

  namespace = capability.namespace || namespace;
  const handler = typeof handlers.load === 'function' ? await handlers.load(namespace) : handlers[namespace];
  if (!handler) {
    throw new Error(`No handler found for namespace '${namespace}'. Tool: ${toolName}\nAvailable handlers: ${Object.keys(handlers).join(', ')}`);
  }

  const result = await handler.execute(toolName, args || {});

  // ── Observability Ledger: record a reversal receipt for mutating tools ─────
  if (!opts.skipLedger && inverses[toolName]) {
    try {
      const receipt = inverses[toolName](args || {}, result);
      if (receipt) {
        (opts.appendReceipt || appendReceipt)({
          tool_name: toolName,
          args: args || {},
          result,
          inverse: receipt.tool ? { tool: receipt.tool, args: receipt.args } : null,
          reversible: receipt.reversible !== false && !!receipt.tool,
          notes: receipt.notes
        });
      }
    } catch (e) {
      console.error(`Ledger receipt failed for ${toolName}: ${e.message}`);
    }
  }

  return result;
}
