export const PINNED_TOOLS = [
  {
    name: 'search_toolkit',
    description: 'Search Robinson\'s Toolkit for the right tool. Describe what you want to do in plain English and get back the matching tools with their exact parameters. ALWAYS use this first when you need a tool you haven\'t used before.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you want to do. E.g. "create a neon database branch", "send an SMS with twilio", "deploy to fly.io", "list vercel deployments"' },
        limit: { type: 'number', description: 'Max results to return (default 8, max 20)', default: 8 }
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
  // High-value pinned tools always visible (no need to search for these)
  {
    name: 'local_run_command',
    description: 'PREFERRED for running shell commands during development. Executes on the host machine (WSL2/Linux). USE THIS WHEN you need to run npm, pnpm, yarn, git, npx, node, python, docker, or any one-off terminal command. Scoped to WORKSPACE_ROOT by default; captures stdout, stderr, and exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run, e.g. "npm run build", "git status", "npx prisma db push"' },
        cwd: { type: 'string', description: 'Working directory path. Defaults to WORKSPACE_ROOT from .env' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 30000)', default: 30000 }
      },
      required: ['command']
    }
  },
  {
    name: 'local_read_file',
    description: 'PREFERRED for reading any local file the agent needs to reason about. USE THIS WHEN you need source code, configs, .env, package.json, logs, JSON, markdown, or any text file. Returns content plus size and modification time. Binary files return a metadata stub instead of garbage.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path or path relative to WORKSPACE_ROOT, e.g. "src/app.ts" or "/home/user/project/file.js"' },
        encoding: { type: 'string', description: 'File encoding (default: utf-8)', default: 'utf-8' }
      },
      required: ['path']
    }
  },
  {
    name: 'local_write_file',
    description: 'PREFERRED for creating or overwriting local files. USE THIS WHEN you need to create source files, update configs, write generated code, or persist any agent-produced text. Creates parent directories automatically. Honors ALLOWED_WRITE_PATHS if set.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path or path relative to WORKSPACE_ROOT' },
        content: { type: 'string', description: 'Content to write to the file (full replacement)' },
        create_dirs: { type: 'boolean', description: 'Create parent directories if they don\'t exist (default: true)', default: true }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'local_list_directory',
    description: 'PREFERRED for exploring project structure. USE THIS WHEN you need to discover files, find configs, or understand the layout of a repo before making changes. Returns names, sizes, and types (file/dir).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path. Defaults to WORKSPACE_ROOT' },
        recursive: { type: 'boolean', description: 'List recursively (default: false)', default: false },
        include_hidden: { type: 'boolean', description: 'Include hidden files/folders (default: false)', default: false }
      }
    }
  },
  {
    name: 'github_create_branch',
    description: 'PREFERRED for creating a feature branch on a GitHub repo. USE THIS WHEN starting work on a new feature, bug fix, or experiment. Creates from `from_branch` (default: main). Recorded in the Observability Ledger — can be undone via compound_rollback_transaction.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (username or org)' },
        repo: { type: 'string', description: 'Repository name' },
        branch: { type: 'string', description: 'New branch name, e.g. "feature/user-auth"' },
        from_branch: { type: 'string', description: 'Branch to create from (default: main)', default: 'main' }
      },
      required: ['owner', 'repo', 'branch']
    }
  },
  {
    name: 'github_create_pull_request',
    description: 'PREFERRED for opening a PR after pushing a feature branch. USE THIS WHEN code is ready for review or to trigger CI on a deploy preview. Recorded in the Observability Ledger — can be auto-closed via compound_rollback_transaction.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        title: { type: 'string', description: 'PR title' },
        body: { type: 'string', description: 'PR description (Markdown supported)' },
        head: { type: 'string', description: 'Branch with your changes' },
        base: { type: 'string', description: 'Branch to merge into (default: main)', default: 'main' }
      },
      required: ['owner', 'repo', 'title', 'head']
    }
  },
  {
    name: 'neon_run_sql',
    description: 'PREFERRED for executing SQL against Neon Postgres. USE THIS WHEN you need to inspect schemas, query data, run DDL, or apply ad-hoc migrations. Targets the main branch by default; pass branch_id to query a specific branch (useful with compound_scaffold_feature).',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Neon project ID' },
        sql: { type: 'string', description: 'SQL query to execute' },
        database: { type: 'string', description: 'Database name (default: neondb)', default: 'neondb' },
        branch_id: { type: 'string', description: 'Branch ID (default: main branch)' }
      },
      required: ['project_id', 'sql']
    }
  },
  {
    name: 'vercel_list_deployments',
    description: 'PREFERRED for checking deployment status and history. USE THIS WHEN diagnosing a failed deploy, finding the URL of a preview, or identifying the last-known-good production deployment for rollback. Returns the N most recent deployments with state and URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Vercel project ID or name' },
        limit: { type: 'number', default: 10 }
      },
      required: ['projectId']
    }
  },
  {
    name: 'compound_scaffold_feature',
    description: 'POWER TOOL: PREFERRED METHOD for starting a new feature. Creates a GitHub branch + an isolated Neon DB branch + writes the new DATABASE_URL into .env.local + optionally runs migrations — in one call. Replaces 4-5 manual steps. Each created resource is logged to the Observability Ledger so the whole setup can be undone via compound_rollback_transaction.',
    inputSchema: {
      type: 'object',
      properties: {
        github_owner: { type: 'string', description: 'GitHub repo owner' },
        github_repo: { type: 'string', description: 'GitHub repo name' },
        feature_name: { type: 'string', description: 'Feature/branch name, e.g. "user-auth" or "payment-flow"' },
        neon_project_id: { type: 'string', description: 'Neon project ID for database branching' },
        run_migrations: { type: 'boolean', description: 'Run prisma db push or drizzle-kit push after branching (default: false)', default: false },
        migration_command: { type: 'string', description: 'Migration command if run_migrations is true (default: "npx prisma db push")', default: 'npx prisma db push' },
        env_file_path: { type: 'string', description: 'Path to .env.local to update with new DB URL' }
      },
      required: ['github_owner', 'github_repo', 'feature_name', 'neon_project_id']
    }
  },
  {
    name: 'compound_rollback_transaction',
    description: 'POWER TOOL: SAFETY NET for agent mistakes. Reads the Observability Ledger and reverses recent state-mutating tool calls (GitHub branches, Neon DBs, Fly apps, Vercel projects, etc.) in reverse order. USE THIS WHEN a multi-step setup goes wrong, when an agent hallucinated a destructive action, or to clean up after a failed compound tool. Supports dry_run to preview the reversal plan without executing.',
    inputSchema: {
      type: 'object',
      properties: {
        last_n: { type: 'number', description: 'Roll back the most recent N reversible ledger entries' },
        since: { type: 'string', description: 'ISO timestamp — roll back everything after this time' },
        transaction_id: { type: 'string', description: 'Roll back a single ledger entry by ID' },
        dry_run: { type: 'boolean', description: 'Show what would be reversed without executing (default: false)', default: false }
      }
    }
  }
];
