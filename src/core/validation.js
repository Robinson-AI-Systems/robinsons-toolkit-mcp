export function validateArgs(toolName, args, registryArr) {
  const tool = registryArr.find(t => t.name === toolName);
  if (!tool || !tool.inputSchema) return null;
  const schema = tool.inputSchema;
  args = args || {};

  // Check required
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (args[key] === undefined || args[key] === null) {
        return `Missing required argument "${key}" for ${toolName}. Use get_tool_schema for the full signature.`;
      }
    }
  }

  // Check primitive types
  const props = schema.properties || {};
  for (const [key, val] of Object.entries(args)) {
    const spec = props[key];
    if (!spec || !spec.type) continue;
    const t = spec.type;
    const actual = Array.isArray(val) ? 'array' : (val === null ? 'null' : typeof val);
    let ok;
    switch (t) {
      case 'string':  ok = actual === 'string'; break;
      case 'number':  ok = actual === 'number'; break;
      case 'boolean': ok = actual === 'boolean'; break;
      case 'array':   ok = actual === 'array'; break;
      case 'object':  ok = actual === 'object' && !Array.isArray(val) && val !== null; break;
      default:        ok = true; // unknown / open type
    }
    if (!ok) return `Argument "${key}" for ${toolName} expected ${t}, got ${actual}.`;
    // Enum check
    if (Array.isArray(spec.enum) && !spec.enum.includes(val)) {
      return `Argument "${key}" for ${toolName} must be one of: ${spec.enum.join(', ')}. Got: ${val}`;
    }
  }
  return null;
}
