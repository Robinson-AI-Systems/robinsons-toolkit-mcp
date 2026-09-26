import Ajv from 'ajv';
import addFormats from 'ajv-formats';
const ajv = new Ajv({ strict: false, allErrors: false, coerceTypes: false, useDefaults: false });
addFormats(ajv);
const compiled = new WeakMap();

export function validateArgs(toolName, args, registryArr) {
  const tool = registryArr.find(t => t.name === toolName);
  if (!tool?.inputSchema) return null;
  let validate = compiled.get(tool.inputSchema);
  if (!validate) {
    validate = ajv.compile(tool.inputSchema);
    compiled.set(tool.inputSchema, validate);
  }
  if (validate(args)) return null;
  const error = validate.errors[0];
  // Never include argument values in validation errors: inputs may contain secrets.
  if (error.keyword === 'required') return `Missing required argument "${error.params.missingProperty}" for ${toolName}. Use get_tool_schema for the full signature.`;
  return `Invalid arguments for ${toolName} at ${error.instancePath || '/'}: ${error.message}`;
}
