/**
 * Supabase Handler — 103 tools
 * Database, auth, storage, edge functions, realtime, webhooks,
 * RLS policies, roles, schemas, extensions, branches, and Super Tools.
 */

const MGMT_BASE = 'https://api.supabase.com/v1';

function mgmtHeaders() {
  const key = process.env.SUPABASE_ACCESS_TOKEN;
  if (!key) throw new Error('SUPABASE_ACCESS_TOKEN is required for the Management API');
  return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function projectHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'apikey': key };
}

const projectUrl = (ref) => {
  const url = process.env.SUPABASE_URL;
  if (!url && !ref) throw new Error('SUPABASE_URL not set in .env');
  if (ref) return `https://${ref}.supabase.co`;
  return url;
};

async function mgmt(method, path, body) {
  const res = await fetch(`${MGMT_BASE}${path}`, {
    method, headers: mgmtHeaders(),
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(`Supabase Mgmt ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

async function proj(method, path, body, projectRef) {
  const base = projectUrl(projectRef);
  const res = await fetch(`${base}${path}`, {
    method, headers: projectHeaders(),
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${data.message || data.hint || JSON.stringify(data)}`);
  return data;
}

// REST API data helper — builds PostgREST query
async function restQuery(method, table, params, body, projectRef) {
  const base = projectUrl(projectRef);
  let url = `${base}/rest/v1/${table}`;
  if (params && Object.keys(params).length) {
    url += '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  }
  const headers = {
    ...projectHeaders(),
    'Prefer': method === 'POST' ? 'return=representation' : method === 'PATCH' ? 'return=representation' : 'return=representation'
  };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(`Supabase REST ${res.status}: ${data.message || data.hint || JSON.stringify(data)}`);
  return data;
}

// Management logs now use the unified ClickHouse stream. Service selection is
// explicit; user search text is a literal substring, never a SQL expression.
async function readProjectLogs(args,service=args.service) {
  const {project_id,limit=100,search,iso_timestamp_start,iso_timestamp_end}=args;
  const sources={api:'edge_logs',auth:'auth_logs',storage:'storage_logs',realtime:'realtime_logs',postgres:'postgres_logs'};
  if(!/^[a-z0-9-]{1,64}$/.test(project_id||'')||!Object.hasOwn(sources,service))throw new Error('Valid project_id and supported log service are required');
  if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('limit must be an integer from 1 to 1000');
  if(search!==undefined&&(typeof search!=='string'||search.length>1000||/[\u0000-\u001f]/.test(search)))throw new Error('search must be text without control characters, at most 1000 characters');
  if(Boolean(iso_timestamp_start)!==Boolean(iso_timestamp_end))throw new Error('Provide both time range endpoints');
  const end=iso_timestamp_end?new Date(iso_timestamp_end):new Date();
  const start=iso_timestamp_start?new Date(iso_timestamp_start):new Date(end.getTime()-60000);
  if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start||end-start>86400000)throw new Error('Log time range must be positive and at most 24 hours');
  let sql=`SELECT timestamp, id, event_message, severity_text, source FROM logs WHERE source = '${sources[service]}'`;
  if(search){const literal=search.replaceAll('\\','\\\\').replaceAll("'","\\'");sql+=` AND positionCaseInsensitiveUTF8(event_message, '${literal}') > 0`;}
  sql+=` ORDER BY timestamp DESC LIMIT ${limit}`;
  const query=new URLSearchParams({sql,iso_timestamp_start:start.toISOString(),iso_timestamp_end:end.toISOString()});
  const response=await mgmt('GET',`/projects/${project_id}/analytics/endpoints/logs?${query}`);
  if(response.error)throw new Error(`Supabase log query failed: ${typeof response.error==='string'?response.error:JSON.stringify(response.error)}`);
  if(!Array.isArray(response.result))throw new Error('Supabase returned an invalid log result');
  return {...response,service,timeRange:{start:start.toISOString(),end:end.toISOString(),defaulted:!iso_timestamp_start},rowCount:response.result.length,limit,
    limitReached:response.result.length>=limit,warnings:response.result.length>=limit?['Row limit reached; narrow the time range to retrieve more events.']:[]};
}

async function execute(tool, args) {
  const { project_ref } = args;

  if (tool === 'supabase_get_logs') return await readProjectLogs(args);
  if (tool === 'supabase_get_postgres_logs') return await readProjectLogs(args,'postgres');

  // ── PROJECT MANAGEMENT ────────────────────────────────────────────────────
  if (tool === 'supabase_list_projects') { return await mgmt('GET', '/projects'); }
  if (tool === 'supabase_get_project') { return await mgmt('GET', `/projects/${project_ref}`); }
  if (tool === 'supabase_pause_project') { return await mgmt('POST', `/projects/${project_ref}/pause`, {}); }
  if (tool === 'supabase_restore_project') { return await mgmt('POST', `/projects/${project_ref}/restore`, {}); }
  if (tool === 'supabase_get_project_health') { return await mgmt('GET', `/projects/${project_ref}/health`); }
  if (tool === 'supabase_get_project_settings') { return await mgmt('GET', `/projects/${project_ref}/settings`); }
  if (tool === 'supabase_get_project_usage') { return await mgmt('GET', `/projects/${project_ref}/usage`); }
  if (tool === 'supabase_get_project_url') {
    const config = await mgmt('GET', `/projects/${project_ref}/api`);
    return { url: `https://${project_ref}.supabase.co`, anon_key: config.anon_key, service_role_key: '***hidden***' };
  }
  if (tool === 'supabase_get_api_keys') { return await mgmt('GET', `/projects/${project_ref}/api-keys`); }

  // ── ORGANIZATIONS ─────────────────────────────────────────────────────────
  if (tool === 'supabase_list_organizations') { return await mgmt('GET', '/organizations'); }
  if (tool === 'supabase_get_organization') { return await mgmt('GET', `/organizations/${args.org_id}`); }
  if (tool === 'supabase_list_org_members') { return await mgmt('GET', `/organizations/${args.org_id}/members`); }

  // ── DATABASE: SQL ─────────────────────────────────────────────────────────
  if (tool === 'supabase_run_sql') {
    if (!args.sql) throw new Error('sql is required');
    return await proj('POST', '/rest/v1/rpc/query', { query: args.sql }, project_ref);
  }
  if (tool === 'supabase_run_query_via_mgmt') {
    return await mgmt('POST', `/projects/${project_ref}/database/query`, { query: args.sql });
  }
  if (tool === 'supabase_run_migration') {
    return await mgmt('POST', `/projects/${project_ref}/database/migrations`, { name: args.name, statements: [args.sql] });
  }
  if (tool === 'supabase_list_migrations') { return await mgmt('GET', `/projects/${project_ref}/database/migrations`); }

  // ── DATABASE: SCHEMA INSPECTION ───────────────────────────────────────────
  if (tool === 'supabase_list_tables') {
    return await mgmt('GET', `/projects/${project_ref}/database/tables?included_schemas=${args.schema || 'public'}`);
  }
  if (tool === 'supabase_describe_table') {
    return await mgmt('GET', `/projects/${project_ref}/database/columns?table_id=${args.table_name}&schema=${args.schema || 'public'}`);
  }
  if (tool === 'supabase_list_schemas') {
    return await mgmt('GET', `/projects/${project_ref}/database/schemas`);
  }
  if (tool === 'supabase_list_columns') {
    return await mgmt('GET', `/projects/${project_ref}/database/columns?included_schemas=${args.schema || 'public'}`);
  }
  if (tool === 'supabase_list_indexes') {
    return await mgmt('GET', `/projects/${project_ref}/database/indexes?schema=${args.schema || 'public'}`);
  }
  if (tool === 'supabase_list_functions') {
    return await mgmt('GET', `/projects/${project_ref}/database/functions?included_schemas=${args.schema || 'public'}`);
  }
  if (tool === 'supabase_list_triggers') {
    return await mgmt('GET', `/projects/${project_ref}/database/triggers?included_schemas=${args.schema || 'public'}`);
  }
  if (tool === 'supabase_list_views') {
    return await mgmt('GET', `/projects/${project_ref}/database/views?included_schemas=${args.schema || 'public'}`);
  }
  if (tool === 'supabase_list_enums') {
    return await mgmt('GET', `/projects/${project_ref}/database/types?included_schemas=${args.schema || 'public'}`);
  }
  if (tool === 'supabase_list_publications') {
    return await mgmt('GET', `/projects/${project_ref}/database/publications`);
  }
  if (tool === 'supabase_list_extensions') {
    return await mgmt('GET', `/projects/${project_ref}/database/extensions`);
  }

  // ── DATABASE: SCHEMA MODIFICATION ────────────────────────────────────────
  if (tool === 'supabase_create_column') {
    const { table_id, name, type, default_value, is_nullable = true, is_unique = false, is_primary_key = false } = args;
    if (!table_id || !name || !type) throw new Error('table_id, name, and type are required');
    return await mgmt('POST', `/projects/${project_ref}/database/columns`, {
      table_id, name, type, default_value, is_nullable, is_unique, is_primary_key
    });
  }
  if (tool === 'supabase_update_column') {
    const { column_id, ...updates } = args;
    return await mgmt('PATCH', `/projects/${project_ref}/database/columns/${column_id}`, updates);
  }
  if (tool === 'supabase_delete_column') {
    const { column_id, cascade = false } = args;
    return await mgmt('DELETE', `/projects/${project_ref}/database/columns/${column_id}?cascade=${cascade}`);
  }
  if (tool === 'supabase_create_table') {
    const { name, schema = 'public', comment, primary_key } = args;
    if (!name) throw new Error('name is required');
    return await mgmt('POST', `/projects/${project_ref}/database/tables`, { name, schema, comment, primary_key });
  }
  if (tool === 'supabase_update_table') {
    const { table_id, ...updates } = args;
    return await mgmt('PATCH', `/projects/${project_ref}/database/tables/${table_id}`, updates);
  }
  if (tool === 'supabase_delete_table') {
    return await mgmt('DELETE', `/projects/${project_ref}/database/tables/${args.table_id}?cascade=${args.cascade || false}`);
  }
  if (tool === 'supabase_create_index') {
    const { name, schema = 'public', table_name, definition } = args;
    return await mgmt('POST', `/projects/${project_ref}/database/indexes`, { name, schema, table, definition });
  }
  if (tool === 'supabase_delete_index') {
    return await mgmt('DELETE', `/projects/${project_ref}/database/indexes?name=${args.name}`);
  }
  if (tool === 'supabase_enable_extension') {
    return await mgmt('POST', `/projects/${project_ref}/database/extensions`, { name: args.extension_name, schema: args.schema || 'extensions', version: args.version });
  }
  if (tool === 'supabase_disable_extension') {
    return await mgmt('DELETE', `/projects/${project_ref}/database/extensions/${args.extension_name}`);
  }
  if (tool === 'supabase_vacuum_table') {
    return await mgmt('POST', `/projects/${project_ref}/database/query`, { query: `VACUUM ANALYZE ${args.schema || 'public'}.${args.table_name};` });
  }

  // ── DATABASE: ROLES ───────────────────────────────────────────────────────
  if (tool === 'supabase_list_roles') {
    return await mgmt('GET', `/projects/${project_ref}/database/roles`);
  }
  if (tool === 'supabase_create_role') {
    return await mgmt('POST', `/projects/${project_ref}/database/roles`, { name: args.name, is_replication_role: args.is_replication || false, is_superuser: args.is_superuser || false });
  }
  if (tool === 'supabase_delete_role') {
    return await mgmt('DELETE', `/projects/${project_ref}/database/roles/${args.role_id}`);
  }

  // ── RLS POLICIES ──────────────────────────────────────────────────────────
  if (tool === 'supabase_list_policies') {
    return await mgmt('GET', `/projects/${project_ref}/database/policies?included_schemas=${args.schema || 'public'}`);
  }
  if (tool === 'supabase_get_policy') {
    return await mgmt('GET', `/projects/${project_ref}/database/policies/${args.policy_id}`);
  }
  if (tool === 'supabase_create_policy') {
    const { name, table_id, action = 'ALL', definition, check, roles = ['public'], command = 'SELECT' } = args;
    if (!name || !table_id) throw new Error('name and table_id are required');
    return await mgmt('POST', `/projects/${project_ref}/database/policies`, { name, table_id, action, definition, check, roles, command });
  }
  if (tool === 'supabase_update_policy') {
    const { policy_id, ...updates } = args;
    return await mgmt('PATCH', `/projects/${project_ref}/database/policies/${policy_id}`, updates);
  }
  if (tool === 'supabase_delete_policy') {
    return await mgmt('DELETE', `/projects/${project_ref}/database/policies/${args.policy_id}`);
  }

  // ── AUTH / USERS ──────────────────────────────────────────────────────────
  if (tool === 'supabase_list_users') {
    const { page = 1, per_page = 50 } = args;
    return await proj('GET', `/auth/v1/admin/users?page=${page}&per_page=${per_page}`, null, project_ref);
  }
  if (tool === 'supabase_get_user') {
    return await proj('GET', `/auth/v1/admin/users/${args.user_id}`, null, project_ref);
  }
  if (tool === 'supabase_create_user') {
    const { email, password, phone, email_confirm = true, user_metadata } = args;
    const body = { email, password, phone, email_confirm };
    if (user_metadata) body.user_metadata = user_metadata;
    return await proj('POST', '/auth/v1/admin/users', body, project_ref);
  }
  if (tool === 'supabase_update_user') {
    const { user_id, ...updates } = args;
    return await proj('PUT', `/auth/v1/admin/users/${user_id}`, updates, project_ref);
  }
  if (tool === 'supabase_delete_user') {
    return await proj('DELETE', `/auth/v1/admin/users/${args.user_id}`, null, project_ref);
  }
  if (tool === 'supabase_invite_user') {
    return await proj('POST', '/auth/v1/invite', { email: args.email, data: args.metadata || {} }, project_ref);
  }
  if (tool === 'supabase_send_password_reset') {
    return await proj('POST', '/auth/v1/recover', { email: args.email }, project_ref);
  }
  if (tool === 'supabase_ban_user') {
    return await proj('PUT', `/auth/v1/admin/users/${args.user_id}`, { ban_duration: args.duration || 'none' }, project_ref);
  }
  if (tool === 'supabase_unban_user') {
    return await proj('PUT', `/auth/v1/admin/users/${args.user_id}`, { ban_duration: 'none' }, project_ref);
  }
  if (tool === 'supabase_sign_out_user') {
    return await proj('POST', `/auth/v1/admin/users/${args.user_id}/logout`, { scope: args.scope || 'global' }, project_ref);
  }
  if (tool === 'supabase_update_user_email') {
    return await proj('PUT', `/auth/v1/admin/users/${args.user_id}`, { email: args.new_email }, project_ref);
  }
  if (tool === 'supabase_update_user_password') {
    return await proj('PUT', `/auth/v1/admin/users/${args.user_id}`, { password: args.new_password }, project_ref);
  }
  if (tool === 'supabase_list_auth_providers') {
    return await mgmt('GET', `/projects/${project_ref}/config/auth`);
  }
  if (tool === 'supabase_update_auth_config') {
    const { project_ref: _, ...config } = args;
    return await mgmt('PATCH', `/projects/${project_ref}/config/auth`, config);
  }

  // ── STORAGE ───────────────────────────────────────────────────────────────
  if (tool === 'supabase_list_buckets') {
    return await proj('GET', '/storage/v1/bucket', null, project_ref);
  }
  if (tool === 'supabase_create_bucket') {
    return await proj('POST', '/storage/v1/bucket', { id: args.name, name: args.name, public: args.public || false, fileSizeLimit: args.file_size_limit }, project_ref);
  }
  if (tool === 'supabase_update_bucket') {
    return await proj('PUT', `/storage/v1/bucket/${args.bucket_id}`, { public: args.public, fileSizeLimit: args.file_size_limit, allowedMimeTypes: args.allowed_mime_types }, project_ref);
  }
  if (tool === 'supabase_delete_bucket') {
    return await proj('DELETE', `/storage/v1/bucket/${args.bucket_id}`, null, project_ref);
  }
  if (tool === 'supabase_empty_bucket') {
    return await proj('POST', `/storage/v1/bucket/${args.bucket_id}/empty`, {}, project_ref);
  }
  if (tool === 'supabase_list_objects') {
    const { bucket_id, prefix = '', limit = 100, offset = 0, search } = args;
    return await proj('POST', `/storage/v1/object/list/${bucket_id}`, { prefix, limit, offset, search: search || '' }, project_ref);
  }
  if (tool === 'supabase_get_public_url') {
    const base = projectUrl(project_ref);
    return { url: `${base}/storage/v1/object/public/${args.bucket_id}/${args.path}` };
  }
  if (tool === 'supabase_get_signed_url') {
    const { bucket_id, path: filePath, expires_in = 3600 } = args;
    return await proj('POST', `/storage/v1/object/sign/${bucket_id}/${filePath}`, { expiresIn: expires_in }, project_ref);
  }
  if (tool === 'supabase_create_signed_upload_url') {
    return await proj('POST', `/storage/v1/object/upload/sign/${args.bucket_id}/${args.path}`, {}, project_ref);
  }
  if (tool === 'supabase_delete_objects') {
    return await proj('DELETE', `/storage/v1/object/${args.bucket_id}`, { prefixes: args.paths }, project_ref);
  }
  if (tool === 'supabase_move_object') {
    return await proj('POST', '/storage/v1/object/move', { bucketId: args.bucket_id, sourceKey: args.source_path, destinationKey: args.destination_path }, project_ref);
  }
  if (tool === 'supabase_copy_object') {
    return await proj('POST', '/storage/v1/object/copy', { bucketId: args.bucket_id, sourceKey: args.source_path, destinationKey: args.destination_path }, project_ref);
  }

  // ── EDGE FUNCTIONS ────────────────────────────────────────────────────────
  if (tool === 'supabase_list_edge_functions') {
    return await mgmt('GET', `/projects/${project_ref}/functions`);
  }
  if (tool === 'supabase_get_edge_function') {
    return await mgmt('GET', `/projects/${project_ref}/functions/${args.function_slug}`);
  }
  if (tool === 'supabase_create_edge_function') {
    const { name, body: fnBody, import_map, verify_jwt = true } = args;
    if (!name) throw new Error('name is required');
    return await mgmt('POST', `/projects/${project_ref}/functions`, { slug: name, name, body: fnBody || '// Deno Edge Function', import_map, verify_jwt });
  }
  if (tool === 'supabase_update_edge_function') {
    const { function_slug, body: fnBody, import_map, verify_jwt } = args;
    const update = {};
    if (fnBody !== undefined) update.body = fnBody;
    if (import_map !== undefined) update.import_map = import_map;
    if (verify_jwt !== undefined) update.verify_jwt = verify_jwt;
    return await mgmt('PATCH', `/projects/${project_ref}/functions/${function_slug}`, update);
  }
  if (tool === 'supabase_delete_edge_function') {
    return await mgmt('DELETE', `/projects/${project_ref}/functions/${args.function_slug}`);
  }
  if (tool === 'supabase_invoke_edge_function') {
    const { function_slug, body: fnBody, method: fnMethod = 'POST' } = args;
    return await proj(fnMethod, `/functions/v1/${function_slug}`, fnBody, project_ref);
  }

  // ── WEBHOOKS ──────────────────────────────────────────────────────────────
  if (tool === 'supabase_list_database_webhooks') {
    return await mgmt('GET', `/projects/${project_ref}/database/webhooks`);
  }
  if (tool === 'supabase_create_database_webhook') {
    const { name, table_id, http_method = 'POST', http_url, enabled = true, events = ['INSERT', 'UPDATE', 'DELETE'] } = args;
    if (!name || !table_id || !http_url) throw new Error('name, table_id, and http_url are required');
    return await mgmt('POST', `/projects/${project_ref}/database/webhooks`, { name, table_id, http_method, http_url, enabled, function_events: events });
  }
  if (tool === 'supabase_update_database_webhook') {
    const { webhook_id, ...updates } = args;
    return await mgmt('PATCH', `/projects/${project_ref}/database/webhooks/${webhook_id}`, updates);
  }
  if (tool === 'supabase_delete_database_webhook') {
    return await mgmt('DELETE', `/projects/${project_ref}/database/webhooks/${args.webhook_id}`);
  }

  // ── REST DATA OPERATIONS ──────────────────────────────────────────────────
  if (tool === 'supabase_select') {
    const { table, columns = '*', filter, order, limit = 50, offset = 0 } = args;
    if (!table) throw new Error('table is required');
    const params = { select: columns };
    if (filter) params[filter.split('=')[0]] = filter.split('=').slice(1).join('=');
    if (order) params.order = order;
    params.limit = limit;
    params.offset = offset;
    return await restQuery('GET', table, params, null, project_ref);
  }
  if (tool === 'supabase_insert') {
    const { table, data } = args;
    if (!table || !data) throw new Error('table and data are required');
    return await restQuery('POST', table, {}, Array.isArray(data) ? data : [data], project_ref);
  }
  if (tool === 'supabase_update') {
    const { table, filter, data } = args;
    if (!table || !filter || !data) throw new Error('table, filter, and data are required');
    const params = {};
    const [filterKey, ...filterValParts] = filter.split('=');
    params[filterKey] = filterValParts.join('=');
    return await restQuery('PATCH', table, params, data, project_ref);
  }
  if (tool === 'supabase_upsert') {
    const { table, data, on_conflict } = args;
    if (!table || !data) throw new Error('table and data are required');
    const params = on_conflict ? { on_conflict } : {};
    const base = projectUrl(project_ref);
    const res = await fetch(`${base}/rest/v1/${table}${Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : ''}`, {
      method: 'POST',
      headers: { ...projectHeaders(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(Array.isArray(data) ? data : [data])
    });
    const result = await res.json();
    if (!res.ok) throw new Error(`Supabase REST ${res.status}: ${result.message || JSON.stringify(result)}`);
    return result;
  }
  if (tool === 'supabase_delete') {
    const { table, filter } = args;
    if (!table || !filter) throw new Error('table and filter are required');
    const params = {};
    const [filterKey, ...filterValParts] = filter.split('=');
    params[filterKey] = filterValParts.join('=');
    return await restQuery('DELETE', table, params, null, project_ref);
  }

  // ── DATABASE BRANCHES ─────────────────────────────────────────────────────
  if (tool === 'supabase_list_branches') {
    return await mgmt('GET', `/projects/${project_ref}/branches`);
  }
  if (tool === 'supabase_create_branch') {
    return await mgmt('POST', `/projects/${project_ref}/branches`, { branch_name: args.branch_name, git_branch: args.git_branch });
  }
  if (tool === 'supabase_delete_branch') {
    return await mgmt('DELETE', `/branches/${args.branch_id}`);
  }
  if (tool === 'supabase_get_branch') {
    return await mgmt('GET', `/branches/${args.branch_id}`);
  }

  // ── NETWORK ───────────────────────────────────────────────────────────────
  if (tool === 'supabase_list_network_bans') {
    return await mgmt('GET', `/projects/${project_ref}/network-bans`);
  }
  if (tool === 'supabase_remove_network_ban') {
    return await mgmt('DELETE', `/projects/${project_ref}/network-bans`, { ipv4: args.ip });
  }
  if (tool === 'supabase_get_network_restrictions') {
    return await mgmt('GET', `/projects/${project_ref}/network-restrictions`);
  }
  if (tool === 'supabase_update_network_restrictions') {
    return await mgmt('POST', `/projects/${project_ref}/network-restrictions/apply`, { dbAllowedCidrs: args.allowed_cidrs });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SUPER TOOLS
  // ══════════════════════════════════════════════════════════════════════════

  // SUPER: Full project overview — schema, auth, storage, edge functions, health
  if (tool === 'supabase_full_project_overview') {
    const [health, tables, users, buckets, functions, policies] = await Promise.all([
      mgmt('GET', `/projects/${project_ref}/health`).catch(() => ({ status: 'unknown' })),
      mgmt('GET', `/projects/${project_ref}/database/tables?included_schemas=public`).catch(() => []),
      proj('GET', '/auth/v1/admin/users?page=1&per_page=1', null, project_ref).catch(() => ({ total: 'unknown' })),
      proj('GET', '/storage/v1/bucket', null, project_ref).catch(() => []),
      mgmt('GET', `/projects/${project_ref}/functions`).catch(() => []),
      mgmt('GET', `/projects/${project_ref}/database/policies?included_schemas=public`).catch(() => [])
    ]);
    return {
      project_ref,
      health: health.status || health,
      tables: { count: Array.isArray(tables) ? tables.length : 'unknown', names: Array.isArray(tables) ? tables.slice(0, 10).map(t => t.name) : [] },
      auth: { total_users: users.total || (Array.isArray(users) ? users.length : 'unknown') },
      storage: { buckets: Array.isArray(buckets) ? buckets.length : 0, bucket_names: Array.isArray(buckets) ? buckets.map(b => b.name) : [] },
      edge_functions: { count: Array.isArray(functions) ? functions.length : 0, names: Array.isArray(functions) ? functions.map(f => f.slug) : [] },
      rls_policies: { count: Array.isArray(policies) ? policies.length : 0 },
      url: `https://${project_ref}.supabase.co`
    };
  }

  // SUPER: Provision a user with metadata for multi-tenant onboarding
  if (tool === 'supabase_provision_user') {
    const { email, password, role, metadata, send_invite = false } = args;
    if (!email) throw new Error('email is required');
    let user;
    if (send_invite) {
      user = await proj('POST', '/auth/v1/invite', { email, data: { role, ...metadata } }, project_ref);
    } else {
      user = await proj('POST', '/auth/v1/admin/users', { email, password, email_confirm: true, user_metadata: { role, ...metadata } }, project_ref);
    }
    return { user_id: user.id, email: user.email, created: true, invited: send_invite };
  }

  // SUPER: Audit all tables for RLS status
  if (tool === 'supabase_rls_audit') {
    const [tables, policies] = await Promise.all([
      mgmt('GET', `/projects/${project_ref}/database/tables?included_schemas=public`),
      mgmt('GET', `/projects/${project_ref}/database/policies?included_schemas=public`)
    ]);
    const policyTables = new Set((policies || []).map(p => p.table_name || p.table));
    const audit = (tables || []).map(t => ({
      table: t.name,
      rls_enabled: t.rls_enabled,
      policy_count: (policies || []).filter(p => (p.table_name || p.table) === t.name).length,
      status: t.rls_enabled ? (policyTables.has(t.name) ? 'PROTECTED' : 'ENABLED_NO_POLICIES') : 'UNPROTECTED'
    }));
    const summary = { protected: audit.filter(t => t.status === 'PROTECTED').length, unprotected: audit.filter(t => t.status === 'UNPROTECTED').length, needs_policies: audit.filter(t => t.status === 'ENABLED_NO_POLICIES').length };
    return { tables: audit, summary, recommendation: summary.unprotected > 0 ? `${summary.unprotected} tables have no RLS — enable RLS and create policies for public-facing tables` : 'All tables have RLS enabled' };
  }

  // ── BACKUPS & RECOVERY ────────────────────────────────────────────────────
  if (tool === 'supabase_list_backups') {
    const backups = await mgmt('GET', `/projects/${project_ref}/backups`);
    return (backups || []).map(b => ({
      id: b.backup_id || b.id,
      created_at: b.created_at,
      size_bytes: b.size_bytes,
      type: b.backup_type || 'manual',
      status: b.status || 'completed'
    }));
  }

  if (tool === 'supabase_restore_backup') {
    const { backup_id } = args;
    if (!backup_id) throw new Error('backup_id is required');
    const result = await mgmt('POST', `/projects/${project_ref}/backups/${backup_id}/restore`, {});
    return { project_ref, backup_id, restore_started: true, status: result.status || 'restoring' };
  }

  throw new Error(`Unknown Supabase tool: ${tool}`);

  // ── AUTH PROVIDERS & CONFIG ────────────────────────────────────────────────
  if (tool === 'supabase_get_auth_config') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    return await mgmt('GET', `/v1/projects/${project_id}/config/auth`);
  }
  if (tool === 'supabase_update_auth_provider') {
    const { project_id, provider, settings } = args;
    if (!project_id || !provider || !settings) throw new Error('project_id, provider, and settings are required');
    return await mgmt('PATCH', `/v1/projects/${project_id}/config/auth`, { external: { [provider]: settings } });
  }
  if (tool === 'supabase_enable_email_auth') {
    const { project_id, enable_signup = true, double_confirm_changes = true, enable_confirmations = false } = args;
    if (!project_id) throw new Error('project_id is required');
    return await mgmt('PATCH', `/v1/projects/${project_id}/config/auth`, {
      email: { enable_signup, double_confirm_changes, enable_confirmations }
    });
  }
  if (tool === 'supabase_enable_phone_auth') {
    const { project_id, enable_signup = true, sms_provider } = args;
    if (!project_id) throw new Error('project_id is required');
    const body = { phone: { enable_signup } };
    if (sms_provider) body.sms_provider = sms_provider;
    return await mgmt('PATCH', `/v1/projects/${project_id}/config/auth`, body);
  }
  if (tool === 'supabase_configure_saml') {
    const { project_id, metadata_url, attribute_mapping } = args;
    if (!project_id || !metadata_url) throw new Error('project_id and metadata_url are required');
    return await mgmt('POST', `/v1/projects/${project_id}/config/auth/saml`, { metadata_url, attribute_mapping });
  }
  if (tool === 'supabase_list_saml_providers') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    return await mgmt('GET', `/v1/projects/${project_id}/config/auth/saml/providers`);
  }

  // ── MFA ───────────────────────────────────────────────────────────────────
  if (tool === 'supabase_list_user_factors') {
    const { project_id, user_id } = args;
    if (!project_id || !user_id) throw new Error('project_id and user_id are required');
    return await mgmt('GET', `/v1/projects/${project_id}/auth/users/${user_id}/factors`);
  }
  if (tool === 'supabase_delete_user_factor') {
    const { project_id, user_id, factor_id } = args;
    if (!project_id || !user_id || !factor_id) throw new Error('project_id, user_id, and factor_id are required');
    return await mgmt('DELETE', `/v1/projects/${project_id}/auth/users/${user_id}/factors/${factor_id}`);
  }

  // ── REALTIME ──────────────────────────────────────────────────────────────
  if (tool === 'supabase_list_realtime_channels') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    return await mgmt('GET', `/v1/projects/${project_id}/realtime/channels`);
  }

  // ── STORAGE POLICIES ──────────────────────────────────────────────────────
  if (tool === 'supabase_get_storage_config') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    return await mgmt('GET', `/v1/projects/${project_id}/config/storage`);
  }
  if (tool === 'supabase_update_storage_config') {
    const { project_id, fileSizeLimit, allowedMimeTypes } = args;
    if (!project_id) throw new Error('project_id is required');
    const body = {};
    if (fileSizeLimit !== undefined) body.fileSizeLimit = fileSizeLimit;
    if (allowedMimeTypes) body.allowedMimeTypes = allowedMimeTypes;
    return await mgmt('PATCH', `/v1/projects/${project_id}/config/storage`, body);
  }

  // ── LOGS ──────────────────────────────────────────────────────────────────


  // ── CUSTOM DOMAINS ────────────────────────────────────────────────────────
  if (tool === 'supabase_get_custom_domain') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    return await mgmt('GET', `/v1/projects/${project_id}/custom-hostname`);
  }
  if (tool === 'supabase_set_custom_domain') {
    const { project_id, custom_hostname } = args;
    if (!project_id || !custom_hostname) throw new Error('project_id and custom_hostname are required');
    return await mgmt('POST', `/v1/projects/${project_id}/custom-hostname/initialize`, { custom_hostname });
  }
  if (tool === 'supabase_verify_custom_domain') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    return await mgmt('POST', `/v1/projects/${project_id}/custom-hostname/reverify`, {});
  }
  if (tool === 'supabase_delete_custom_domain') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    return await mgmt('DELETE', `/v1/projects/${project_id}/custom-hostname`);
  }

  // ── EDGE FUNCTIONS ADVANCED ───────────────────────────────────────────────
  if (tool === 'supabase_get_edge_function_body') {
    const { project_id, slug } = args;
    if (!project_id || !slug) throw new Error('project_id and slug are required');
    return await mgmt('GET', `/v1/projects/${project_id}/functions/${slug}/body`);
  }
  if (tool === 'supabase_get_edge_function_secrets') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    return await mgmt('GET', `/v1/projects/${project_id}/secrets`);
  }
  if (tool === 'supabase_set_edge_function_secrets') {
    const { project_id, secrets } = args;
    if (!project_id || !secrets) throw new Error('project_id and secrets array [{name, value}] are required');
    return await mgmt('POST', `/v1/projects/${project_id}/secrets`, secrets);
  }
  if (tool === 'supabase_delete_edge_function_secrets') {
    const { project_id, secret_names } = args;
    if (!project_id || !secret_names) throw new Error('project_id and secret_names array are required');
    return await mgmt('DELETE', `/v1/projects/${project_id}/secrets`, secret_names);
  }

  // ── POSTGRES CONFIG ───────────────────────────────────────────────────────
  if (tool === 'supabase_get_postgres_config') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    return await mgmt('GET', `/v1/projects/${project_id}/config/database/postgres`);
  }
  if (tool === 'supabase_update_postgres_config') {
    const { project_id, ...config } = args;
    if (!project_id) throw new Error('project_id is required');
    return await mgmt('PUT', `/v1/projects/${project_id}/config/database/postgres`, config);
  }
  if (tool === 'supabase_get_pooler_config') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    return await mgmt('GET', `/v1/projects/${project_id}/config/database/pgbouncer`);
  }
  if (tool === 'supabase_update_pooler_config') {
    const { project_id, pool_mode, default_pool_size, max_client_conn } = args;
    if (!project_id) throw new Error('project_id is required');
    const body = {};
    if (pool_mode) body.pool_mode = pool_mode;
    if (default_pool_size) body.default_pool_size = default_pool_size;
    if (max_client_conn) body.max_client_conn = max_client_conn;
    return await mgmt('PUT', `/v1/projects/${project_id}/config/database/pgbouncer`, body);
  }

  // ── SSL ENFORCEMENT ───────────────────────────────────────────────────────
  if (tool === 'supabase_get_ssl_enforcement') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    return await mgmt('GET', `/v1/projects/${project_id}/config/database/ssl-enforcement`);
  }
  if (tool === 'supabase_update_ssl_enforcement') {
    const { project_id, enforced = true } = args;
    if (!project_id) throw new Error('project_id is required');
    return await mgmt('PUT', `/v1/projects/${project_id}/config/database/ssl-enforcement`, { database: { enforced } });
  }

  // ── SUPER TOOL: Project security audit ────────────────────────────────────
  if (tool === 'supabase_security_audit') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    const [authConfig, networkRestrictions, sslEnforcement, apiKeys, networkBans, customDomain] = await Promise.all([
      mgmt('GET', `/v1/projects/${project_id}/config/auth`).catch(() => null),
      mgmt('GET', `/v1/projects/${project_id}/network-restrictions`).catch(() => null),
      mgmt('GET', `/v1/projects/${project_id}/config/database/ssl-enforcement`).catch(() => null),
      mgmt('GET', `/v1/projects/${project_id}/api-keys`).catch(() => null),
      mgmt('GET', `/v1/projects/${project_id}/network-bans`).catch(() => null),
      mgmt('GET', `/v1/projects/${project_id}/custom-hostname`).catch(() => null)
    ]);
    return {
      project_id,
      auth: {
        email_confirmations: authConfig?.email?.enable_confirmations,
        mfa_enabled: authConfig?.mfa?.totp?.enroll_enabled,
        captcha_enabled: authConfig?.security?.captcha?.enabled
      },
      database: {
        ssl_enforced: sslEnforcement?.database?.enforced
      },
      network_restrictions: networkRestrictions?.allowed_cidrs?.length > 0 ? networkRestrictions.allowed_cidrs : 'unrestricted',
      network_bans_count: networkBans?.banned_ipv4_addresses?.length || 0,
      custom_domain: customDomain?.custom_hostname || null,
      generated_at: new Date().toISOString()
    };
  }

  // ── SUPER TOOL: Full project status ───────────────────────────────────────
  if (tool === 'supabase_project_status') {
    const { project_id } = args;
    if (!project_id) throw new Error('project_id is required');
    const [project, usage, functions, buckets, extensions] = await Promise.all([
      mgmt('GET', `/v1/projects/${project_id}`),
      mgmt('GET', `/v1/projects/${project_id}/usage`).catch(() => null),
      mgmt('GET', `/v1/projects/${project_id}/functions`).catch(() => ({ result: [] })),
      mgmt('GET', `/v1/projects/${project_id}/storage/buckets`).catch(() => []),
      mgmt('GET', `/v1/projects/${project_id}/database/extensions`).catch(() => [])
    ]);
    const funcs = Array.isArray(functions) ? functions : (functions.result || []);
    const bkts = Array.isArray(buckets) ? buckets : [];
    const exts = Array.isArray(extensions) ? extensions.filter(e => e.installed_version) : [];
    return {
      project: { id: project.id, name: project.name, region: project.region, status: project.status, created_at: project.created_at },
      edge_functions: funcs.length,
      storage_buckets: bkts.length,
      installed_extensions: exts.map(e => e.name),
      usage,
      generated_at: new Date().toISOString()
    };
  }

  throw new Error(`Unknown Supabase tool: ${tool}`);
}

export default { execute };
