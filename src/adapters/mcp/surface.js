export const PINNED_TOOLS = [
  {
    name: 'search_toolkit',
    description: 'Search Robinson\'s Toolkit for the right tool. Describe what you want to do in plain English and get back the matching tools with their exact parameters. ALWAYS use this first when you need a tool you haven\'t used before.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you want to do. E.g. "create a neon database branch", "send an SMS with twilio", "deploy to fly.io", "list vercel deployments"' },
        include_unavailable: { type: 'boolean', description: 'Include tools missing credentials or configuration', default: false },
        limit: { type: 'integer', description: 'Max results to return (default 8, max 20)', default: 8 }
      },
      required: ['query']
    }
  },
  {
    name: 'list_namespaces',
    description: 'List all available tool categories (namespaces) and how many tools each has. Use this to understand what Robinson\'s Toolkit can do.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_tool_schema',
    description: 'Get the exact input schema and description for a specific tool by name. Use this when you know the tool name but need to see its parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: 'Exact tool name, e.g. "neon_create_branch" or "vercel_list_deployments"' }
      },
      required: ['tool_name']
    }
  },
  {
    name: 'execute_tool',
    description: 'Execute any Robinson\'s Toolkit tool by name with arguments. Use search_toolkit first to find the right tool and its schema, then call this to run it.',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: 'Exact tool name to execute' },
        args: { type: 'object', description: 'Arguments matching the tool\'s input schema' }
      },
      required: ['tool_name']
    }
  },
  {name:'toolkit_result_read',description:'Read a bounded UTF-8 page from a stored result. Follow nextCursor to retrieve all data.',inputSchema:{type:'object',properties:{id:{type:'string'},cursor:{type:'integer',minimum:0},limit:{type:'integer',minimum:4,maximum:16384}},required:['id']}},
  {name:'toolkit_result_search',description:'Find literal text in a stored result, with bounded snippets and pagination.',inputSchema:{type:'object',properties:{id:{type:'string'},query:{type:'string',minLength:1,maxLength:256},cursor:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:20}},required:['id','query']}}
];
