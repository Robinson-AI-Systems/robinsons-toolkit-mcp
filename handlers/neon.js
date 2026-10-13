/**
 * Neon Handler — 187 tools
 * Complete Neon API + PostgreSQL developer toolkit:
 * Projects, branches, databases, endpoints, roles, SQL execution,
 * schema management, data operations, pgvector/AI, full-text search,
 * permissions/RLS, advanced monitoring, migrations, and Super Tools.
 */

const BASE = 'https://console.neon.tech/api/v2';

function headers() {
  const key = process.env.NEON_API_KEY;
  if (!key) throw new Error('NEON_API_KEY not set in .env');
  return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
}

async function n(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: headers(),
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(`Neon API ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

// Retrieve credentials from the supported management endpoint, never synthesize them.
async function connectionInfo(projectId, database='neondb', branchId, role='neondb_owner', pooled=true) {
  const query=new URLSearchParams({database_name:database,role_name:role,pooled:String(pooled)});
  if(branchId)query.set('branch_id',branchId);
  const result=await n('GET', `/projects/${encodeURIComponent(projectId)}/connection_uri?${query}`);
  let uri;try{uri=new URL(result.uri);}catch{throw new Error('Neon returned an invalid connection URI');}
  if(!['postgres:','postgresql:'].includes(uri.protocol)||!uri.hostname||!uri.username||!uri.password)throw new Error('Neon returned an incomplete authenticated connection URI');
  return {connection_string:result.uri,host:uri.hostname,database,role,pooled};
}

// Use the official driver so database credentials never become management auth.
async function runSQL(projectId, sql, database='neondb', branchId, role='neondb_owner') {
  const {neon}=await import('@neondatabase/serverless');
  const connection=await connectionInfo(projectId,database,branchId,role,false);
  const client=neon(connection.connection_string,{fullResults:true,fetchOptions:{signal:AbortSignal.timeout(30000)}});
  try{
    if(Array.isArray(sql))return await client.transaction(sql.map(statement=>client.query(statement,[])));
    return await client.query(sql,[]);
  }catch(error){
    // SQL errors are failures, never successful objects containing fallback instructions.
    const {EnvironmentCredentials}=await import('../src/core/credentials.js');
    const password=decodeURIComponent(new URL(connection.connection_string).password);
    const redact=new EnvironmentCredentials({DATABASE_URL:connection.connection_string,DATABASE_PASSWORD:password});
    throw Object.assign(new Error(redact.redact(`Neon SQL failed: ${error.message}`)),{code:'EXECUTION_FAILED',operationMayHaveCompleted:true});
  }
}

async function execute(tool, args) {
  const { project_id, branch_id } = args;

  // ── USER / AUTH ────────────────────────────────────────────────────────────
  if (tool === 'neon_get_current_user') { return await n('GET', '/users/me'); }
  if (tool === 'neon_check_api_key') {
    try { await n('GET', '/users/me'); return { valid: true, message: 'NEON_API_KEY is valid' }; }
    catch (e) { return { valid: false, error: e.message }; }
  }
  if (tool === 'neon_list_api_keys') { return await n('GET', '/api_keys'); }
  if (tool === 'neon_create_api_key') { return await n('POST', '/api_keys', { key_name: args.key_name }); }
  if (tool === 'neon_revoke_api_key') { return await n('DELETE', `/api_keys/${args.key_id}`); }

  // ── ORGANIZATIONS ─────────────────────────────────────────────────────────
  if (tool === 'neon_list_organizations') { return await n('GET', '/users/me/organizations'); }

  // ── PROJECTS ──────────────────────────────────────────────────────────────
  if (tool === 'neon_list_projects') {
    const { limit = 10, search } = args;
    // Auto-discover org_id if not provided — Neon now requires it for all accounts
    let org_id = args.org_id;
    if (!org_id) {
      const orgsData = await n('GET', '/users/me/organizations');
      const orgs = orgsData.organizations || [];
      if (orgs.length) org_id = orgs[0].id;
    }
    let path = `/projects?limit=${limit}`;
    if (org_id) path += `&org_id=${org_id}`;
    if (search) path += `&search=${encodeURIComponent(search)}`;
    const d = await n('GET', path);
    return { projects: (d.projects||[]).map(p => ({ id: p.id, name: p.name, region_id: p.region_id, pg_version: p.pg_version, created_at: p.created_at })), pagination: d.pagination, org_id };
  }
  if (tool === 'neon_create_project') {
    const { name, region_id = 'aws-us-east-2', pg_version = 16, branch } = args;
    return await n('POST', '/projects', { project: { name, region_id, pg_version, branch } });
  }
  if (tool === 'neon_delete_project') { return await n('DELETE', `/projects/${project_id}`); }
  if (tool === 'neon_describe_project') {
    const [proj, branches, endpoints] = await Promise.all([
      n('GET', `/projects/${project_id}`),
      n('GET', `/projects/${project_id}/branches`),
      n('GET', `/projects/${project_id}/endpoints`)
    ]);
    return { project: proj.project, branches: branches.branches, endpoints: endpoints.endpoints };
  }
  if (tool === 'neon_update_project') {
    const { name, history_retention_seconds } = args;
    const body = { project: {} };
    if (name) body.project.name = name;
    if (history_retention_seconds !== undefined) body.project.history_retention_seconds = history_retention_seconds;
    return await n('PATCH', `/projects/${project_id}`, body);
  }
  if (tool === 'neon_get_project_operations') { return await n('GET', `/projects/${project_id}/operations?limit=${args.limit || 20}`); }
  if (tool === 'neon_get_project_consumption') { return await n('GET', `/projects/${project_id}/consumption_history/events`); }
  if (tool === 'neon_get_project_quotas') { return await n('GET', `/projects/${project_id}`).then(d => d.project?.default_endpoint_settings); }
  if (tool === 'neon_list_shared_projects') { return await n('GET', '/projects/shared'); }
  if (tool === 'neon_share_project') { return await n('POST', `/projects/${project_id}/sharing`, { invitation: { email: args.email, scope: args.scope || 'member' } }); }
  if (tool === 'neon_revoke_project_share') { return await n('DELETE', `/projects/${project_id}/sharing/${args.sharing_id}`); }
  if (tool === 'neon_list_project_shares') { return await n('GET', `/projects/${project_id}/sharing`); }

  // ── BRANCHES ──────────────────────────────────────────────────────────────
  if (tool === 'neon_list_branches') {
    const d = await n('GET', `/projects/${project_id}/branches`);
    return { branches: d.branches.map(b => ({ id: b.id, name: b.name, primary: b.primary, created_at: b.created_at, state: b.current_state })) };
  }
  if (tool === 'neon_create_branch') {
    const { branch_name, from_branch, from_timestamp } = args;
    const body = { branch: { name: branch_name } };
    if (from_branch) body.branch.parent_id = from_branch;
    if (from_timestamp) body.branch.parent_timestamp = from_timestamp;
    body.endpoints = [{ type: 'read_write' }];
    return await n('POST', `/projects/${project_id}/branches`, body);
  }
  if (tool === 'neon_delete_branch') { return await n('DELETE', `/projects/${project_id}/branches/${branch_id}`); }
  if (tool === 'neon_get_branch_details') { return await n('GET', `/projects/${project_id}/branches/${branch_id}`); }
  if (tool === 'neon_describe_branch') {
    const [branch, endpoints, databases, roles] = await Promise.all([
      n('GET', `/projects/${project_id}/branches/${branch_id}`),
      n('GET', `/projects/${project_id}/endpoints`).then(d => d.endpoints.filter(e => e.branch_id === branch_id)),
      n('GET', `/projects/${project_id}/branches/${branch_id}/databases`),
      n('GET', `/projects/${project_id}/branches/${branch_id}/roles`)
    ]);
    return { branch: branch.branch, endpoints, databases: databases.databases, roles: roles.roles };
  }
  if (tool === 'neon_update_branch') {
    const body = { branch: {} };
    if (args.name) body.branch.name = args.name;
    return await n('PATCH', `/projects/${project_id}/branches/${branch_id}`, body);
  }
  if (tool === 'neon_reset_from_parent') {
    return await n('POST', `/projects/${project_id}/branches/${branch_id}/restore`, { source_branch_id: args.parent_id, preserve_under_name: args.preserve_under_name });
  }
  if (tool === 'neon_restore_branch_to_timestamp') {
    return await n('POST', `/projects/${project_id}/branches`, {
      branch: { parent_id: branch_id, parent_timestamp: args.timestamp, name: args.new_branch_name || `restore-${Date.now()}` },
      endpoints: [{ type: 'read_write' }]
    });
  }
  if (tool === 'neon_set_branch_as_primary') { return await n('POST', `/projects/${project_id}/branches/${branch_id}/set_as_primary`); }
  if (tool === 'neon_get_branch_schema_diff') {
    return await n('GET', `/projects/${project_id}/branches/${branch_id}/schema?db_name=${args.database || 'neondb'}&role=${args.role || ''}&compare_with=${args.compare_branch_id || ''}`);
  }

  // NEW: List endpoints specifically for a branch
  if (tool === 'neon_list_branch_endpoints') {
    const d = await n('GET', `/projects/${project_id}/endpoints`);
    return { endpoints: d.endpoints.filter(e => e.branch_id === branch_id) };
  }

  // NEW: Get full branch history/timeline (via operations log filtered to branch)
  if (tool === 'neon_get_branch_history') {
    const [branchDetail, ops] = await Promise.all([
      n('GET', `/projects/${project_id}/branches/${branch_id}`),
      n('GET', `/projects/${project_id}/operations?limit=50`)
    ]);
    const branchOps = ops.operations?.filter(op => op.branch_id === branch_id) || [];
    return { branch: branchDetail.branch, operations: branchOps };
  }

  // NEW: Clone a branch under a new name
  if (tool === 'neon_clone_branch') {
    const { new_branch_name, with_endpoint = true } = args;
    if (!new_branch_name) throw new Error('new_branch_name is required');
    const body = { branch: { name: new_branch_name, parent_id: branch_id } };
    if (with_endpoint) body.endpoints = [{ type: 'read_write' }];
    return await n('POST', `/projects/${project_id}/branches`, body);
  }

  // ── DATABASES ─────────────────────────────────────────────────────────────
  if (tool === 'neon_list_databases') { return await n('GET', `/projects/${project_id}/branches/${branch_id}/databases`); }
  if (tool === 'neon_create_database') {
    return await n('POST', `/projects/${project_id}/branches/${branch_id}/databases`, { database: { name: args.database_name, owner_name: args.owner_role || 'neondb_owner' } });
  }
  if (tool === 'neon_delete_database') { return await n('DELETE', `/projects/${project_id}/branches/${branch_id}/databases/${args.database_name}`); }
  if (tool === 'neon_get_database_size') {
    return await runSQL(project_id, `SELECT pg_database_size(current_database()) as size_bytes, pg_size_pretty(pg_database_size(current_database())) as size_human;`, args.database, branch_id);
  }
  if (tool === 'neon_get_database_tables') {
    return await runSQL(project_id, `SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size, pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size, pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) as index_size FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;`, args.database, branch_id);
  }
  if (tool === 'neon_describe_table_schema') {
    const sql = `SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length, numeric_precision, ordinal_position FROM information_schema.columns WHERE table_name='${args.table_name}' AND table_schema='${args.schema || 'public'}' ORDER BY ordinal_position;`;
    return await runSQL(project_id, sql, args.database, branch_id);
  }
  if (tool === 'neon_vacuum_database') { return await runSQL(project_id, 'VACUUM ANALYZE;', args.database, branch_id); }
  if (tool === 'neon_analyze_database') { return await runSQL(project_id, 'ANALYZE VERBOSE;', args.database, branch_id); }
  if (tool === 'neon_get_database_locks') {
    return await runSQL(project_id, `SELECT pid, usename, application_name, wait_event_type, wait_event, state, query_start, LEFT(query,300) as query FROM pg_stat_activity WHERE wait_event IS NOT NULL AND state != 'idle' ORDER BY query_start;`, args.database, branch_id);
  }
  if (tool === 'neon_kill_database_query') {
    return await runSQL(project_id, `SELECT pg_terminate_backend(${args.pid}) as terminated;`, args.database, branch_id);
  }
  if (tool === 'neon_get_database_activity') {
    return await runSQL(project_id, `SELECT pid, usename, application_name, state, query_start, state_change, wait_event_type, wait_event, LEFT(query,300) as query FROM pg_stat_activity WHERE state != 'idle' ORDER BY query_start;`, args.database, branch_id);
  }

  // ── SQL EXECUTION ─────────────────────────────────────────────────────────
  if (tool === 'neon_run_sql') {
    const { sql, database = 'neondb', role } = args;
    return await runSQL(project_id, sql, database, branch_id, role);
  }
  if (tool === 'neon_run_sql_transaction') {
    const { statements, database = 'neondb' } = args;
    return await runSQL(project_id, statements, database, branch_id);
  }
  if (tool === 'neon_explain_sql_statement') {
    return await runSQL(project_id, `EXPLAIN (ANALYZE, FORMAT JSON) ${args.sql}`, args.database, branch_id);
  }
  if (tool === 'neon_list_slow_queries') {
    const sql = `SELECT query, calls, round(mean_exec_time::numeric,2) as avg_ms, round(max_exec_time::numeric,2) as max_ms, round(total_exec_time::numeric,2) as total_ms, rows FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT ${args.limit || 20};`;
    return await runSQL(project_id, sql, args.database, branch_id);
  }
  if (tool === 'neon_detect_missing_indexes') {
    const sql = `SELECT schemaname||'.'||relname as table, seq_scan, seq_tup_read, idx_scan, pg_size_pretty(pg_relation_size(relid)) as size FROM pg_stat_user_tables WHERE seq_scan > 100 ORDER BY seq_tup_read DESC LIMIT 20;`;
    return await runSQL(project_id, sql, args.database, branch_id);
  }
  if (tool === 'neon_get_index_usage') {
    const sql = `SELECT schemaname||'.'||relname as table, indexrelname as index, idx_scan, idx_tup_read, idx_tup_fetch FROM pg_stat_user_indexes ORDER BY idx_scan DESC LIMIT 30;`;
    return await runSQL(project_id, sql, args.database, branch_id);
  }
  if (tool === 'neon_get_table_bloat') {
    const sql = `SELECT schemaname||'.'||relname as table, n_dead_tup as dead_rows, n_live_tup as live_rows, round(n_dead_tup::numeric/NULLIF(n_live_tup+n_dead_tup,0)*100,2) as dead_pct FROM pg_stat_user_tables WHERE n_dead_tup > 100 ORDER BY n_dead_tup DESC LIMIT 20;`;
    return await runSQL(project_id, sql, args.database, branch_id);
  }
  if (tool === 'neon_analyze_deadlocks') {
    const sql = `SELECT pid, wait_event, pg_blocking_pids(pid) as blocked_by, LEFT(query,300) as query FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;`;
    return await runSQL(project_id, sql, args.database, branch_id);
  }

  // ── SQL & QUERY UTILITIES (NEW) ───────────────────────────────────────────

  // Run multiple SQL statements sequentially, collecting all results
  if (tool === 'neon_run_sql_batch') {
    const { statements, database = 'neondb', stop_on_error = true } = args;
    if (!statements?.length) throw new Error('statements array is required');
    const results = [];
    for (const sql of statements) {
      try {
        const r = await runSQL(project_id, sql, database, branch_id);
        results.push({ sql: sql.slice(0, 120), success: true, result: r });
      } catch (e) {
        results.push({ sql: sql.slice(0, 120), success: false, error: e.message });
        if (stop_on_error) break;
      }
    }
    return { results, total: statements.length, succeeded: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length };
  }

  // Row counts for all tables (uses pg_stat_user_tables estimates — fast)
  if (tool === 'neon_get_table_row_counts') {
    const { schema = 'public', database = 'neondb', exact = false } = args;
    let sql;
    if (exact) {
      // Exact but slow — runs COUNT(*) per table
      sql = `SELECT schemaname, tablename FROM pg_tables WHERE schemaname='${schema}' ORDER BY tablename;`;
      const tables = await runSQL(project_id, sql, database, branch_id);
      const rows = tables.rows || tables;
      const counts = await Promise.all(rows.map(async r => {
        const res = await runSQL(project_id, `SELECT COUNT(*) as count FROM ${r.schemaname}.${r.tablename};`, database, branch_id);
        return { table: r.tablename, count: (res.rows || res)[0]?.count };
      }));
      return { counts, note: 'exact counts — may be slow on large tables' };
    }
    sql = `SELECT schemaname, tablename, n_live_tup as estimated_rows, n_dead_tup as dead_rows FROM pg_stat_user_tables WHERE schemaname='${schema}' ORDER BY n_live_tup DESC;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Queries running longer than N seconds
  if (tool === 'neon_get_long_running_queries') {
    const { seconds = 30, database = 'neondb' } = args;
    const sql = `SELECT pid, usename, application_name, now() - query_start AS duration, state, wait_event_type, wait_event, LEFT(query,400) as query FROM pg_stat_activity WHERE (now() - query_start) > interval '${seconds} seconds' AND state != 'idle' AND query_start IS NOT NULL ORDER BY duration DESC;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Cancel (not terminate) a running query — softer than kill
  if (tool === 'neon_cancel_query') {
    const { pid, database = 'neondb' } = args;
    if (!pid) throw new Error('pid is required');
    return await runSQL(project_id, `SELECT pg_cancel_backend(${pid}) as cancelled;`, database, branch_id);
  }

  // EXPLAIN without ANALYZE (no actual execution)
  if (tool === 'neon_get_query_plan') {
    const { sql, format = 'TEXT', database = 'neondb' } = args;
    return await runSQL(project_id, `EXPLAIN (FORMAT ${format}) ${sql}`, database, branch_id);
  }

  // Reset pg_stat_statements counters
  if (tool === 'neon_reset_query_stats') {
    return await runSQL(project_id, `SELECT pg_stat_statements_reset();`, args.database || 'neondb', branch_id);
  }

  // Most frequently called queries (by call count, not slowness)
  if (tool === 'neon_list_slow_queries_by_calls') {
    const sql = `SELECT LEFT(query,200) as query, calls, round(mean_exec_time::numeric,2) as avg_ms, round(total_exec_time::numeric,2) as total_ms, rows FROM pg_stat_statements ORDER BY calls DESC LIMIT ${args.limit || 20};`;
    return await runSQL(project_id, sql, args.database || 'neondb', branch_id);
  }

  // Search across all column and table names
  if (tool === 'neon_search_schema') {
    const { search_term, database = 'neondb' } = args;
    if (!search_term) throw new Error('search_term is required');
    const sql = `SELECT table_schema, table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE (column_name ILIKE '%${search_term}%' OR table_name ILIKE '%${search_term}%') AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name, ordinal_position LIMIT 100;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Detailed per-table statistics from pg_stat_user_tables
  if (tool === 'neon_get_table_statistics') {
    const { table_name, database = 'neondb' } = args;
    const sql = table_name
      ? `SELECT schemaname, relname as table, seq_scan, idx_scan, n_tup_ins as inserts, n_tup_upd as updates, n_tup_del as deletes, n_live_tup as live_rows, n_dead_tup as dead_rows, n_mod_since_analyze as modified_since_analyze, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze FROM pg_stat_user_tables WHERE relname='${table_name}';`
      : `SELECT schemaname, relname as table, seq_scan, idx_scan, n_tup_ins as inserts, n_tup_upd as updates, n_tup_del as deletes, n_live_tup as live_rows, n_dead_tup as dead_rows, last_vacuum, last_analyze FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 30;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Search/filter PostgreSQL server settings
  if (tool === 'neon_get_all_settings') {
    const { filter, database = 'neondb' } = args;
    let sql = `SELECT name, setting, unit, short_desc, source, sourcefile FROM pg_settings`;
    if (filter) sql += ` WHERE name ILIKE '%${filter}%' OR short_desc ILIKE '%${filter}%'`;
    sql += ` ORDER BY name;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Get replication slots
  if (tool === 'neon_get_replication_slots') {
    return await runSQL(project_id, `SELECT slot_name, plugin, slot_type, active, restart_lsn, confirmed_flush_lsn, wal_status FROM pg_replication_slots;`, args.database || 'neondb', branch_id);
  }

  // List only currently installed extensions (with schema)
  if (tool === 'neon_get_installed_extensions') {
    return await runSQL(project_id, `SELECT e.extname as extension, e.extversion as version, n.nspname as schema, c.description FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace LEFT JOIN pg_description c ON c.objoid = e.oid ORDER BY extname;`, args.database || 'neondb', branch_id);
  }

  // ── SCHEMA INSPECTION (NEW) ───────────────────────────────────────────────

  // Reconstruct CREATE TABLE DDL for a specific table
  if (tool === 'neon_get_table_ddl') {
    const { table_name, schema = 'public', database = 'neondb' } = args;
    if (!table_name) throw new Error('table_name is required');
    const sql = `SELECT 'CREATE TABLE ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ' (' || chr(10) || string_agg('  ' || quote_ident(a.attname) || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END || CASE WHEN a.atthasdef THEN ' DEFAULT ' || (SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef WHERE adrelid=c.oid AND adnum=a.attnum) ELSE '' END, ',' || chr(10) ORDER BY a.attnum) || chr(10) || ');' as ddl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE c.relname='${table_name}' AND n.nspname='${schema}' AND c.relkind='r' GROUP BY n.nspname, c.relname;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Full DDL dump for all tables in a schema
  if (tool === 'neon_get_full_schema_dump') {
    const { schema = 'public', database = 'neondb' } = args;
    const sql = `SELECT c.relname as table_name, 'CREATE TABLE ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ' (' || chr(10) || string_agg('  ' || quote_ident(a.attname) || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END, ',' || chr(10) ORDER BY a.attnum) || chr(10) || ');' as ddl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname='${schema}' AND c.relkind='r' GROUP BY n.nspname, c.relname ORDER BY c.relname;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // List all indexes (all tables or a specific one)
  if (tool === 'neon_list_indexes') {
    const { table_name, schema = 'public', database = 'neondb' } = args;
    let sql = `SELECT schemaname, tablename, indexname, indexdef, pg_size_pretty(pg_relation_size(indexrelid)) as size FROM pg_indexes JOIN pg_stat_user_indexes USING (schemaname, tablename, indexrelname) WHERE schemaname='${schema}'`;
    if (table_name) sql += ` AND tablename='${table_name}'`;
    sql += ` ORDER BY tablename, indexname;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // List custom enum types with their values
  if (tool === 'neon_list_enums') {
    const sql = `SELECT n.nspname as schema, t.typname as enum_name, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) as values FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typtype='e' GROUP BY n.nspname, t.typname ORDER BY t.typname;`;
    return await runSQL(project_id, sql, args.database || 'neondb', branch_id);
  }

  // List stored functions and procedures
  if (tool === 'neon_list_functions') {
    const { schema = 'public', database = 'neondb' } = args;
    const sql = `SELECT n.nspname as schema, p.proname as name, pg_catalog.pg_get_function_arguments(p.oid) as arguments, t.typname as return_type, CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure' WHEN 'a' THEN 'aggregate' END as kind, p.prosecdef as security_definer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_type t ON t.oid=p.prorettype WHERE n.nspname='${schema}' ORDER BY p.proname;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Get function source code
  if (tool === 'neon_get_function_definition') {
    const { function_name, schema = 'public', database = 'neondb' } = args;
    if (!function_name) throw new Error('function_name is required');
    const sql = `SELECT pg_get_functiondef(p.oid) as definition, p.proname as name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname='${function_name}' AND n.nspname='${schema}';`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // List all triggers
  if (tool === 'neon_list_triggers') {
    const { table_name, schema = 'public', database = 'neondb' } = args;
    let sql = `SELECT trigger_name, event_manipulation, event_object_table, action_statement, action_timing, action_orientation FROM information_schema.triggers WHERE trigger_schema='${schema}'`;
    if (table_name) sql += ` AND event_object_table='${table_name}'`;
    sql += ` ORDER BY event_object_table, trigger_name;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // List views and materialized views
  if (tool === 'neon_list_views') {
    const { schema = 'public', database = 'neondb' } = args;
    const sql = `(SELECT 'view' as type, table_name as name, view_definition as definition FROM information_schema.views WHERE table_schema='${schema}') UNION ALL (SELECT 'materialized_view', matviewname, definition FROM pg_matviews WHERE schemaname='${schema}') ORDER BY type, name;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // List all constraints (PK, FK, UNIQUE, CHECK)
  if (tool === 'neon_list_constraints') {
    const { table_name, schema = 'public', database = 'neondb' } = args;
    let sql = `SELECT c.conname as constraint_name, CASE c.contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'f' THEN 'FOREIGN KEY' WHEN 'u' THEN 'UNIQUE' WHEN 'c' THEN 'CHECK' END as type, r.relname as table_name, pg_get_constraintdef(c.oid) as definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='${schema}'`;
    if (table_name) sql += ` AND r.relname='${table_name}'`;
    sql += ` ORDER BY r.relname, c.contype;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // What depends on a table (views, foreign keys, etc.)
  if (tool === 'neon_get_table_dependencies') {
    const { table_name, schema = 'public', database = 'neondb' } = args;
    if (!table_name) throw new Error('table_name is required');
    const sql = `SELECT DISTINCT dep_ns.nspname as dependent_schema, dep_class.relname as dependent_object, CASE dep_class.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' WHEN 'r' THEN 'table' WHEN 'f' THEN 'foreign_table' END as object_type FROM pg_depend d JOIN pg_class dep_class ON d.objid=dep_class.oid JOIN pg_namespace dep_ns ON dep_class.relnamespace=dep_ns.oid JOIN pg_class ref_class ON d.refobjid=ref_class.oid JOIN pg_namespace ref_ns ON ref_class.relnamespace=ref_ns.oid WHERE ref_class.relname='${table_name}' AND ref_ns.nspname='${schema}' AND dep_class.relname!='${table_name}' ORDER BY object_type, dependent_object;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // All foreign key relationships in a schema
  if (tool === 'neon_get_foreign_keys') {
    const { table_name, schema = 'public', database = 'neondb' } = args;
    let sql = `SELECT kcu.table_name as from_table, kcu.column_name as from_column, ccu.table_name as to_table, ccu.column_name as to_column, rc.constraint_name, rc.update_rule, rc.delete_rule FROM information_schema.key_column_usage kcu JOIN information_schema.referential_constraints rc ON rc.constraint_name=kcu.constraint_name AND rc.constraint_schema=kcu.constraint_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=rc.unique_constraint_name WHERE kcu.constraint_schema='${schema}'`;
    if (table_name) sql += ` AND (kcu.table_name='${table_name}' OR ccu.table_name='${table_name}')`;
    sql += ` ORDER BY kcu.table_name, kcu.column_name;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // List sequences and current values
  if (tool === 'neon_get_sequences') {
    const sql = `SELECT sequence_schema, sequence_name, data_type, start_value, minimum_value, maximum_value, increment, cycle_option FROM information_schema.sequences WHERE sequence_schema NOT IN ('pg_catalog','information_schema') ORDER BY sequence_schema, sequence_name;`;
    return await runSQL(project_id, sql, args.database || 'neondb', branch_id);
  }

  // List all schemas
  if (tool === 'neon_list_schemas') {
    const sql = `SELECT schema_name, schema_owner FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY schema_name;`;
    return await runSQL(project_id, sql, args.database || 'neondb', branch_id);
  }

  // ── SCHEMA MODIFICATION (NEW) ─────────────────────────────────────────────

  // CREATE INDEX (optionally CONCURRENTLY)
  if (tool === 'neon_create_index') {
    const { index_name, table_name, columns, schema = 'public', unique = false, concurrently = false, method = 'btree', where: partial_where, database = 'neondb' } = args;
    if (!index_name || !table_name || !columns?.length) throw new Error('index_name, table_name, and columns[] are required');
    const uniqueClause = unique ? 'UNIQUE ' : '';
    const concClause = concurrently ? 'CONCURRENTLY ' : '';
    const whereClause = partial_where ? ` WHERE ${partial_where}` : '';
    const sql = `CREATE ${uniqueClause}INDEX ${concClause}IF NOT EXISTS ${index_name} ON ${schema}.${table_name} USING ${method} (${columns.join(', ')})${whereClause};`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // DROP INDEX
  if (tool === 'neon_drop_index') {
    const { index_name, concurrently = false, if_exists = true, cascade = false, database = 'neondb' } = args;
    if (!index_name) throw new Error('index_name is required');
    const concClause = concurrently ? 'CONCURRENTLY ' : '';
    const ifClause = if_exists ? 'IF EXISTS ' : '';
    const cascadeClause = cascade ? ' CASCADE' : '';
    return await runSQL(project_id, `DROP INDEX ${concClause}${ifClause}${index_name}${cascadeClause};`, database, branch_id);
  }

  // CREATE TYPE AS ENUM
  if (tool === 'neon_create_enum') {
    const { enum_name, values, schema = 'public', database = 'neondb' } = args;
    if (!enum_name || !values?.length) throw new Error('enum_name and values[] are required');
    const valueList = values.map(v => `'${v}'`).join(', ');
    return await runSQL(project_id, `CREATE TYPE ${schema}.${enum_name} AS ENUM (${valueList});`, database, branch_id);
  }

  // Add a value to an existing enum
  if (tool === 'neon_add_enum_value') {
    const { enum_name, value, after, before, schema = 'public', database = 'neondb' } = args;
    if (!enum_name || !value) throw new Error('enum_name and value are required');
    let sql = `ALTER TYPE ${schema}.${enum_name} ADD VALUE IF NOT EXISTS '${value}'`;
    if (after) sql += ` AFTER '${after}'`;
    else if (before) sql += ` BEFORE '${before}'`;
    return await runSQL(project_id, sql + ';', database, branch_id);
  }

  // CREATE VIEW (or replace)
  if (tool === 'neon_create_view') {
    const { view_name, sql_query, schema = 'public', or_replace = true, database = 'neondb' } = args;
    if (!view_name || !sql_query) throw new Error('view_name and sql_query are required');
    const replaceClause = or_replace ? 'OR REPLACE ' : '';
    return await runSQL(project_id, `CREATE ${replaceClause}VIEW ${schema}.${view_name} AS ${sql_query};`, database, branch_id);
  }

  // DROP VIEW or MATERIALIZED VIEW
  if (tool === 'neon_drop_view') {
    const { view_name, schema = 'public', cascade = false, materialized = false, database = 'neondb' } = args;
    if (!view_name) throw new Error('view_name is required');
    const matClause = materialized ? 'MATERIALIZED ' : '';
    const cascadeClause = cascade ? ' CASCADE' : '';
    return await runSQL(project_id, `DROP ${matClause}VIEW IF EXISTS ${schema}.${view_name}${cascadeClause};`, database, branch_id);
  }

  // REFRESH MATERIALIZED VIEW
  if (tool === 'neon_refresh_materialized_view') {
    const { view_name, schema = 'public', concurrently = false, database = 'neondb' } = args;
    if (!view_name) throw new Error('view_name is required');
    const concClause = concurrently ? 'CONCURRENTLY ' : '';
    return await runSQL(project_id, `REFRESH MATERIALIZED VIEW ${concClause}${schema}.${view_name};`, database, branch_id);
  }

  // CREATE SCHEMA
  if (tool === 'neon_create_schema') {
    const { schema_name, authorization, if_not_exists = true, database = 'neondb' } = args;
    if (!schema_name) throw new Error('schema_name is required');
    const ifClause = if_not_exists ? 'IF NOT EXISTS ' : '';
    let sql = `CREATE SCHEMA ${ifClause}${schema_name}`;
    if (authorization) sql += ` AUTHORIZATION ${authorization}`;
    return await runSQL(project_id, sql + ';', database, branch_id);
  }

  // ALTER TABLE ADD COLUMN
  if (tool === 'neon_add_column') {
    const { table_name, column_name, data_type, not_null = false, default_value, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !column_name || !data_type) throw new Error('table_name, column_name, and data_type are required');
    let sql = `ALTER TABLE ${schema}.${table_name} ADD COLUMN IF NOT EXISTS ${column_name} ${data_type}`;
    if (not_null && default_value !== undefined) sql += ` NOT NULL DEFAULT ${default_value}`;
    else if (not_null) sql += ' NOT NULL';
    else if (default_value !== undefined) sql += ` DEFAULT ${default_value}`;
    return await runSQL(project_id, sql + ';', database, branch_id);
  }

  // ALTER TABLE DROP COLUMN
  if (tool === 'neon_drop_column') {
    const { table_name, column_name, cascade = false, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !column_name) throw new Error('table_name and column_name are required');
    const cascadeClause = cascade ? ' CASCADE' : '';
    return await runSQL(project_id, `ALTER TABLE ${schema}.${table_name} DROP COLUMN IF EXISTS ${column_name}${cascadeClause};`, database, branch_id);
  }

  // ALTER COLUMN TYPE
  if (tool === 'neon_alter_column_type') {
    const { table_name, column_name, new_type, using, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !column_name || !new_type) throw new Error('table_name, column_name, and new_type are required');
    let sql = `ALTER TABLE ${schema}.${table_name} ALTER COLUMN ${column_name} TYPE ${new_type}`;
    if (using) sql += ` USING ${using}`;
    return await runSQL(project_id, sql + ';', database, branch_id);
  }

  // SET or DROP column DEFAULT
  if (tool === 'neon_set_column_default') {
    const { table_name, column_name, default_value, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !column_name) throw new Error('table_name and column_name are required');
    const action = default_value !== undefined && default_value !== null ? `SET DEFAULT ${default_value}` : 'DROP DEFAULT';
    return await runSQL(project_id, `ALTER TABLE ${schema}.${table_name} ALTER COLUMN ${column_name} ${action};`, database, branch_id);
  }

  // SET or DROP NOT NULL
  if (tool === 'neon_set_column_not_null') {
    const { table_name, column_name, not_null = true, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !column_name) throw new Error('table_name and column_name are required');
    const action = not_null ? 'SET NOT NULL' : 'DROP NOT NULL';
    return await runSQL(project_id, `ALTER TABLE ${schema}.${table_name} ALTER COLUMN ${column_name} ${action};`, database, branch_id);
  }

  // RENAME TABLE
  if (tool === 'neon_rename_table') {
    const { table_name, new_name, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !new_name) throw new Error('table_name and new_name are required');
    return await runSQL(project_id, `ALTER TABLE ${schema}.${table_name} RENAME TO ${new_name};`, database, branch_id);
  }

  // RENAME COLUMN
  if (tool === 'neon_rename_column') {
    const { table_name, column_name, new_name, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !column_name || !new_name) throw new Error('table_name, column_name, and new_name are required');
    return await runSQL(project_id, `ALTER TABLE ${schema}.${table_name} RENAME COLUMN ${column_name} TO ${new_name};`, database, branch_id);
  }

  // CREATE TABLE with column definitions
  if (tool === 'neon_create_table') {
    const { table_name, columns, schema = 'public', if_not_exists = true, database = 'neondb' } = args;
    if (!table_name || !columns?.length) throw new Error('table_name and columns[] are required. Each column: {name, type, not_null?, default?, primary_key?}');
    const ifClause = if_not_exists ? 'IF NOT EXISTS ' : '';
    const colDefs = columns.map(c => {
      let def = `${c.name} ${c.type}`;
      if (c.primary_key) def += ' PRIMARY KEY';
      if (c.not_null && !c.primary_key) def += ' NOT NULL';
      if (c.default !== undefined) def += ` DEFAULT ${c.default}`;
      if (c.unique && !c.primary_key) def += ' UNIQUE';
      if (c.references) def += ` REFERENCES ${c.references}`;
      return def;
    }).join(',\n  ');
    return await runSQL(project_id, `CREATE TABLE ${ifClause}${schema}.${table_name} (\n  ${colDefs}\n);`, database, branch_id);
  }

  // DROP TABLE
  if (tool === 'neon_drop_table') {
    const { table_name, cascade = false, schema = 'public', database = 'neondb' } = args;
    if (!table_name) throw new Error('table_name is required');
    const cascadeClause = cascade ? ' CASCADE' : '';
    return await runSQL(project_id, `DROP TABLE IF EXISTS ${schema}.${table_name}${cascadeClause};`, database, branch_id);
  }

  // TRUNCATE TABLE
  if (tool === 'neon_truncate_table') {
    const { table_name, cascade = false, restart_identity = false, schema = 'public', database = 'neondb' } = args;
    if (!table_name) throw new Error('table_name is required');
    let sql = `TRUNCATE TABLE ${schema}.${table_name}`;
    if (restart_identity) sql += ' RESTART IDENTITY';
    if (cascade) sql += ' CASCADE';
    return await runSQL(project_id, sql + ';', database, branch_id);
  }

  // ADD FOREIGN KEY constraint
  if (tool === 'neon_add_foreign_key') {
    const { table_name, constraint_name, columns, ref_table, ref_columns, on_delete = 'NO ACTION', on_update = 'NO ACTION', schema = 'public', database = 'neondb' } = args;
    if (!table_name || !constraint_name || !columns?.length || !ref_table) throw new Error('table_name, constraint_name, columns[], and ref_table are required');
    const sql = `ALTER TABLE ${schema}.${table_name} ADD CONSTRAINT ${constraint_name} FOREIGN KEY (${columns.join(', ')}) REFERENCES ${schema}.${ref_table} (${(ref_columns || columns).join(', ')}) ON DELETE ${on_delete} ON UPDATE ${on_update};`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // DROP CONSTRAINT
  if (tool === 'neon_drop_constraint') {
    const { table_name, constraint_name, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !constraint_name) throw new Error('table_name and constraint_name are required');
    return await runSQL(project_id, `ALTER TABLE ${schema}.${table_name} DROP CONSTRAINT IF EXISTS ${constraint_name};`, database, branch_id);
  }

  // ── DATA OPERATIONS (NEW) ─────────────────────────────────────────────────

  // SELECT COUNT(*)
  if (tool === 'neon_count_rows') {
    const { table_name, where, schema = 'public', database = 'neondb' } = args;
    if (!table_name) throw new Error('table_name is required');
    let sql = `SELECT COUNT(*) as count FROM ${schema}.${table_name}`;
    if (where) sql += ` WHERE ${where}`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // SELECT with full options
  if (tool === 'neon_select_rows') {
    const { table_name, columns = '*', where, order_by, limit = 50, offset = 0, schema = 'public', database = 'neondb' } = args;
    if (!table_name) throw new Error('table_name is required');
    let sql = `SELECT ${columns} FROM ${schema}.${table_name}`;
    if (where) sql += ` WHERE ${where}`;
    if (order_by) sql += ` ORDER BY ${order_by}`;
    sql += ` LIMIT ${limit} OFFSET ${offset};`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // INSERT a row from a data object
  if (tool === 'neon_insert_row') {
    const { table_name, data, returning = '*', schema = 'public', database = 'neondb' } = args;
    if (!table_name || !data) throw new Error('table_name and data object are required');
    const keys = Object.keys(data);
    const values = keys.map(k => data[k] === null ? 'NULL' : typeof data[k] === 'string' ? `'${data[k].replace(/'/g, "''")}'` : typeof data[k] === 'object' ? `'${JSON.stringify(data[k])}'::jsonb` : data[k]);
    const sql = `INSERT INTO ${schema}.${table_name} (${keys.join(', ')}) VALUES (${values.join(', ')}) RETURNING ${returning};`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // UPDATE rows with a WHERE clause
  if (tool === 'neon_update_rows') {
    const { table_name, set, where, returning, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !set || !where) throw new Error('table_name, set object, and where clause are required');
    const setClause = Object.entries(set).map(([k, v]) => `${k} = ${v === null ? 'NULL' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : typeof v === 'object' ? `'${JSON.stringify(v)}'::jsonb` : v}`).join(', ');
    let sql = `UPDATE ${schema}.${table_name} SET ${setClause} WHERE ${where}`;
    if (returning) sql += ` RETURNING ${returning}`;
    return await runSQL(project_id, sql + ';', database, branch_id);
  }

  // DELETE with WHERE clause
  if (tool === 'neon_delete_rows') {
    const { table_name, where, returning, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !where) throw new Error('table_name and where clause are required for safety');
    let sql = `DELETE FROM ${schema}.${table_name} WHERE ${where}`;
    if (returning) sql += ` RETURNING ${returning}`;
    return await runSQL(project_id, sql + ';', database, branch_id);
  }

  // INSERT ... ON CONFLICT DO UPDATE (upsert)
  if (tool === 'neon_upsert_rows') {
    const { table_name, data, conflict_columns, update_columns, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !data || !conflict_columns?.length) throw new Error('table_name, data, and conflict_columns[] are required');
    const keys = Object.keys(data);
    const values = keys.map(k => data[k] === null ? 'NULL' : typeof data[k] === 'string' ? `'${data[k].replace(/'/g, "''")}'` : typeof data[k] === 'object' ? `'${JSON.stringify(data[k])}'::jsonb` : data[k]);
    const updateCols = update_columns || keys.filter(k => !conflict_columns.includes(k));
    const updateSet = updateCols.map(k => `${k} = EXCLUDED.${k}`).join(', ');
    const sql = `INSERT INTO ${schema}.${table_name} (${keys.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT (${conflict_columns.join(', ')}) DO UPDATE SET ${updateSet} RETURNING *;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Get sample rows using TABLESAMPLE
  if (tool === 'neon_get_sample_rows') {
    const { table_name, limit = 10, schema = 'public', database = 'neondb' } = args;
    if (!table_name) throw new Error('table_name is required');
    // TABLESAMPLE SYSTEM grabs random 5% pages then limits — much faster than ORDER BY RANDOM()
    const sql = `SELECT * FROM ${schema}.${table_name} TABLESAMPLE SYSTEM(5) LIMIT ${limit};`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Export table as CSV-formatted text
  if (tool === 'neon_export_table_csv') {
    const { table_name, where, limit = 1000, columns = '*', schema = 'public', database = 'neondb' } = args;
    if (!table_name) throw new Error('table_name is required');
    let sql = `SELECT ${columns} FROM ${schema}.${table_name}`;
    if (where) sql += ` WHERE ${where}`;
    sql += ` LIMIT ${limit}`;
    const result = await runSQL(project_id, sql, database, branch_id);
    const rows = result.rows || (Array.isArray(result) ? result : []);
    if (!rows.length) return { csv: '', rows: 0 };
    const headers = Object.keys(rows[0]).join(',');
    const body = rows.map(r => Object.values(r).map(v => v === null ? '' : `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    return { csv: headers + '\n' + body, rows: rows.length };
  }

  // Copy rows from one table into another
  if (tool === 'neon_copy_table_data') {
    const { source_table, dest_table, where, columns = '*', schema = 'public', database = 'neondb' } = args;
    if (!source_table || !dest_table) throw new Error('source_table and dest_table are required');
    let sql = `INSERT INTO ${schema}.${dest_table} SELECT ${columns} FROM ${schema}.${source_table}`;
    if (where) sql += ` WHERE ${where}`;
    sql += ' ON CONFLICT DO NOTHING;';
    return await runSQL(project_id, sql, database, branch_id);
  }

  // ── PGVECTOR & AI (NEW) ───────────────────────────────────────────────────

  // Install pgvector extension (shortcut)
  if (tool === 'neon_enable_pgvector') {
    return await runSQL(project_id, `CREATE EXTENSION IF NOT EXISTS vector;`, args.database || 'neondb', branch_id);
  }

  // Create a table with a vector embedding column
  if (tool === 'neon_create_vector_table') {
    const { table_name, dimensions = 1536, additional_columns = [], schema = 'public', database = 'neondb' } = args;
    if (!table_name) throw new Error('table_name is required');
    const extraCols = additional_columns.map(c => `,\n  ${c.name} ${c.type}`).join('');
    const sql = `CREATE EXTENSION IF NOT EXISTS vector;\nCREATE TABLE IF NOT EXISTS ${schema}.${table_name} (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  content text,\n  embedding vector(${dimensions}),\n  metadata jsonb DEFAULT '{}',\n  created_at timestamptz DEFAULT now()${extraCols}\n);`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // CREATE INDEX USING hnsw or ivfflat for vector search
  if (tool === 'neon_create_vector_index') {
    const { table_name, column = 'embedding', index_name, method = 'hnsw', op = 'vector_cosine_ops', schema = 'public', database = 'neondb', options = {} } = args;
    if (!table_name) throw new Error('table_name is required');
    const idxName = index_name || `${table_name}_${column}_idx`;
    const optStr = Object.entries(options).map(([k, v]) => `${k}=${v}`).join(', ');
    const withClause = optStr ? ` WITH (${optStr})` : '';
    const sql = `CREATE INDEX IF NOT EXISTS ${idxName} ON ${schema}.${table_name} USING ${method} (${column} ${op})${withClause};`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Insert a single vector embedding
  if (tool === 'neon_insert_embedding') {
    const { table_name, content, embedding, metadata = {}, schema = 'public', database = 'neondb' } = args;
    if (!embedding?.length) throw new Error('embedding array is required');
    if (!table_name) throw new Error('table_name is required');
    const vectorStr = `[${embedding.join(',')}]`;
    const safeContent = (content || '').replace(/'/g, "''");
    const sql = `INSERT INTO ${schema}.${table_name} (content, embedding, metadata) VALUES ('${safeContent}', '${vectorStr}'::vector, '${JSON.stringify(metadata)}'::jsonb) RETURNING id;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Bulk insert multiple embeddings
  if (tool === 'neon_bulk_insert_embeddings') {
    const { table_name, rows, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !rows?.length) throw new Error('table_name and rows[] are required. Each row: {content, embedding, metadata?}');
    const values = rows.map(r => `('${(r.content || '').replace(/'/g, "''")}', '[${r.embedding.join(',')}]'::vector, '${JSON.stringify(r.metadata || {})}'::jsonb)`).join(',\n');
    const sql = `INSERT INTO ${schema}.${table_name} (content, embedding, metadata) VALUES ${values} RETURNING id;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Cosine similarity search (operator: <=>)
  if (tool === 'neon_similarity_search_cosine') {
    const { table_name, query_embedding, limit = 5, threshold = 0.0, content_column = 'content', embedding_column = 'embedding', where, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !query_embedding?.length) throw new Error('table_name and query_embedding[] are required');
    const vectorStr = `[${query_embedding.join(',')}]`;
    const conditions = [];
    if (threshold > 0) conditions.push(`1 - (${embedding_column} <=> '${vectorStr}'::vector) >= ${threshold}`);
    if (where) conditions.push(where);
    const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT id, ${content_column}, 1 - (${embedding_column} <=> '${vectorStr}'::vector) as similarity, metadata FROM ${schema}.${table_name}${whereClause} ORDER BY ${embedding_column} <=> '${vectorStr}'::vector LIMIT ${limit};`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // L2 distance search (operator: <->)
  if (tool === 'neon_similarity_search_l2') {
    const { table_name, query_embedding, limit = 5, content_column = 'content', embedding_column = 'embedding', schema = 'public', database = 'neondb' } = args;
    if (!table_name || !query_embedding?.length) throw new Error('table_name and query_embedding[] are required');
    const vectorStr = `[${query_embedding.join(',')}]`;
    const sql = `SELECT id, ${content_column}, ${embedding_column} <-> '${vectorStr}'::vector as distance, metadata FROM ${schema}.${table_name} ORDER BY distance LIMIT ${limit};`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Find all tables that have a vector column
  if (tool === 'neon_list_vector_tables') {
    const sql = `SELECT c.table_schema, c.table_name, c.column_name, c.udt_name as type FROM information_schema.columns c WHERE c.udt_name = 'vector' ORDER BY c.table_schema, c.table_name;`;
    return await runSQL(project_id, sql, args.database || 'neondb', branch_id);
  }

  // ── FULL-TEXT SEARCH (NEW) ────────────────────────────────────────────────

  // Enable pg_trgm and unaccent for full-text and fuzzy search
  if (tool === 'neon_enable_full_text_search') {
    return await runSQL(project_id, `CREATE EXTENSION IF NOT EXISTS pg_trgm;\nCREATE EXTENSION IF NOT EXISTS unaccent;`, args.database || 'neondb', branch_id);
  }

  // Create a GIN index for full-text search on one or more text columns
  if (tool === 'neon_create_fts_index') {
    const { table_name, columns, index_name, language = 'english', schema = 'public', database = 'neondb' } = args;
    if (!table_name || !columns?.length) throw new Error('table_name and columns[] are required');
    const idxName = index_name || `${table_name}_fts_idx`;
    const tsvectorExpr = columns.map(c => `to_tsvector('${language}', coalesce(${c},''))`).join(" || ' '::tsvector || ");
    const sql = `CREATE INDEX IF NOT EXISTS ${idxName} ON ${schema}.${table_name} USING GIN ((${tsvectorExpr}));`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Full-text search using tsvector/tsquery
  if (tool === 'neon_full_text_search') {
    const { table_name, search_query, columns, language = 'english', limit = 20, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !search_query || !columns?.length) throw new Error('table_name, search_query, and columns[] are required');
    const tsvector = columns.map(c => `to_tsvector('${language}', coalesce(${c},''))`).join(' || ');
    const safeQuery = search_query.replace(/'/g, "''");
    const sql = `SELECT *, ts_rank(${tsvector}, plainto_tsquery('${language}', '${safeQuery}')) as rank FROM ${schema}.${table_name} WHERE (${tsvector}) @@ plainto_tsquery('${language}', '${safeQuery}') ORDER BY rank DESC LIMIT ${limit};`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // pg_trgm similarity search (fuzzy matching, typo-tolerant)
  if (tool === 'neon_trigram_search') {
    const { table_name, column, search_term, limit = 20, threshold = 0.3, schema = 'public', database = 'neondb' } = args;
    if (!table_name || !column || !search_term) throw new Error('table_name, column, and search_term are required');
    const safeTerm = search_term.replace(/'/g, "''");
    const sql = `SELECT *, similarity(${column}, '${safeTerm}') as score FROM ${schema}.${table_name} WHERE similarity(${column}, '${safeTerm}') > ${threshold} ORDER BY score DESC LIMIT ${limit};`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // ── PERMISSIONS & SECURITY (NEW) ──────────────────────────────────────────

  // List all Postgres roles (not Neon API roles — DB-level roles)
  if (tool === 'neon_list_all_db_roles') {
    const sql = `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, COALESCE(rolvaliduntil::text,'never') as expires FROM pg_roles WHERE rolname NOT LIKE 'pg_%' ORDER BY rolname;`;
    return await runSQL(project_id, sql, args.database || 'neondb', branch_id);
  }

  // What privileges does a role have?
  if (tool === 'neon_list_role_privileges') {
    const { role_name, schema = 'public', database = 'neondb' } = args;
    if (!role_name) throw new Error('role_name is required');
    const sql = `SELECT table_schema, table_name, privilege_type, is_grantable FROM information_schema.role_table_grants WHERE grantee='${role_name}' AND table_schema='${schema}' ORDER BY table_name, privilege_type;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // GRANT privileges on a table to a role
  if (tool === 'neon_grant_table_access') {
    const { role_name, table_name, privileges = ['SELECT'], schema = 'public', database = 'neondb' } = args;
    if (!role_name || !table_name) throw new Error('role_name and table_name are required');
    return await runSQL(project_id, `GRANT ${privileges.join(', ')} ON ${schema}.${table_name} TO ${role_name};`, database, branch_id);
  }

  // REVOKE privileges on a table from a role
  if (tool === 'neon_revoke_table_access') {
    const { role_name, table_name, privileges = ['ALL'], schema = 'public', database = 'neondb' } = args;
    if (!role_name || !table_name) throw new Error('role_name and table_name are required');
    return await runSQL(project_id, `REVOKE ${privileges.join(', ')} ON ${schema}.${table_name} FROM ${role_name};`, database, branch_id);
  }

  // GRANT USAGE ON SCHEMA (optionally also GRANT on all tables)
  if (tool === 'neon_grant_schema_access') {
    const { role_name, schema, also_grant_tables = false, table_privileges = ['SELECT'], database = 'neondb' } = args;
    if (!role_name || !schema) throw new Error('role_name and schema are required');
    let sql = `GRANT USAGE ON SCHEMA ${schema} TO ${role_name};`;
    if (also_grant_tables) {
      sql += `\nGRANT ${table_privileges.join(', ')} ON ALL TABLES IN SCHEMA ${schema} TO ${role_name};`;
      sql += `\nALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT ${table_privileges.join(', ')} ON TABLES TO ${role_name};`;
    }
    return await runSQL(project_id, sql, database, branch_id);
  }

  // Create a dedicated read-only role with SELECT on all tables
  if (tool === 'neon_create_readonly_role') {
    const { role_name, schemas = ['public'], database = 'neondb', with_login = false, password } = args;
    if (!role_name) throw new Error('role_name is required');
    const loginClause = with_login ? ' LOGIN' : '';
    const passwordClause = password ? ` PASSWORD '${password}'` : '';
    const sql = [
      `CREATE ROLE ${role_name}${loginClause}${passwordClause};`,
      ...schemas.map(s => `GRANT USAGE ON SCHEMA ${s} TO ${role_name};`),
      ...schemas.map(s => `GRANT SELECT ON ALL TABLES IN SCHEMA ${s} TO ${role_name};`),
      ...schemas.map(s => `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT SELECT ON TABLES TO ${role_name};`)
    ].join('\n');
    return await runSQL(project_id, sql, database, branch_id);
  }

  // List Row Level Security policies on a table
  if (tool === 'neon_get_rls_policies') {
    const { table_name, schema = 'public', database = 'neondb' } = args;
    let sql = `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='${schema}'`;
    if (table_name) sql += ` AND tablename='${table_name}'`;
    sql += ` ORDER BY tablename, policyname;`;
    return await runSQL(project_id, sql, database, branch_id);
  }

  // CREATE POLICY for Row Level Security
  if (tool === 'neon_create_rls_policy') {
    const { policy_name, table_name, command = 'ALL', roles, using_expr, check_expr, permissive = true, schema = 'public', database = 'neondb' } = args;
    if (!policy_name || !table_name) throw new Error('policy_name and table_name are required');
    const permClause = permissive ? 'AS PERMISSIVE' : 'AS RESTRICTIVE';
    const toClause = roles?.length ? `TO ${roles.join(', ')}` : '';
    const usingClause = using_expr ? `USING (${using_expr})` : '';
    const checkClause = check_expr ? `WITH CHECK (${check_expr})` : '';
    const sql = `CREATE POLICY ${policy_name} ON ${schema}.${table_name} ${permClause} FOR ${command} ${toClause} ${usingClause} ${checkClause};`;
    return await runSQL(project_id, sql.replace(/\s+/g, ' ').trim(), database, branch_id);
  }

  // DROP POLICY
  if (tool === 'neon_drop_rls_policy') {
    const { policy_name, table_name, schema = 'public', database = 'neondb' } = args;
    if (!policy_name || !table_name) throw new Error('policy_name and table_name are required');
    return await runSQL(project_id, `DROP POLICY IF EXISTS ${policy_name} ON ${schema}.${table_name};`, database, branch_id);
  }

  // ENABLE ROW LEVEL SECURITY on a table
  if (tool === 'neon_enable_rls') {
    const { table_name, force = false, schema = 'public', database = 'neondb' } = args;
    if (!table_name) throw new Error('table_name is required');
    const forceClause = force ? ' FORCE' : '';
    return await runSQL(project_id, `ALTER TABLE ${schema}.${table_name} ENABLE${forceClause} ROW LEVEL SECURITY;`, database, branch_id);
  }

  // DISABLE ROW LEVEL SECURITY
  if (tool === 'neon_disable_rls') {
    const { table_name, schema = 'public', database = 'neondb' } = args;
    if (!table_name) throw new Error('table_name is required');
    return await runSQL(project_id, `ALTER TABLE ${schema}.${table_name} DISABLE ROW LEVEL SECURITY;`, database, branch_id);
  }

  // ── ADVANCED MONITORING (NEW) ─────────────────────────────────────────────

  // pg_stat_database for current database
  if (tool === 'neon_get_database_stats') {
    const sql = `SELECT datname, numbackends as connections, xact_commit as commits, xact_rollback as rollbacks, blks_read, blks_hit, round(blks_hit::numeric/NULLIF(blks_read+blks_hit,0)*100,2) as cache_hit_pct, tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted, temp_files, pg_size_pretty(temp_bytes) as temp_size, deadlocks FROM pg_stat_database WHERE datname = current_database();`;
    return await runSQL(project_id, sql, args.database || 'neondb', branch_id);
  }

  // I/O stats per table (cache hits vs disk reads)
  if (tool === 'neon_get_table_io_stats') {
    const sql = `SELECT schemaname, relname as table, heap_blks_read, heap_blks_hit, round(heap_blks_hit::numeric/NULLIF(heap_blks_read+heap_blks_hit,0)*100,2) as heap_cache_hit_pct, idx_blks_read, idx_blks_hit, round(idx_blks_hit::numeric/NULLIF(idx_blks_read+idx_blks_hit,0)*100,2) as idx_cache_hit_pct FROM pg_statio_user_tables ORDER BY heap_blks_read DESC LIMIT 20;`;
    return await runSQL(project_id, sql, args.database || 'neondb', branch_id);
  }

  // Vacuum history and dead tuple counts
  if (tool === 'neon_get_vacuum_stats') {
    const sql = `SELECT schemaname, relname as table, n_dead_tup as dead_rows, n_live_tup as live_rows, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze, vacuum_count, autovacuum_count FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 30;`;
    return await runSQL(project_id, sql, args.database || 'neondb', branch_id);
  }

  // XID wraparound risk — critical if xid_age approaches 2 billion
  if (tool === 'neon_get_transaction_id_age') {
    const sql = `SELECT datname, age(datfrozenxid) as xid_age, 2147483648 - age(datfrozenxid) as xids_remaining, round((age(datfrozenxid)::numeric / 2147483648) * 100, 2) as pct_toward_wraparound, CASE WHEN age(datfrozenxid) > 1500000000 THEN 'CRITICAL' WHEN age(datfrozenxid) > 1000000000 THEN 'WARNING' ELSE 'OK' END as status FROM pg_database ORDER BY xid_age DESC;`;
    return await runSQL(project_id, sql, args.database || 'neondb', branch_id);
  }

  // Indexes with zero index scans — candidates for removal
  if (tool === 'neon_check_unused_indexes') {
    const sql = `SELECT s.schemaname, s.tablename, s.indexname, s.idx_scan as scans_since_reset, pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid=s.indexrelid WHERE s.idx_scan = 0 AND NOT i.indisprimary AND NOT i.indisunique ORDER BY pg_relation_size(s.indexrelid) DESC;`;
    return await runSQL(project_id, sql, args.database || 'neondb', branch_id);
  }

  // Temp file usage — high numbers indicate memory pressure (work_mem too low)
  if (tool === 'neon_get_temp_file_usage') {
    const sql = `SELECT datname, temp_files, pg_size_pretty(temp_bytes) as temp_size, CASE WHEN temp_files > 1000 THEN 'HIGH — consider increasing work_mem' WHEN temp_files > 100 THEN 'MODERATE' ELSE 'OK' END as assessment FROM pg_stat_database WHERE datname = current_database();`;
    return await runSQL(project_id, sql, args.database || 'neondb', branch_id);
  }

  // What are queries/backends waiting on?
  if (tool === 'neon_get_wait_events') {
    const sql = `SELECT wait_event_type, wait_event, count(*) as count, string_agg(LEFT(query,100), ' | ' ORDER BY query_start) as sample_queries FROM pg_stat_activity WHERE wait_event IS NOT NULL GROUP BY wait_event_type, wait_event ORDER BY count DESC;`;
    return await runSQL(project_id, sql, args.database || 'neondb', branch_id);
  }

  // Comprehensive index health: size, usage, and health status
  if (tool === 'neon_get_index_health') {
    const sql = `SELECT s.schemaname, s.tablename, s.indexname, pg_size_pretty(pg_relation_size(i.indexrelid)) as size, s.idx_scan as scans, s.idx_tup_read, s.idx_tup_fetch, CASE WHEN s.idx_scan=0 THEN 'UNUSED' WHEN s.idx_scan < 50 THEN 'LOW' ELSE 'OK' END as health FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid=s.indexrelid WHERE NOT i.indisprimary ORDER BY pg_relation_size(i.indexrelid) DESC LIMIT 40;`;
    return await runSQL(project_id, sql, args.database || 'neondb', branch_id);
  }

  // ── CONNECTION STRING ─────────────────────────────────────────────────────
  if (tool === 'neon_get_connection_string' || tool === 'neon_get_connection_uri') {
    return await connectionInfo(project_id,args.database,branch_id,args.role,args.pooled!==false);
  }
  if (tool === 'neon_test_connection') {
    return await runSQL(project_id, 'SELECT version(), current_database(), current_user, now() as server_time;', args.database, branch_id);
  }

  // ── ENDPOINTS ─────────────────────────────────────────────────────────────
  if (tool === 'neon_list_endpoints') { return await n('GET', `/projects/${project_id}/endpoints`); }
  if (tool === 'neon_create_endpoint') {
    return await n('POST', `/projects/${project_id}/endpoints`, { endpoint: { branch_id: args.branch_id, type: args.type || 'read_write', autoscaling_limit_min_cu: args.min_cu || 0.25, autoscaling_limit_max_cu: args.max_cu || 0.25 } });
  }
  if (tool === 'neon_delete_endpoint') { return await n('DELETE', `/projects/${project_id}/endpoints/${args.endpoint_id}`); }
  if (tool === 'neon_update_endpoint') {
    const body = { endpoint: {} };
    if (args.autoscaling_limit_min_cu !== undefined) body.endpoint.autoscaling_limit_min_cu = args.autoscaling_limit_min_cu;
    if (args.autoscaling_limit_max_cu !== undefined) body.endpoint.autoscaling_limit_max_cu = args.autoscaling_limit_max_cu;
    if (args.suspend_timeout !== undefined) body.endpoint.suspend_timeout_seconds = args.suspend_timeout;
    return await n('PATCH', `/projects/${project_id}/endpoints/${args.endpoint_id}`, body);
  }
  if (tool === 'neon_start_endpoint') { return await n('POST', `/projects/${project_id}/endpoints/${args.endpoint_id}/start`); }
  if (tool === 'neon_suspend_endpoint') { return await n('POST', `/projects/${project_id}/endpoints/${args.endpoint_id}/suspend`); }
  if (tool === 'neon_restart_endpoint') { return await n('POST', `/projects/${project_id}/endpoints/${args.endpoint_id}/restart`); }
  if (tool === 'neon_set_endpoint_autoscaling') {
    return await n('PATCH', `/projects/${project_id}/endpoints/${args.endpoint_id}`, { endpoint: { autoscaling_limit_min_cu: args.min_cu, autoscaling_limit_max_cu: args.max_cu } });
  }
  if (tool === 'neon_set_endpoint_pooling') {
    return await n('PATCH', `/projects/${project_id}/endpoints/${args.endpoint_id}`, { endpoint: { pooler_enabled: args.enabled, pooler_mode: args.mode || 'transaction' } });
  }

  // ── ROLES ─────────────────────────────────────────────────────────────────
  if (tool === 'neon_list_roles') { return await n('GET', `/projects/${project_id}/branches/${branch_id}/roles`); }
  if (tool === 'neon_create_role') { return await n('POST', `/projects/${project_id}/branches/${branch_id}/roles`, { role: { name: args.role_name } }); }
  if (tool === 'neon_delete_role') { return await n('DELETE', `/projects/${project_id}/branches/${branch_id}/roles/${args.role_name}`); }
  if (tool === 'neon_reset_role_password') { return await n('POST', `/projects/${project_id}/branches/${branch_id}/roles/${args.role_name}/reset_password`); }

  // ── EXTENSIONS ────────────────────────────────────────────────────────────
  if (tool === 'neon_list_extensions') {
    return await runSQL(project_id, `SELECT name, default_version, installed_version, comment FROM pg_available_extensions ORDER BY name;`, args.database, branch_id);
  }
  if (tool === 'neon_enable_extension') {
    return await runSQL(project_id, `CREATE EXTENSION IF NOT EXISTS "${args.extension_name}";`, args.database, branch_id);
  }
  if (tool === 'neon_disable_extension') {
    return await runSQL(project_id, `DROP EXTENSION IF EXISTS "${args.extension_name}";`, args.database, branch_id);
  }

  // ── MIGRATIONS ────────────────────────────────────────────────────────────
  if (tool === 'neon_prepare_database_migration') {
    const branchRes = await n('POST', `/projects/${project_id}/branches`, {
      branch: { name: `migration-test-${Date.now()}`, parent_id: branch_id },
      endpoints: [{ type: 'read_write' }]
    });
    return { migration_branch_id: branchRes.branch.id, migration_branch_name: branchRes.branch.name, message: 'Temporary migration branch created. Run SQL migrations against this branch, then call neon_complete_database_migration.' };
  }
  if (tool === 'neon_complete_database_migration') {
    if (args.apply) {
      await n('POST', `/projects/${project_id}/branches/${args.migration_branch_id}/restore`, { source_branch_id: args.migration_branch_id });
      await n('DELETE', `/projects/${project_id}/branches/${args.migration_branch_id}`);
      return { success: true, message: 'Migration applied to target branch. Temp branch deleted.' };
    } else {
      await n('DELETE', `/projects/${project_id}/branches/${args.migration_branch_id}`);
      return { success: true, message: 'Migration discarded. Temp branch deleted.' };
    }
  }
  if (tool === 'neon_deploy_schema') {
    const { sql_content, database = 'neondb' } = args;
    return await runSQL(project_id, sql_content, database, branch_id);
  }
  if (tool === 'neon_verify_schema') {
    const { required_tables, database = 'neondb' } = args;
    const result = await runSQL(project_id, `SELECT tablename FROM pg_tables WHERE schemaname='public';`, database, branch_id);
    const existing = (result.rows || result).map(r => r.tablename);
    const missing = required_tables.filter(t => !existing.includes(t));
    return { all_tables: existing, required_tables, missing_tables: missing, verified: missing.length === 0 };
  }

  // ── MONITORING ────────────────────────────────────────────────────────────
  if (tool === 'neon_get_cache_hit_ratio') {
    const sql = `SELECT round(sum(blks_hit)::numeric / NULLIF(sum(blks_hit+blks_read),0) * 100, 2) as cache_hit_ratio FROM pg_stat_database WHERE datname = current_database();`;
    return await runSQL(project_id, sql, args.database, branch_id);
  }
  if (tool === 'neon_get_connection_stats') {
    const sql = `SELECT max_conn, used, res_for_super, max_conn-used-res_for_super AS available FROM (SELECT count(*) used FROM pg_stat_activity) t1, (SELECT setting::int res_for_super FROM pg_settings WHERE name='superuser_reserved_connections') t2, (SELECT setting::int max_conn FROM pg_settings WHERE name='max_connections') t3;`;
    return await runSQL(project_id, sql, args.database, branch_id);
  }

  // ── WEBHOOKS ──────────────────────────────────────────────────────────────
  if (tool === 'neon_list_webhooks') { return await n('GET', `/projects/${project_id}/webhooks`); }
  if (tool === 'neon_create_webhook') { return await n('POST', `/projects/${project_id}/webhooks`, { webhook: { url: args.url, events: args.events || ['branch.created', 'database.created'] } }); }
  if (tool === 'neon_delete_webhook') { return await n('DELETE', `/projects/${project_id}/webhooks/${args.webhook_id}`); }

  // ── ACCOUNT / BILLING (NEW) ───────────────────────────────────────────────

  // Account-level consumption across all projects
  if (tool === 'neon_get_account_consumption') {
    const { from, to, granularity = 'hourly' } = args;
    let path = `/consumption_history/account?granularity=${granularity}`;
    if (from) path += `&from=${from}`;
    if (to) path += `&to=${to}`;
    return await n('GET', path);
  }

  // Projects ranked by resource consumption
  if (tool === 'neon_list_projects_by_consumption') {
    const d = await n('GET', '/projects?limit=100');
    const projects = d.projects || [];
    return {
      projects: projects
        .sort((a, b) => (b.compute_time_seconds || 0) - (a.compute_time_seconds || 0))
        .map(p => ({ id: p.id, name: p.name, compute_time_seconds: p.compute_time_seconds, data_storage_bytes_hour: p.data_storage_bytes_hour, data_transfer_bytes: p.data_transfer_bytes, created_at: p.created_at }))
    };
  }

  // ── PERFORMANCE ───────────────────────────────────────────────────────────
  if (tool === 'neon_setup_rad_database' || tool === 'neon_create_project_for_rad') {
    const proj = await n('POST', '/projects', { project: { name: args.name || 'rai-project', region_id: args.region || 'aws-us-east-2', pg_version: 16 } });
    const projId = proj.project.id;
    const branches = await n('GET', `/projects/${projId}/branches`);
    const mainBranch = branches.branches[0];
    const connInfo = await execute('neon_get_connection_string', { project_id: projId, branch_id: mainBranch.id });
    return { project: proj.project, branch: mainBranch, connection: connInfo, message: 'Project created and ready to use.' };
  }
  if (tool === 'neon_suggest_indexes') {
    const sql = `SELECT schemaname||'.'||relname as table, seq_scan as full_table_scans, idx_scan as index_scans, CASE WHEN idx_scan=0 THEN 'No indexes used' WHEN seq_scan>idx_scan*2 THEN 'Seq scans dominant — add indexes on WHERE/JOIN columns' ELSE 'Index usage looks OK' END as recommendation FROM pg_stat_user_tables ORDER BY seq_scan DESC LIMIT 15;`;
    return await runSQL(project_id, sql, args.database, branch_id);
  }
  if (tool === 'neon_get_performance_insights') {
    const [slowQueries, indexUsage, tableStats] = await Promise.all([
      execute('neon_list_slow_queries', { project_id, branch_id, database: args.database, limit: 5 }),
      execute('neon_get_index_usage', { project_id, branch_id, database: args.database }),
      runSQL(project_id, `SELECT schemaname||'.'||relname as table, n_live_tup as rows, pg_size_pretty(pg_relation_size(relid)) as size FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;`, args.database, branch_id)
    ]);
    return { slow_queries: slowQueries, index_usage: indexUsage, table_stats: tableStats };
  }
  if (tool === 'neon_get_cost_breakdown') { return await n('GET', `/projects/${project_id}/consumption_history/events`); }
  if (tool === 'neon_get_billing_history') { return await n('GET', `/consumption_history/account`); }
  if (tool === 'neon_list_read_replicas') {
    const d = await n('GET', `/projects/${project_id}/endpoints`);
    return { read_replicas: d.endpoints.filter(e => e.type === 'read_only') };
  }
  if (tool === 'neon_create_read_replica') {
    return await n('POST', `/projects/${project_id}/endpoints`, { endpoint: { branch_id: args.branch_id || branch_id, type: 'read_only', autoscaling_limit_min_cu: args.min_cu || 0.25, autoscaling_limit_max_cu: args.max_cu || 0.25 } });
  }
  if (tool === 'neon_enable_ip_allowlist') {
    return await n('PATCH', `/projects/${project_id}`, { project: { settings: { allowed_ips: { ips: args.ips, protected_branches_only: args.protected_only || false } } } });
  }
  if (tool === 'neon_get_ip_allowlist') {
    const d = await n('GET', `/projects/${project_id}`);
    return d.project?.settings?.allowed_ips || { ips: [], protected_branches_only: false };
  }
  if (tool === 'neon_rotate_credentials') {
    return await n('POST', `/projects/${project_id}/branches/${branch_id}/roles/${args.role_name}/reset_password`);
  }
  if (tool === 'neon_provision_neon_auth') {
    const sql = `CREATE SCHEMA IF NOT EXISTS auth; GRANT USAGE ON SCHEMA auth TO neondb_owner;`;
    return await runSQL(project_id, sql, args.database, branch_id);
  }
  if (tool === 'neon_get_connection_pooler_config') {
    const d = await n('GET', `/projects/${project_id}/endpoints`);
    const ep = d.endpoints.find(e => e.branch_id === (branch_id || e.branch_id) && e.type === 'read_write');
    return { pooler_enabled: ep?.pooler_enabled, pooler_mode: ep?.pooler_mode, endpoint_id: ep?.id };
  }
  if (tool === 'neon_update_connection_pooler_config') {
    return await n('PATCH', `/projects/${project_id}/endpoints/${args.endpoint_id}`, { endpoint: { pooler_enabled: args.enabled, pooler_mode: args.mode || 'transaction' } });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SUPER TOOLS — Multi-step Neon workflows in a single command
  // ══════════════════════════════════════════════════════════════════════════

  // SUPER: Comprehensive database health check — all key indicators in one call
  if (tool === 'neon_full_health_report') {
    const db = args.database || 'neondb';
    const [cacheHit, connections, slowQueries, bloat, vacuum, unusedIndexes, xidAge, waitEvents, dbStats] = await Promise.all([
      runSQL(project_id, `SELECT round(sum(blks_hit)::numeric/NULLIF(sum(blks_hit+blks_read),0)*100,2) as cache_hit_pct FROM pg_stat_database WHERE datname=current_database();`, db, branch_id),
      runSQL(project_id, `SELECT count(*) as total, count(*) FILTER(WHERE state='active') as active, count(*) FILTER(WHERE state='idle') as idle, count(*) FILTER(WHERE wait_event IS NOT NULL) as waiting FROM pg_stat_activity;`, db, branch_id),
      runSQL(project_id, `SELECT LEFT(query,200) as query, calls, round(mean_exec_time::numeric,2) as avg_ms FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 5;`, db, branch_id).catch(() => ({ note: 'Enable pg_stat_statements for query analysis' })),
      runSQL(project_id, `SELECT schemaname||'.'||relname as table, n_dead_tup as dead_rows, round(n_dead_tup::numeric/NULLIF(n_live_tup+n_dead_tup,0)*100,2) as dead_pct FROM pg_stat_user_tables WHERE n_dead_tup > 1000 ORDER BY dead_pct DESC LIMIT 5;`, db, branch_id),
      runSQL(project_id, `SELECT relname as table, last_autovacuum, last_autoanalyze, n_dead_tup as dead_rows FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 5;`, db, branch_id),
      runSQL(project_id, `SELECT indexname, tablename, pg_size_pretty(pg_relation_size(indexrelid)) as size FROM pg_stat_user_indexes WHERE idx_scan=0 ORDER BY pg_relation_size(indexrelid) DESC LIMIT 5;`, db, branch_id),
      runSQL(project_id, `SELECT max(age(datfrozenxid)) as max_xid_age, 2147483648-max(age(datfrozenxid)) as xids_remaining FROM pg_database;`, db, branch_id),
      runSQL(project_id, `SELECT wait_event_type, wait_event, count(*) FROM pg_stat_activity WHERE wait_event IS NOT NULL GROUP BY 1,2 ORDER BY 3 DESC LIMIT 5;`, db, branch_id),
      runSQL(project_id, `SELECT pg_size_pretty(pg_database_size(current_database())) as db_size, (SELECT count(*) FROM pg_tables WHERE schemaname='public') as table_count, (SELECT count(*) FROM pg_indexes WHERE schemaname='public') as index_count;`, db, branch_id)
    ]);
    return { cache_hit_ratio: cacheHit, connections, slow_queries: slowQueries, table_bloat: bloat, vacuum_status: vacuum, unused_indexes: unusedIndexes, xid_wraparound: xidAge, wait_events: waitEvents, database_summary: dbStats, generated_at: new Date().toISOString() };
  }

  // SUPER: Safe migration — test on branch → validate → optionally apply to main
  if (tool === 'neon_safe_migration') {
    const { migration_sql, target_branch_id, database = 'neondb', validate_sql, auto_apply = false } = args;
    if (!migration_sql) throw new Error('migration_sql is required');

    // 1. Create test branch from target (defaults to current branch)
    const testBranch = await n('POST', `/projects/${project_id}/branches`, {
      branch: { name: `migration-test-${Date.now()}`, parent_id: target_branch_id || branch_id },
      endpoints: [{ type: 'read_write' }]
    });
    const testBranchId = testBranch.branch.id;

    try {
      // 2. Run migration on test branch
      const migResult = await runSQL(project_id, migration_sql, database, testBranchId);

      // 3. Optional validation query
      let validationResult = null;
      if (validate_sql) {
        validationResult = await runSQL(project_id, validate_sql, database, testBranchId);
      }

      if (auto_apply) {
        // 4. Apply to the real target branch
        await runSQL(project_id, migration_sql, database, target_branch_id || branch_id);
        await n('DELETE', `/projects/${project_id}/branches/${testBranchId}`);
        return { applied: true, migration_result: migResult, validation_result: validationResult, message: 'Migration applied to target. Test branch cleaned up.' };
      }

      return {
        applied: false,
        test_branch_id: testBranchId,
        test_branch_name: testBranch.branch.name,
        migration_result: migResult,
        validation_result: validationResult,
        message: 'Migration succeeded on test branch. Set auto_apply=true or call neon_complete_database_migration to apply to main.'
      };
    } catch (e) {
      await n('DELETE', `/projects/${project_id}/branches/${testBranchId}`).catch(() => {});
      throw new Error(`Migration FAILED on test branch: ${e.message}. Test branch cleaned up. Target branch is untouched.`);
    }
  }

  // SUPER: One-call RAG/vector search schema setup
  if (tool === 'neon_setup_rag_schema') {
    const { table_name = 'embeddings', dimensions = 1536, database = 'neondb', index_method = 'hnsw', extra_columns = [] } = args;
    const extraColDefs = extra_columns.map(c => `,\n  ${c.name} ${c.type}`).join('');
    const sql = `CREATE EXTENSION IF NOT EXISTS vector;\nCREATE TABLE IF NOT EXISTS ${table_name} (\n  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  content text NOT NULL,\n  embedding vector(${dimensions}) NOT NULL,\n  metadata jsonb DEFAULT '{}',\n  source text,\n  created_at timestamptz DEFAULT now()${extraColDefs}\n);\nCREATE INDEX IF NOT EXISTS ${table_name}_embedding_cosine_idx ON ${table_name} USING ${index_method} (embedding vector_cosine_ops);\nCREATE INDEX IF NOT EXISTS ${table_name}_metadata_gin_idx ON ${table_name} USING GIN (metadata);\nCREATE INDEX IF NOT EXISTS ${table_name}_created_idx ON ${table_name} (created_at DESC);`;
    await runSQL(project_id, sql, database, branch_id);
    const connInfo = await execute('neon_get_connection_string', { project_id, branch_id, database });
    return { table: table_name, dimensions, index_method, sql_applied: sql, connection: connInfo, message: `RAG schema created. Use neon_insert_embedding or neon_bulk_insert_embeddings to add vectors, then neon_similarity_search_cosine to query.` };
  }

  // SUPER: Get connection string in every common format at once
  if (tool === 'neon_connection_string_all_formats') {
    const { database = 'neondb', role = 'neondb_owner', pooled = true } = args;
    const endpoints = await n('GET', `/projects/${project_id}/endpoints`);
    const bid = branch_id || (await n('GET', `/projects/${project_id}/branches`)).branches.find(b => b.primary)?.id;
    const ep = endpoints.endpoints.find(e => e.branch_id === bid && e.type === 'read_write');
    if (!ep) throw new Error('No endpoint found');
    const host = pooled ? ep.host.replace('.aws.neon.tech', '-pooler.aws.neon.tech') : ep.host;
    const base = `postgresql://${role}@${host}/${database}?sslmode=require`;
    return {
      postgres_url: base,
      env_format: `DATABASE_URL="${base}"`,
      psql: `psql "${base}"`,
      nodejs_neon: `import { neon } from '@neondatabase/serverless';\nconst sql = neon('${base}');`,
      prisma_schema: `datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}`,
      drizzle: `import { drizzle } from 'drizzle-orm/neon-http';\nimport { neon } from '@neondatabase/serverless';\nconst sql = neon(process.env.DATABASE_URL!);\nconst db = drizzle(sql);`,
      python_asyncpg: `conn = await asyncpg.connect('${base}')`,
      python_psycopg: `conn = psycopg2.connect('${base}')`,
      go: `db, _ := sql.Open("postgres", "${base}")`,
      host: ep.host, pooler_host: host, database, role, endpoint_id: ep.id
    };
  }

  // SUPER: Create a named point-in-time backup branch (no endpoint = no compute cost)
  if (tool === 'neon_backup_create') {
    const { backup_name, description } = args;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = backup_name || `backup-${timestamp}`;
    const branchRes = await n('POST', `/projects/${project_id}/branches`, {
      branch: { name, parent_id: branch_id }
      // No endpoints = storage-only, zero compute cost
    });
    return {
      backup_branch_id: branchRes.branch.id,
      backup_name: branchRes.branch.name,
      created_at: branchRes.branch.created_at,
      description: description || 'Manual point-in-time backup',
      compute_cost: 'none — no endpoint created',
      restore_command: `neon_restore_branch_to_timestamp with branch_id="${branchRes.branch.id}"`,
      message: `Backup created. No endpoint means no compute charges. Restore with neon_clone_branch or neon_restore_branch_to_timestamp.`
    };
  }

  // SUPER: Query schema and output TypeScript interface types
  if (tool === 'neon_generate_typescript_types') {
    const { schema = 'public', database = 'neondb', include_comments = true } = args;
    const result = await runSQL(project_id, `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema='${schema}' ORDER BY table_name, ordinal_position;`, database, branch_id);
    const rows = result.rows || (Array.isArray(result) ? result : []);
    if (!rows.length) return { types: '// No tables found in schema', table_count: 0 };

    const typeMap = {
      'integer': 'number', 'bigint': 'number', 'smallint': 'number', 'numeric': 'number', 'real': 'number', 'double precision': 'number', 'serial': 'number', 'bigserial': 'number',
      'boolean': 'boolean',
      'text': 'string', 'character varying': 'string', 'varchar': 'string', 'char': 'string', 'character': 'string', 'name': 'string', 'citext': 'string', 'bpchar': 'string',
      'uuid': 'string',
      'json': 'Record<string, unknown>', 'jsonb': 'Record<string, unknown>',
      'timestamp with time zone': 'Date', 'timestamp without time zone': 'Date', 'timestamptz': 'Date', 'date': 'Date',
      'time with time zone': 'string', 'time without time zone': 'string',
      'bytea': 'Buffer',
      'ARRAY': 'unknown[]',
      'vector': 'number[]',
      'inet': 'string', 'cidr': 'string', 'macaddr': 'string',
      'interval': 'string', 'money': 'string',
      'tsvector': 'string', 'tsquery': 'string'
    };

    const tables = {};
    for (const row of rows) {
      if (!tables[row.table_name]) tables[row.table_name] = [];
      tables[row.table_name].push(row);
    }

    const interfaces = Object.entries(tables).map(([tableName, cols]) => {
      const typeName = tableName.replace(/_([a-z])/g, (_, c) => c.toUpperCase()).replace(/^./, s => s.toUpperCase());
      const props = cols.map(col => {
        const tsType = typeMap[col.data_type] || typeMap[col.udt_name] || 'unknown';
        const optional = col.is_nullable === 'YES' ? '?' : '';
        const comment = include_comments && col.column_default ? ` // default: ${col.column_default}` : '';
        return `  ${col.column_name}${optional}: ${tsType};${comment}`;
      }).join('\n');
      return `export interface ${typeName} {\n${props}\n}`;
    }).join('\n\n');

    return { types: interfaces, table_count: Object.keys(tables).length, schema, generated_at: new Date().toISOString() };
  }

  // SUPER: Comprehensive missing index analysis
  if (tool === 'neon_find_missing_indexes') {
    const db = args.database || 'neondb';
    const sql = `SELECT s.schemaname || '.' || s.relname AS table, s.seq_scan AS seq_scans, s.idx_scan AS idx_scans, s.seq_tup_read AS rows_read_by_seqscan, pg_size_pretty(pg_relation_size(s.relid)) AS table_size, CASE WHEN s.seq_scan=0 THEN 'No activity — consider dropping' WHEN s.idx_scan=0 AND s.seq_scan>100 THEN 'CRITICAL: Heavy seq scans, zero index use' WHEN s.seq_scan > s.idx_scan*3 THEN 'HIGH: Seq scans dominate — add index on WHERE/JOIN columns' WHEN s.seq_scan > s.idx_scan THEN 'MEDIUM: More seq than index scans' ELSE 'OK' END AS recommendation FROM pg_stat_user_tables s WHERE s.seq_scan > 50 ORDER BY s.seq_tup_read DESC LIMIT 25;`;
    return await runSQL(project_id, sql, db, branch_id);
  }

  // SUPER: Full performance tuning report — everything in one call
  if (tool === 'neon_performance_tuning_report') {
    const db = args.database || 'neondb';
    const [slowest, missingIdx, unusedIdx, bloat, cacheHit, tempFiles, waitEvents, tableStats, xidAge] = await Promise.all([
      runSQL(project_id, `SELECT LEFT(query,200) as query, calls, round(mean_exec_time::numeric,2) as avg_ms, round(total_exec_time::numeric,2) as total_ms FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;`, db, branch_id).catch(() => ({ note: 'Enable pg_stat_statements extension for query analysis' })),
      runSQL(project_id, `SELECT schemaname||'.'||relname as table, seq_scan, idx_scan FROM pg_stat_user_tables WHERE seq_scan > idx_scan AND seq_scan > 100 ORDER BY seq_scan DESC LIMIT 10;`, db, branch_id),
      runSQL(project_id, `SELECT indexrelname, tablename, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) as size FROM pg_stat_user_indexes WHERE idx_scan=0 ORDER BY pg_relation_size(indexrelid) DESC LIMIT 10;`, db, branch_id),
      runSQL(project_id, `SELECT schemaname||'.'||relname as table, n_dead_tup as dead, n_live_tup as live, round(n_dead_tup::numeric/NULLIF(n_live_tup+n_dead_tup,0)*100,2) as dead_pct FROM pg_stat_user_tables WHERE n_dead_tup > 500 ORDER BY dead_pct DESC LIMIT 10;`, db, branch_id),
      runSQL(project_id, `SELECT round(sum(blks_hit)::numeric/NULLIF(sum(blks_hit+blks_read),0)*100,2) as cache_hit_pct FROM pg_stat_database WHERE datname=current_database();`, db, branch_id),
      runSQL(project_id, `SELECT temp_files, pg_size_pretty(temp_bytes) as temp_size FROM pg_stat_database WHERE datname=current_database();`, db, branch_id),
      runSQL(project_id, `SELECT wait_event_type, wait_event, count(*) FROM pg_stat_activity WHERE wait_event IS NOT NULL GROUP BY 1,2 ORDER BY 3 DESC LIMIT 5;`, db, branch_id),
      runSQL(project_id, `SELECT schemaname||'.'||relname as table, n_live_tup as rows, pg_size_pretty(pg_total_relation_size(relid)) as total_size FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;`, db, branch_id),
      runSQL(project_id, `SELECT max(age(datfrozenxid)) as max_xid_age, round((max(age(datfrozenxid))::numeric/2147483648)*100,2) as pct_toward_wraparound FROM pg_database;`, db, branch_id)
    ]);
    return {
      slowest_queries: slowest, missing_indexes: missingIdx, unused_indexes: unusedIdx,
      table_bloat: bloat, cache_hit_ratio: cacheHit, temp_file_usage: tempFiles,
      wait_events: waitEvents, largest_tables: tableStats, xid_wraparound: xidAge,
      generated_at: new Date().toISOString(),
      next_steps: [
        'Run VACUUM ANALYZE on tables with high dead tuple counts',
        'Add indexes on columns in WHERE/JOIN clauses of slow queries',
        'Drop unused indexes to reduce write overhead and storage',
        'Increase work_mem if temp_files count is high',
        'Run VACUUM FREEZE if xid_age is approaching 1.5 billion'
      ]
    };
  }

  throw new Error(`Unknown Neon tool: ${tool}`);

  // ── IP ALLOWLIST MANAGEMENT ────────────────────────────────────────────────
  if (tool === 'neon_update_ip_allowlist') {
    const { project_id, allowed_ips, primary_branch_only = false } = args;
    if (!project_id) throw new Error('project_id is required');
    return await n('PATCH', `/projects/${project_id}`, {
      project: { settings: { allowed_ips: { ips: allowed_ips || [], protected_branches_only: primary_branch_only } } }
    });
  }
  if (tool === 'neon_add_ip_to_allowlist') {
    const { project_id, ip } = args;
    if (!project_id || !ip) throw new Error('project_id and ip are required');
    const proj = await n('GET', `/projects/${project_id}`);
    const existing = proj.project?.settings?.allowed_ips?.ips || [];
    if (existing.includes(ip)) return { success: true, message: `${ip} already in allowlist`, ips: existing };
    const updated = [...existing, ip];
    return await n('PATCH', `/projects/${project_id}`, {
      project: { settings: { allowed_ips: { ips: updated } } }
    });
  }
  if (tool === 'neon_remove_ip_from_allowlist') {
    const { project_id, ip } = args;
    if (!project_id || !ip) throw new Error('project_id and ip are required');
    const proj = await n('GET', `/projects/${project_id}`);
    const existing = proj.project?.settings?.allowed_ips?.ips || [];
    const updated = existing.filter(i => i !== ip);
    return await n('PATCH', `/projects/${project_id}`, {
      project: { settings: { allowed_ips: { ips: updated } } }
    });
  }

  // ── LOGICAL REPLICATION ────────────────────────────────────────────────────
  if (tool === 'neon_enable_logical_replication') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    return await n('PATCH', `/projects/${project_id}`, {
      project: { settings: { enable_logical_replication: true } }
    });
  }
  if (tool === 'neon_list_replication_slots') {
    const { connection_string, project_id, branch_id } = args;
    if (!connection_string && !project_id) throw new Error('connection_string or project_id is required');
    return await runSQL(project_id || process.env.NEON_PROJECT_ID, 'SELECT slot_name, plugin, slot_type, active, restart_lsn, confirmed_flush_lsn FROM pg_replication_slots', 'neondb', branch_id);
  }
  if (tool === 'neon_create_replication_slot') {
    const { slot_name, plugin = 'pgoutput', project_id, branch_id } = args;
    if (!slot_name) throw new Error('slot_name is required');
    return await runSQL(project_id || process.env.NEON_PROJECT_ID, `SELECT pg_create_logical_replication_slot('${slot_name}', '${plugin}')`, 'neondb', branch_id);
  }
  if (tool === 'neon_drop_replication_slot') {
    const { slot_name, project_id, branch_id } = args;
    if (!slot_name) throw new Error('slot_name is required');
    return await runSQL(project_id || process.env.NEON_PROJECT_ID, `SELECT pg_drop_replication_slot('${slot_name}')`, 'neondb', branch_id);
  }
  if (tool === 'neon_list_publications') {
    const { project_id, branch_id } = args;
    return await runSQL(project_id || process.env.NEON_PROJECT_ID, 'SELECT pubname, puballtables, pubinsert, pubupdate, pubdelete FROM pg_publication', 'neondb', branch_id);
  }
  if (tool === 'neon_create_publication') {
    const { publication_name, for_all_tables = true, tables, project_id, branch_id } = args;
    if (!publication_name) throw new Error('publication_name is required');
    let sql;
    if (for_all_tables) {
      sql = `CREATE PUBLICATION ${publication_name} FOR ALL TABLES`;
    } else if (tables?.length) {
      sql = `CREATE PUBLICATION ${publication_name} FOR TABLE ${tables.join(', ')}`;
    } else {
      throw new Error('Either for_all_tables or tables array is required');
    }
    return await runSQL(project_id || process.env.NEON_PROJECT_ID, sql, 'neondb', branch_id);
  }
  if (tool === 'neon_drop_publication') {
    const { publication_name, project_id, branch_id } = args;
    if (!publication_name) throw new Error('publication_name is required');
    return await runSQL(project_id || process.env.NEON_PROJECT_ID, `DROP PUBLICATION IF EXISTS ${publication_name}`, 'neondb', branch_id);
  }

  // ── ORGANIZATION BILLING ───────────────────────────────────────────────────
  if (tool === 'neon_get_org_billing') {
    const { org_id } = args;
    if (!org_id) throw new Error('org_id is required');
    return await n('GET', `/organizations/${org_id}/billing`);
  }
  if (tool === 'neon_list_org_projects') {
    const { org_id } = args;
    if (!org_id) throw new Error('org_id is required');
    return await n('GET', `/organizations/${org_id}/projects`);
  }
  if (tool === 'neon_list_org_members') {
    const { org_id } = args;
    if (!org_id) throw new Error('org_id is required');
    return await n('GET', `/organizations/${org_id}/members`);
  }
  if (tool === 'neon_get_org_consumption') {
    const { org_id } = args;
    if (!org_id) throw new Error('org_id is required');
    return await n('GET', `/organizations/${org_id}/consumption`);
  }

  // ── NEON AUTH (JWT integration) ────────────────────────────────────────────
  if (tool === 'neon_get_auth_config') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    return await n('GET', `/projects/${project_id}/auth`);
  }
  if (tool === 'neon_update_auth_config') {
    const { project_id, jwks_url, role_names } = args;
    if (!project_id) throw new Error('project_id is required');
    const body = {};
    if (jwks_url) body.jwks_url = jwks_url;
    if (role_names) body.role_names = role_names;
    return await n('PATCH', `/projects/${project_id}/auth`, body);
  }

  // ── SUPER TOOL: Full project security audit ───────────────────────────────
  if (tool === 'neon_project_security_audit') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    const [proj, roles, policies] = await Promise.all([
      neon('GET', `/projects/${project_id}`),
      neon('GET', `/projects/${project_id}/branches`).then(async (b) => {
        const primaryBranch = (b.branches || []).find(br => br.primary) || b.branches?.[0];
        if (!primaryBranch) return [];
        return neon('GET', `/projects/${project_id}/branches/${primaryBranch.id}/roles`).then(r => r.roles || []).catch(() => []);
      }),
      runSQL(project_id || process.env.NEON_PROJECT_ID, 'SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = \'public\' ORDER BY tablename', 'neondb').catch(() => [])
    ]);
    const project = proj.project;
    const allowedIps = project?.settings?.allowed_ips?.ips || [];
    const tables = Array.isArray(policies) ? policies : [];
    return {
      project_id,
      name: project?.name,
      region: project?.region_id,
      ip_allowlist: { enabled: allowedIps.length > 0, ips: allowedIps },
      logical_replication: project?.settings?.enable_logical_replication || false,
      roles_count: Array.isArray(roles) ? roles.length : 0,
      tables_with_rls: tables.filter(t => t.rowsecurity).length,
      tables_without_rls: tables.filter(t => !t.rowsecurity).map(t => t.tablename),
      generated_at: new Date().toISOString()
    };
  }

  throw new Error(`Unknown Neon tool: ${tool}`);
}

export default { execute };
