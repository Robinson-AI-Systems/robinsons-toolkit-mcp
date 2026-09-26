/**
 * Cloudflare Handler — 127 tools
 * Workers (deploy/secrets/versions/analytics/logs), KV, R2, D1, Queues,
 * Durable Objects, Workers AI, Hyperdrive, Stream, Pages, DNS, Zones,
 * Page Rules, WAF/Firewall, Cache, Zero Trust Access, and Super Tools.
 */

const BASE = 'https://api.cloudflare.com/client/v4';

function headers() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN not set in .env');
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const ACCT = () => process.env.CLOUDFLARE_ACCOUNT_ID;

async function cf(method, path, body, { envelope = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: headers(),
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(`Cloudflare ${res.status}: ${data.errors?.map(e => e.message).join(', ') || res.statusText || 'Request failed'}`);
  }
  return envelope ? data : data.result !== undefined ? data.result : data;
}

async function execute(tool, args) {
  const { zone_id, namespace_id, bucket_name, worker_name } = args;

  // ── ZONES ─────────────────────────────────────────────────────────────────
  if (tool === 'cf_list_zones') {
    return await cf('GET', `/zones?per_page=${args.per_page || 20}&name=${args.name || ''}&status=${args.status || ''}`);
  }
  if (tool === 'cf_get_zone') { return await cf('GET', `/zones/${zone_id}`); }
  if (tool === 'cf_create_zone') {
    return await cf('POST', '/zones', { name: args.name, account: { id: ACCT() }, jump_start: args.jump_start !== false });
  }
  if (tool === 'cf_delete_zone') { return await cf('DELETE', `/zones/${zone_id}`); }
  if (tool === 'cf_purge_cache') {
    const body = args.purge_everything ? { purge_everything: true } : { files: args.files };
    return await cf('POST', `/zones/${zone_id}/purge_cache`, body);
  }
  if (tool === 'cf_get_zone_settings') { return await cf('GET', `/zones/${zone_id}/settings`); }
  if (tool === 'cf_update_zone_setting') {
    return await cf('PATCH', `/zones/${zone_id}/settings/${args.setting_id}`, { value: args.value });
  }
  if (tool === 'cf_get_analytics') {
    return await cf('GET', `/zones/${zone_id}/analytics/dashboard?since=${args.since || '-1440'}&until=${args.until || '0'}&continuous=false`);
  }

  // ── DNS RECORDS ───────────────────────────────────────────────────────────
  if (tool === 'cf_list_dns_records') {
    let path = `/zones/${zone_id}/dns_records?per_page=${args.per_page || 100}`;
    if (args.type) path += `&type=${args.type}`;
    if (args.name) path += `&name=${args.name}`;
    return await cf('GET', path);
  }
  if (tool === 'cf_get_dns_record') { return await cf('GET', `/zones/${zone_id}/dns_records/${args.record_id}`); }
  if (tool === 'cf_create_dns_record') {
    const { type, name, content, ttl = 1, proxied = false, priority } = args;
    if (!type || !name || !content) throw new Error('type, name, and content are required');
    const body = { type, name, content, ttl, proxied };
    if (priority !== undefined) body.priority = priority;
    return await cf('POST', `/zones/${zone_id}/dns_records`, body);
  }
  if (tool === 'cf_update_dns_record') {
    const { record_id, type, name, content, ttl, proxied } = args;
    const body = {};
    if (type) body.type = type; if (name) body.name = name; if (content) body.content = content;
    if (ttl !== undefined) body.ttl = ttl; if (proxied !== undefined) body.proxied = proxied;
    return await cf('PATCH', `/zones/${zone_id}/dns_records/${record_id}`, body);
  }
  if (tool === 'cf_delete_dns_record') { return await cf('DELETE', `/zones/${zone_id}/dns_records/${args.record_id}`); }
  if (tool === 'cf_import_dns_records') {
    const { bind_zone_file, proxied = false } = args;
    if (!bind_zone_file) throw new Error('bind_zone_file (BIND format text) required');
    const form = new FormData();
    form.append('file', new Blob([bind_zone_file], { type: 'text/plain' }), 'zone.txt');
    form.append('proxied', String(proxied));
    const res = await fetch(`${BASE}/zones/${zone_id}/dns_records/import`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
      body: form
    });
    const data = await res.json();
    if (!data.success) throw new Error(`DNS import failed: ${data.errors?.map(e => e.message).join(', ')}`);
    return data.result;
  }
  if (tool === 'cf_export_dns_records') {
    const res = await fetch(`${BASE}/zones/${zone_id}/dns_records/export`, { headers: headers() });
    if (!res.ok) throw new Error(`DNS export failed: ${res.status}`);
    return { zone_file: await res.text() };
  }

  // ── WORKERS ───────────────────────────────────────────────────────────────
  if (tool === 'cf_list_workers') {
    return await cf('GET', `/accounts/${ACCT()}/workers/scripts`);
  }
  if (tool === 'cf_get_worker') {
    return await cf('GET', `/accounts/${ACCT()}/workers/scripts/${worker_name}`);
  }
  if (tool === 'cf_deploy_worker') {
    const { name, script, compatibility_date = '2024-01-01', bindings } = args;
    if (!name || !script) throw new Error('name and script (JS source code) are required');
    // Workers deployment uses multipart form data
    const formData = new FormData();
    formData.append('worker.js', new Blob([script], { type: 'application/javascript' }), 'worker.js');
    const metadata = { main_module: 'worker.js', compatibility_date, bindings: bindings || [] };
    formData.append('metadata', JSON.stringify(metadata));
    const res = await fetch(`${BASE}/accounts/${ACCT()}/workers/scripts/${name}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
      body: formData
    });
    const data = await res.json();
    if (!data.success) throw new Error(`Worker deploy failed: ${data.errors?.map(e => e.message).join(', ')}`);
    return data.result;
  }
  if (tool === 'cf_delete_worker') {
    return await cf('DELETE', `/accounts/${ACCT()}/workers/scripts/${worker_name}`);
  }
  if (tool === 'cf_list_worker_routes') { return await cf('GET', `/zones/${zone_id}/workers/routes`); }
  if (tool === 'cf_create_worker_route') {
    return await cf('POST', `/zones/${zone_id}/workers/routes`, { pattern: args.pattern, script: args.script_name });
  }
  if (tool === 'cf_delete_worker_route') { return await cf('DELETE', `/zones/${zone_id}/workers/routes/${args.route_id}`); }
  if (tool === 'cf_list_worker_cron_triggers') {
    return await cf('GET', `/accounts/${ACCT()}/workers/scripts/${worker_name}/schedules`);
  }
  if (tool === 'cf_update_worker_cron_triggers') {
    return await cf('PUT', `/accounts/${ACCT()}/workers/scripts/${worker_name}/schedules`, args.schedules || []);
  }
  if (tool === 'cf_get_worker_subdomain') { return await cf('GET', `/accounts/${ACCT()}/workers/subdomain`); }

  // ── KV NAMESPACES ─────────────────────────────────────────────────────────
  if (tool === 'cf_list_kv_namespaces') {
    return await cf('GET', `/accounts/${ACCT()}/storage/kv/namespaces?per_page=${args.per_page || 20}`);
  }
  if (tool === 'cf_create_kv_namespace') {
    return await cf('POST', `/accounts/${ACCT()}/storage/kv/namespaces`, { title: args.title });
  }
  if (tool === 'cf_delete_kv_namespace') {
    return await cf('DELETE', `/accounts/${ACCT()}/storage/kv/namespaces/${namespace_id}`);
  }
  if (tool === 'cf_rename_kv_namespace') {
    return await cf('PUT', `/accounts/${ACCT()}/storage/kv/namespaces/${namespace_id}`, { title: args.title });
  }

  // ── KV VALUES ─────────────────────────────────────────────────────────────
  if (tool === 'cf_kv_get') {
    const res = await fetch(`${BASE}/accounts/${ACCT()}/storage/kv/namespaces/${namespace_id}/values/${encodeURIComponent(args.key)}`, { headers: headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`KV get failed: ${res.status}`);
    return await res.text();
  }
  if (tool === 'cf_kv_put') {
    const url = `${BASE}/accounts/${ACCT()}/storage/kv/namespaces/${namespace_id}/values/${encodeURIComponent(args.key)}`;
    let body = args.value;
    const headers_obj = { 'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
    if (args.expiration) headers_obj['cf-expiration'] = args.expiration;
    if (args.expiration_ttl) headers_obj['cf-expiration-ttl'] = args.expiration_ttl;
    if (args.metadata) {
      const form = new FormData();
      form.append('value', args.value); form.append('metadata', JSON.stringify(args.metadata));
      const res = await fetch(url, { method: 'PUT', headers: headers_obj, body: form });
      return res.ok ? { success: true } : { success: false };
    }
    const res = await fetch(url, { method: 'PUT', headers: { ...headers_obj, 'Content-Type': 'text/plain' }, body });
    return res.ok ? { success: true } : { success: false };
  }
  if (tool === 'cf_kv_delete') {
    return await cf('DELETE', `/accounts/${ACCT()}/storage/kv/namespaces/${namespace_id}/values/${encodeURIComponent(args.key)}`);
  }
  if (tool === 'cf_kv_list_keys') {
    let path = `/accounts/${ACCT()}/storage/kv/namespaces/${namespace_id}/keys?limit=${args.limit || 100}`;
    if (args.prefix) path += `&prefix=${encodeURIComponent(args.prefix)}`;
    if (args.cursor) path += `&cursor=${args.cursor}`;
    return await cf('GET', path);
  }
  if (tool === 'cf_kv_bulk_put') {
    // items: array of { key, value, expiration_ttl?, metadata? }
    return await cf('PUT', `/accounts/${ACCT()}/storage/kv/namespaces/${namespace_id}/bulk`, args.items);
  }
  if (tool === 'cf_kv_bulk_delete') {
    return await cf('DELETE', `/accounts/${ACCT()}/storage/kv/namespaces/${namespace_id}/bulk`, args.keys);
  }

  // ── R2 BUCKETS ────────────────────────────────────────────────────────────
  if (tool === 'cf_list_r2_buckets') {
    return await cf('GET', `/accounts/${ACCT()}/r2/buckets?per_page=${args.per_page || 20}`);
  }
  if (tool === 'cf_get_r2_bucket') { return await cf('GET', `/accounts/${ACCT()}/r2/buckets/${bucket_name}`); }
  if (tool === 'cf_create_r2_bucket') {
    return await cf('POST', `/accounts/${ACCT()}/r2/buckets`, { name: args.name, locationHint: args.location_hint });
  }
  if (tool === 'cf_delete_r2_bucket') { return await cf('DELETE', `/accounts/${ACCT()}/r2/buckets/${bucket_name}`); }
  if (tool === 'cf_get_r2_bucket_cors') { return await cf('GET', `/accounts/${ACCT()}/r2/buckets/${bucket_name}/cors`); }
  if (tool === 'cf_put_r2_bucket_cors') {
    return await cf('PUT', `/accounts/${ACCT()}/r2/buckets/${bucket_name}/cors`, { rules: args.rules });
  }

  // ── PAGES ─────────────────────────────────────────────────────────────────
  if (tool === 'cf_list_pages_projects') {
    return await cf('GET', `/accounts/${ACCT()}/pages/projects?per_page=${args.per_page || 20}`);
  }
  if (tool === 'cf_get_pages_project') {
    return await cf('GET', `/accounts/${ACCT()}/pages/projects/${args.project_name}`);
  }
  if (tool === 'cf_list_pages_deployments') {
    return await cf('GET', `/accounts/${ACCT()}/pages/projects/${args.project_name}/deployments?per_page=${args.per_page || 10}`);
  }
  if (tool === 'cf_get_pages_deployment') {
    return await cf('GET', `/accounts/${ACCT()}/pages/projects/${args.project_name}/deployments/${args.deployment_id}`);
  }
  if (tool === 'cf_retry_pages_deployment') {
    return await cf('POST', `/accounts/${ACCT()}/pages/projects/${args.project_name}/deployments/${args.deployment_id}/retry`, {});
  }
  if (tool === 'cf_rollback_pages_deployment') {
    return await cf('POST', `/accounts/${ACCT()}/pages/projects/${args.project_name}/deployments/${args.deployment_id}/rollback`, {});
  }
  if (tool === 'cf_list_pages_domains') {
    return await cf('GET', `/accounts/${ACCT()}/pages/projects/${args.project_name}/domains`);
  }
  if (tool === 'cf_add_pages_domain') {
    return await cf('POST', `/accounts/${ACCT()}/pages/projects/${args.project_name}/domains`, { name: args.domain });
  }

  // ── FIREWALL / WAF ────────────────────────────────────────────────────────
  if (tool === 'cf_list_firewall_rules') {
    return await cf('GET', `/zones/${zone_id}/firewall/rules?per_page=${args.per_page || 20}`);
  }
  if (tool === 'cf_create_firewall_rule') {
    const { action, expression, description } = args;
    const filter = await cf('POST', `/zones/${zone_id}/filters`, [{ expression, description }]);
    return await cf('POST', `/zones/${zone_id}/firewall/rules`, [{ action, filter: { id: filter[0].id }, description }]);
  }
  if (tool === 'cf_delete_firewall_rule') {
    return await cf('DELETE', `/zones/${zone_id}/firewall/rules/${args.rule_id}`);
  }
  if (tool === 'cf_list_rate_limits') {
    return await cf('GET', `/zones/${zone_id}/rate_limits?per_page=${args.per_page || 20}`);
  }

  // ── ACCOUNT ───────────────────────────────────────────────────────────────
  if (tool === 'cf_get_account') { return await cf('GET', `/accounts/${ACCT()}`); }
  if (tool === 'cf_list_account_members') { return await cf('GET', `/accounts/${ACCT()}/members?per_page=${args.per_page || 20}`); }

  // ── D1 DATABASE ───────────────────────────────────────────────────────────
  if (tool === 'cf_list_d1_databases') { return await cf('GET', `/accounts/${ACCT()}/d1/database?per_page=${args.per_page || 20}`); }
  if (tool === 'cf_get_d1_database') { return await cf('GET', `/accounts/${ACCT()}/d1/database/${args.database_id}`); }
  if (tool === 'cf_create_d1_database') { return await cf('POST', `/accounts/${ACCT()}/d1/database`, { name: args.name, primary_location_hint: args.primary_location_hint }); }
  if (tool === 'cf_delete_d1_database') { return await cf('DELETE', `/accounts/${ACCT()}/d1/database/${args.database_id}`); }
  if (tool === 'cf_query_d1') {
    const { database_id, sql, params = [] } = args;
    if (!database_id || !sql) throw new Error('database_id and sql required');
    return await cf('POST', `/accounts/${ACCT()}/d1/database/${database_id}/query`, { sql, params });
  }
  if (tool === 'cf_d1_raw_query') {
    return await cf('POST', `/accounts/${ACCT()}/d1/database/${args.database_id}/raw`, { sql: args.sql, params: args.params || [] });
  }
  if (tool === 'cf_d1_list_tables') {
    return await cf('POST', `/accounts/${ACCT()}/d1/database/${args.database_id}/query`, { sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'" });
  }
  if (tool === 'cf_d1_table_schema') {
    return await cf('POST', `/accounts/${ACCT()}/d1/database/${args.database_id}/query`, { sql: `PRAGMA table_info(${args.table_name})` });
  }
  if (tool === 'cf_d1_export') {
    return await cf('POST', `/accounts/${ACCT()}/d1/database/${args.database_id}/export`, { output_format: args.output_format || 'polling', dump_options: args.dump_options });
  }
  if (tool === 'cf_d1_import') {
    return await cf('POST', `/accounts/${ACCT()}/d1/database/${args.database_id}/import`, { action: args.action || 'init', etag: args.etag, filename: args.filename });
  }

  // ── WORKERS AI ────────────────────────────────────────────────────────────
  if (tool === 'cf_run_ai_model') {
    return await cf('POST', `/accounts/${ACCT()}/ai/run/${args.model}`, args.inputs || args);
  }
  if (tool === 'cf_list_ai_models') {
    return await cf('GET', `/accounts/${ACCT()}/ai/models/search?per_page=${args.per_page || 50}${args.task?`&task=${args.task}`:''}`);
  }
  if (tool === 'cf_text_generation') {
    const { prompt, model = '@cf/meta/llama-3.1-8b-instruct', max_tokens = 512, system } = args;
    if (!prompt) throw new Error('prompt required');
    const messages = system ? [{ role: 'system', content: system }, { role: 'user', content: prompt }] : [{ role: 'user', content: prompt }];
    return await cf('POST', `/accounts/${ACCT()}/ai/run/${model}`, { messages, max_tokens });
  }
  if (tool === 'cf_text_embedding') {
    return await cf('POST', `/accounts/${ACCT()}/ai/run/${args.model || '@cf/baai/bge-base-en-v1.5'}`, { text: Array.isArray(args.text) ? args.text : [args.text] });
  }
  if (tool === 'cf_image_classification') {
    const { image_base64, model = '@cf/microsoft/resnet-50' } = args;
    return await cf('POST', `/accounts/${ACCT()}/ai/run/${model}`, { image: Array.from(Buffer.from(image_base64, 'base64')) });
  }
  if (tool === 'cf_text_to_image') {
    const { prompt, model = '@cf/stabilityai/stable-diffusion-xl-base-1.0', num_steps = 20 } = args;
    const res = await fetch(`${BASE}/accounts/${ACCT()}/ai/run/${model}`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ prompt, num_steps })
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(`Cloudflare AI: ${e.errors?.[0]?.message || res.status}`); }
    const buf = await res.arrayBuffer();
    return { image_base64: Buffer.from(buf).toString('base64'), size_bytes: buf.byteLength, format: 'png' };
  }
  if (tool === 'cf_speech_to_text') {
    const { audio_base64, model = '@cf/openai/whisper' } = args;
    return await cf('POST', `/accounts/${ACCT()}/ai/run/${model}`, { audio: Array.from(Buffer.from(audio_base64, 'base64')) });
  }
  if (tool === 'cf_translation') {
    const { text, source_lang = 'english', target_lang, model = '@cf/meta/m2m100-1.2b' } = args;
    return await cf('POST', `/accounts/${ACCT()}/ai/run/${model}`, { text, source_lang, target_lang });
  }
  if (tool === 'cf_summarization') {
    const { input_text, max_length = 1024, model = '@cf/facebook/bart-large-cnn' } = args;
    return await cf('POST', `/accounts/${ACCT()}/ai/run/${model}`, { input_text, max_length });
  }
  if (tool === 'cf_get_ai_finetunes') {
    return await cf('GET', `/accounts/${ACCT()}/ai/finetunes`);
  }

  // ── QUEUES ────────────────────────────────────────────────────────────────
  if (tool === 'cf_list_queues') { return await cf('GET', `/accounts/${ACCT()}/queues?per_page=${args.per_page||20}`); }
  if (tool === 'cf_create_queue') { return await cf('POST', `/accounts/${ACCT()}/queues`, { queue_name: args.queue_name }); }
  if (tool === 'cf_get_queue') { return await cf('GET', `/accounts/${ACCT()}/queues/${args.queue_id}`); }
  if (tool === 'cf_delete_queue') { return await cf('DELETE', `/accounts/${ACCT()}/queues/${args.queue_id}`); }
  if (tool === 'cf_update_queue') { return await cf('PATCH', `/accounts/${ACCT()}/queues/${args.queue_id}`, { queue_name: args.queue_name, settings: args.settings }); }
  if (tool === 'cf_send_queue_message') {
    return await cf('POST', `/accounts/${ACCT()}/queues/${args.queue_id}/messages`, { body: args.body, content_type: args.content_type || 'json', delay_seconds: args.delay_seconds });
  }
  if (tool === 'cf_send_queue_messages_batch') {
    return await cf('POST', `/accounts/${ACCT()}/queues/${args.queue_id}/messages/batch`, { messages: args.messages });
  }
  if (tool === 'cf_purge_queue') { return await cf('POST', `/accounts/${ACCT()}/queues/${args.queue_id}/purge`, {}); }
  if (tool === 'cf_list_queue_consumers') { return await cf('GET', `/accounts/${ACCT()}/queues/${args.queue_id}/consumers`); }
  if (tool === 'cf_create_queue_consumer') {
    return await cf('POST', `/accounts/${ACCT()}/queues/${args.queue_id}/consumers`, { script_name: args.script_name, settings: args.settings, type: args.type || 'worker' });
  }
  if (tool === 'cf_delete_queue_consumer') {
    return await cf('DELETE', `/accounts/${ACCT()}/queues/${args.queue_id}/consumers/${args.consumer_id}`);
  }

  // ── DURABLE OBJECTS ───────────────────────────────────────────────────────
  if (tool === 'cf_list_durable_object_namespaces') { return await cf('GET', `/accounts/${ACCT()}/workers/durable_objects/namespaces`); }
  if (tool === 'cf_get_durable_object_namespace') { return await cf('GET', `/accounts/${ACCT()}/workers/durable_objects/namespaces/${args.namespace_id}`); }
  if (tool === 'cf_list_durable_objects') {
    return await cf('GET', `/accounts/${ACCT()}/workers/durable_objects/namespaces/${args.namespace_id}/objects?limit=${args.limit||20}`);
  }

  // ── WORKERS DEEPER (secrets, versions, deployments, analytics) ────────────
  if (tool === 'cf_list_worker_secrets') {
    return await cf('GET', `/accounts/${ACCT()}/workers/scripts/${worker_name}/secrets`);
  }
  if (tool === 'cf_put_worker_secret') {
    return await cf('PUT', `/accounts/${ACCT()}/workers/scripts/${worker_name}/secrets`, { name: args.name, text: args.text, type: args.type || 'secret_text' });
  }
  if (tool === 'cf_delete_worker_secret') {
    return await cf('DELETE', `/accounts/${ACCT()}/workers/scripts/${worker_name}/secrets/${args.name}`);
  }
  if (tool === 'cf_list_worker_versions') {
    return await cf('GET', `/accounts/${ACCT()}/workers/scripts/${worker_name}/versions?per_page=${args.per_page||10}`);
  }
  if (tool === 'cf_get_worker_version') {
    return await cf('GET', `/accounts/${ACCT()}/workers/scripts/${worker_name}/versions/${args.version_id}`);
  }
  if (tool === 'cf_list_worker_deployments') {
    return await cf('GET', `/accounts/${ACCT()}/workers/scripts/${worker_name}/deployments`);
  }
  if (tool === 'cf_create_worker_deployment') {
    return await cf('POST', `/accounts/${ACCT()}/workers/scripts/${worker_name}/deployments`, { strategy: args.strategy || 'percentage', versions: args.versions });
  }
  if (tool === 'cf_get_worker_settings') {
    return await cf('GET', `/accounts/${ACCT()}/workers/scripts/${worker_name}/script-settings`);
  }
  if (tool === 'cf_update_worker_settings') {
    return await cf('PATCH', `/accounts/${ACCT()}/workers/scripts/${worker_name}/script-settings`, args.settings);
  }
  if (tool === 'cf_list_worker_tail_logs') {
    return await cf('GET', `/accounts/${ACCT()}/workers/scripts/${worker_name}/tails`);
  }
  if (tool === 'cf_get_worker_analytics') {
    return await cf('GET', `/accounts/${ACCT()}/workers/scripts/${worker_name}/analytics`);
  }
  if (tool === 'cf_list_worker_domains') {
    return await cf('GET', `/accounts/${ACCT()}/workers/domains`);
  }
  if (tool === 'cf_attach_worker_domain') {
    return await cf('PUT', `/accounts/${ACCT()}/workers/domains`, { environment: 'production', hostname: args.hostname, service: args.service, zone_id: args.zone_id });
  }

  // ── ZERO TRUST / ACCESS ───────────────────────────────────────────────────
  if (tool === 'cf_list_access_applications') {
    return await cf('GET', `/accounts/${ACCT()}/access/apps?per_page=${args.per_page||20}`);
  }
  if (tool === 'cf_get_access_application') {
    return await cf('GET', `/accounts/${ACCT()}/access/apps/${args.app_id}`);
  }
  if (tool === 'cf_create_access_application') {
    return await cf('POST', `/accounts/${ACCT()}/access/apps`, { name: args.name, domain: args.domain, type: args.type || 'self_hosted', session_duration: args.session_duration || '24h' });
  }
  if (tool === 'cf_update_access_application') {
    return await cf('PUT', `/accounts/${ACCT()}/access/apps/${args.app_id}`, args.config || {});
  }
  if (tool === 'cf_delete_access_application') {
    return await cf('DELETE', `/accounts/${ACCT()}/access/apps/${args.app_id}`);
  }
  if (tool === 'cf_list_access_policies') {
    return await cf('GET', `/accounts/${ACCT()}/access/apps/${args.app_id}/policies`);
  }
  if (tool === 'cf_create_access_policy') {
    return await cf('POST', `/accounts/${ACCT()}/access/apps/${args.app_id}/policies`, { name: args.name, decision: args.decision || 'allow', include: args.include || [], exclude: args.exclude, require: args.require });
  }
  if (tool === 'cf_delete_access_policy') {
    return await cf('DELETE', `/accounts/${ACCT()}/access/apps/${args.app_id}/policies/${args.policy_id}`);
  }
  if (tool === 'cf_list_access_groups') {
    return await cf('GET', `/accounts/${ACCT()}/access/groups?per_page=${args.per_page||20}`);
  }
  if (tool === 'cf_create_access_group') {
    return await cf('POST', `/accounts/${ACCT()}/access/groups`, { name: args.name, include: args.include || [], exclude: args.exclude, require: args.require });
  }

  // ── HYPERDRIVE ────────────────────────────────────────────────────────────
  if (tool === 'cf_list_hyperdrive_configs') { return await cf('GET', `/accounts/${ACCT()}/hyperdrive/configs`); }
  if (tool === 'cf_get_hyperdrive_config') { return await cf('GET', `/accounts/${ACCT()}/hyperdrive/configs/${args.hyperdrive_id}`); }
  if (tool === 'cf_create_hyperdrive_config') {
    return await cf('POST', `/accounts/${ACCT()}/hyperdrive/configs`, { name: args.name, origin: args.origin, caching: args.caching });
  }
  if (tool === 'cf_delete_hyperdrive_config') { return await cf('DELETE', `/accounts/${ACCT()}/hyperdrive/configs/${args.hyperdrive_id}`); }

  // ── STREAM (video) ────────────────────────────────────────────────────────
  if (tool === 'cf_list_stream_videos') { return await cf('GET', `/accounts/${ACCT()}/stream?limit=${args.limit||20}`); }
  if (tool === 'cf_get_stream_video') { return await cf('GET', `/accounts/${ACCT()}/stream/${args.video_id}`); }
  if (tool === 'cf_delete_stream_video') { return await cf('DELETE', `/accounts/${ACCT()}/stream/${args.video_id}`); }
  if (tool === 'cf_create_stream_url_upload') {
    return await cf('POST', `/accounts/${ACCT()}/stream/copy`, { url: args.url, meta: args.meta });
  }
  if (tool === 'cf_create_stream_direct_upload') {
    return await cf('POST', `/accounts/${ACCT()}/stream/direct_upload`, { maxDurationSeconds: args.max_duration_seconds || 3600, expiry: args.expiry, meta: args.meta });
  }

  // ── PAGES (DEEPER) ────────────────────────────────────────────────────────
  if (tool === 'cf_create_pages_project') {
    return await cf('POST', `/accounts/${ACCT()}/pages/projects`, { name: args.name, production_branch: args.production_branch || 'main', source: args.source, build_config: args.build_config });
  }
  if (tool === 'cf_delete_pages_project') { return await cf('DELETE', `/accounts/${ACCT()}/pages/projects/${args.project_name}`); }
  if (tool === 'cf_remove_pages_domain') { return await cf('DELETE', `/accounts/${ACCT()}/pages/projects/${args.project_name}/domains/${args.domain}`); }
  if (tool === 'cf_create_pages_deployment') {
    return await cf('POST', `/accounts/${ACCT()}/pages/projects/${args.project_name}/deployments`, args.body || {});
  }

  // ── CACHE (DEEPER) ────────────────────────────────────────────────────────
  if (tool === 'cf_purge_cache_by_tag') {
    return await cf('POST', `/zones/${zone_id}/purge_cache`, { tags: args.tags });
  }
  if (tool === 'cf_purge_cache_by_host') {
    return await cf('POST', `/zones/${zone_id}/purge_cache`, { hosts: args.hosts });
  }
  if (tool === 'cf_purge_cache_by_prefix') {
    return await cf('POST', `/zones/${zone_id}/purge_cache`, { prefixes: args.prefixes });
  }

  // ── PAGE RULES ────────────────────────────────────────────────────────────
  if (tool === 'cf_list_page_rules') {
    return await cf('GET', `/zones/${zone_id}/pagerules?per_page=${args.per_page||20}`);
  }
  if (tool === 'cf_create_page_rule') {
    return await cf('POST', `/zones/${zone_id}/pagerules`, { targets: args.targets, actions: args.actions, priority: args.priority || 1, status: args.status || 'active' });
  }
  if (tool === 'cf_update_page_rule') {
    return await cf('PUT', `/zones/${zone_id}/pagerules/${args.rule_id}`, args.config);
  }
  if (tool === 'cf_delete_page_rule') {
    return await cf('DELETE', `/zones/${zone_id}/pagerules/${args.rule_id}`);
  }

  // ── R2 (DEEPER) ───────────────────────────────────────────────────────────
  if (tool === 'cf_get_r2_bucket_lifecycle') { return await cf('GET', `/accounts/${ACCT()}/r2/buckets/${bucket_name}/lifecycle`); }
  if (tool === 'cf_put_r2_bucket_lifecycle') {
    return await cf('PUT', `/accounts/${ACCT()}/r2/buckets/${bucket_name}/lifecycle`, { rules: args.rules });
  }
  if (tool === 'cf_get_r2_bucket_usage') { return await cf('GET', `/accounts/${ACCT()}/r2/buckets/${bucket_name}/usage`); }
  if (tool === 'cf_create_r2_api_token') {
    return await cf('POST', `/accounts/${ACCT()}/r2/api_tokens`, { name: args.name, permission: args.permission || 'object-read-only', bucket: args.bucket });
  }

  // ── KV (DEEPER) ───────────────────────────────────────────────────────────
  if (tool === 'cf_kv_get_metadata') {
    return await cf('GET', `/accounts/${ACCT()}/storage/kv/namespaces/${namespace_id}/metadata/${encodeURIComponent(args.key)}`);
  }
  if (tool === 'cf_kv_get_with_metadata') {
    const v = await fetch(`${BASE}/accounts/${ACCT()}/storage/kv/namespaces/${namespace_id}/values/${encodeURIComponent(args.key)}`, { headers: headers() });
    if (v.status === 404) return null;
    if (!v.ok) throw new Error(`KV get failed: ${v.status}`);
    const value = await v.text();
    const meta = await cf('GET', `/accounts/${ACCT()}/storage/kv/namespaces/${namespace_id}/metadata/${encodeURIComponent(args.key)}`).catch(() => null);
    return { value, metadata: meta };
  }

  // ── ANALYTICS ENGINE / GRAPHQL ANALYTICS ──────────────────────────────────
  if (tool === 'cf_query_analytics') {
    return await cf('GET', `/zones/${zone_id}/analytics/colos?since=${args.since||'-1440'}&until=${args.until||'0'}`);
  }
  if (tool === 'cf_get_workers_analytics') {
    return await cf('GET', `/accounts/${ACCT()}/analytics/dashboard?since=${args.since||'-1440'}&until=${args.until||'0'}`);
  }

  // ── LOAD BALANCING ────────────────────────────────────────────────────────
  if (tool === 'cf_list_load_balancers') {
    return await cf('GET', `/zones/${zone_id}/load_balancers`);
  }
  if (tool === 'cf_list_load_balancer_pools') {
    return await cf('GET', `/accounts/${ACCT()}/load_balancers/pools`);
  }
  if (tool === 'cf_list_load_balancer_monitors') {
    return await cf('GET', `/accounts/${ACCT()}/load_balancers/monitors`);
  }

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║                         SUPER TOOLS                                  ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  // SUPER TOOL: cf_deploy_full_worker
  // Deploy worker + set bindings + create route + add secrets in one call
  if (tool === 'cf_deploy_full_worker') {
    const { name, script, route_pattern, route_zone_id, bindings = [], secrets = {}, compatibility_date = '2024-01-01' } = args;
    if (!name || !script) throw new Error('name and script required');
    // 1. Deploy script
    const form = new FormData();
    form.append('worker.js', new Blob([script], { type: 'application/javascript' }), 'worker.js');
    form.append('metadata', JSON.stringify({ main_module: 'worker.js', compatibility_date, bindings }));
    const dep = await fetch(`${BASE}/accounts/${ACCT()}/workers/scripts/${name}`, { method: 'PUT', headers: { 'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, body: form });
    const depData = await dep.json();
    if (!depData.success) throw new Error(`Deploy failed: ${depData.errors?.map(e=>e.message).join(', ')}`);
    // 2. Set secrets
    const secretResults = [];
    for (const [k, v] of Object.entries(secrets)) {
      try { const r = await cf('PUT', `/accounts/${ACCT()}/workers/scripts/${name}/secrets`, { name: k, text: v, type: 'secret_text' }); secretResults.push({ name: k, ok: true }); }
      catch (e) { secretResults.push({ name: k, ok: false, error: e.message }); }
    }
    // 3. Create route if requested
    let route = null;
    if (route_pattern && route_zone_id) {
      route = await cf('POST', `/zones/${route_zone_id}/workers/routes`, { pattern: route_pattern, script: name });
    }
    return { deployed: depData.result, secrets_set: secretResults, route };
  }

  // SUPER TOOL: cf_setup_d1_schema
  // Create D1 database + run migration SQL
  if (tool === 'cf_setup_d1_schema') {
    const { database_name, schema_sql, primary_location_hint } = args;
    if (!database_name || !schema_sql) throw new Error('database_name and schema_sql required');
    const db = await cf('POST', `/accounts/${ACCT()}/d1/database`, { name: database_name, primary_location_hint });
    const statements = schema_sql.split(';').map(s => s.trim()).filter(Boolean);
    const results = [];
    for (const stmt of statements) {
      try { const r = await cf('POST', `/accounts/${ACCT()}/d1/database/${db.uuid}/query`, { sql: stmt }); results.push({ ok: true, meta: r[0]?.meta }); }
      catch (e) { results.push({ ok: false, sql: stmt.slice(0,80), error: e.message }); }
    }
    return { database: { id: db.uuid, name: db.name }, statements_run: results.length, results };
  }

  // SUPER TOOL: cf_edge_cache_purge_and_verify
  // Purge cache for URLs + optionally fetch them to verify fresh
  if (tool === 'cf_edge_cache_purge_and_verify') {
    const { zone_id: zid, urls, verify = true } = args;
    if (!zid || !Array.isArray(urls)) throw new Error('zone_id and urls[] required');
    const purge = await cf('POST', `/zones/${zid}/purge_cache`, { files: urls });
    if (!verify) return { purged: purge, verified: false };
    const checks = [];
    for (const u of urls) {
      try {
        const r = await fetch(u, { method: 'HEAD' });
        checks.push({ url: u, status: r.status, cf_cache: r.headers.get('cf-cache-status'), age: r.headers.get('age') });
      } catch (e) { checks.push({ url: u, error: e.message }); }
    }
    return { purged: purge, verified: true, checks };
  }

  // SUPER TOOL: cf_worker_canary_deploy
  // Deploy to a staging worker name + smoke test + promote to production
  if (tool === 'cf_worker_canary_deploy') {
    const { production_name, script, smoke_test_url, compatibility_date = '2024-01-01', bindings = [] } = args;
    if (!production_name || !script || !smoke_test_url) throw new Error('production_name, script, smoke_test_url required');
    const canary_name = `${production_name}-canary`;
    const form = new FormData();
    form.append('worker.js', new Blob([script], { type: 'application/javascript' }), 'worker.js');
    form.append('metadata', JSON.stringify({ main_module: 'worker.js', compatibility_date, bindings }));
    const dep = await fetch(`${BASE}/accounts/${ACCT()}/workers/scripts/${canary_name}`, { method: 'PUT', headers: { 'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, body: form });
    if (!dep.ok) { const e = await dep.json(); throw new Error(`Canary deploy failed: ${e.errors?.[0]?.message}`); }
    const smoke = await fetch(smoke_test_url, { method: 'GET' });
    if (smoke.status >= 500) {
      await cf('DELETE', `/accounts/${ACCT()}/workers/scripts/${canary_name}`);
      throw new Error(`Smoke test failed (HTTP ${smoke.status}). Canary deleted, production unchanged.`);
    }
    const formProd = new FormData();
    formProd.append('worker.js', new Blob([script], { type: 'application/javascript' }), 'worker.js');
    formProd.append('metadata', JSON.stringify({ main_module: 'worker.js', compatibility_date, bindings }));
    const prod = await fetch(`${BASE}/accounts/${ACCT()}/workers/scripts/${production_name}`, { method: 'PUT', headers: { 'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, body: formProd });
    const prodData = await prod.json();
    await cf('DELETE', `/accounts/${ACCT()}/workers/scripts/${canary_name}`).catch(()=>null);
    return { canary_smoke_test: { status: smoke.status, ok: true }, production_deployed: prodData.success, production: prodData.result };
  }

  // SUPER TOOL: cf_rag_with_workers_ai
  // Embed query + query a vector store (KV-backed simple version) + answer with Workers AI
  if (tool === 'cf_rag_with_workers_ai') {
    const { query, kv_namespace_id, embedding_model = '@cf/baai/bge-base-en-v1.5', generation_model = '@cf/meta/llama-3.1-8b-instruct', max_results = 3 } = args;
    if (!query || !kv_namespace_id) throw new Error('query and kv_namespace_id required');
    const emb = await cf('POST', `/accounts/${ACCT()}/ai/run/${embedding_model}`, { text: [query] });
    // Naive: list KV keys + fetch first N values (real implementation would use Vectorize)
    const keys = await cf('GET', `/accounts/${ACCT()}/storage/kv/namespaces/${kv_namespace_id}/keys?limit=${max_results}`);
    const docs = [];
    for (const k of (keys || []).slice(0, max_results)) {
      const v = await fetch(`${BASE}/accounts/${ACCT()}/storage/kv/namespaces/${kv_namespace_id}/values/${encodeURIComponent(k.name)}`, { headers: headers() });
      if (v.ok) docs.push({ key: k.name, content: await v.text() });
    }
    const context = docs.map((d, i) => `[Doc ${i+1}: ${d.key}]\n${d.content}`).join('\n\n');
    const answer = await cf('POST', `/accounts/${ACCT()}/ai/run/${generation_model}`, {
      messages: [
        { role: 'system', content: 'Answer using ONLY the provided context. Cite docs as [Doc N].' },
        { role: 'user', content: `CONTEXT:\n${context}\n\nQUESTION: ${query}` }
      ],
      max_tokens: 1024
    });
    return { answer: answer.response, query_embedding_size: emb.data?.[0]?.length, sources: docs.map(d => d.key) };
  }

  if (tool === 'cf_get_api_token') {
    if (typeof args.token_id !== 'string' || !/^[a-fA-F0-9]{32}$/.test(args.token_id)) {
      throw new Error('token_id must be a 32-character hexadecimal token identifier');
    }
    return await cf('GET', `/user/tokens/${args.token_id}`);
  }

  // Reviewed read-only expansion capabilities; other expansion code stays gated.
  if (tool === 'cf_get_email_routing') {
    if (typeof args.zone_id !== 'string' || !/^[a-fA-F0-9]{32}$/.test(args.zone_id)) {
      throw new Error('zone_id must be a 32-character hexadecimal zone identifier');
    }
    return await cf('GET', `/zones/${args.zone_id}/email/routing`);
  }
  if (tool === 'cf_verify_api_token') {
    return await cf('GET', '/user/tokens/verify');
  }
  if (tool === 'cf_list_api_tokens') {
    const { page = 1, per_page = 20, direction, include_expired } = args;
    if (!Number.isSafeInteger(page) || page < 1) throw new Error('page must be a positive integer');
    if (!Number.isInteger(per_page) || per_page < 5 || per_page > 50) throw new Error('per_page must be an integer from 5 to 50');
    if (direction !== undefined && !['asc', 'desc'].includes(direction)) throw new Error('direction must be asc or desc');
    if (include_expired !== undefined && typeof include_expired !== 'boolean') throw new Error('include_expired must be boolean');
    const query = new URLSearchParams({ page, per_page });
    if (direction !== undefined) query.set('direction', direction);
    if (include_expired !== undefined) query.set('include_expired', String(include_expired));
    // Preserve pagination metadata rather than implying the first page is all tokens.
    return await cf('GET', `/user/tokens?${query}`, undefined, { envelope: true });
  }

  throw new Error(`Unknown Cloudflare tool: ${tool}`);

  // ── EMAIL ROUTING ─────────────────────────────────────────────────────────

  if (tool === 'cf_enable_email_routing') {
    return await cf('POST', `/zones/${args.zone_id}/email/routing/enable`, {});
  }
  if (tool === 'cf_disable_email_routing') {
    return await cf('POST', `/zones/${args.zone_id}/email/routing/disable`, {});
  }
  if (tool === 'cf_list_email_routing_rules') {
    return await cf('GET', `/zones/${args.zone_id}/email/routing/rules`);
  }
  if (tool === 'cf_create_email_routing_rule') {
    const { zone_id, name, matchers, actions, enabled = true } = args;
    if (!zone_id || !matchers || !actions) throw new Error('zone_id, matchers, and actions are required');
    return await cf('POST', `/zones/${zone_id}/email/routing/rules`, { name, matchers, actions, enabled });
  }
  if (tool === 'cf_update_email_routing_rule') {
    const { zone_id, rule_id, name, matchers, actions, enabled } = args;
    if (!zone_id || !rule_id) throw new Error('zone_id and rule_id are required');
    const body = {};
    if (name) body.name = name;
    if (matchers) body.matchers = matchers;
    if (actions) body.actions = actions;
    if (enabled !== undefined) body.enabled = enabled;
    return await cf('PUT', `/zones/${zone_id}/email/routing/rules/${rule_id}`, body);
  }
  if (tool === 'cf_delete_email_routing_rule') {
    return await cf('DELETE', `/zones/${args.zone_id}/email/routing/rules/${args.rule_id}`);
  }
  if (tool === 'cf_list_email_routing_addresses') {
    return await cf('GET', `/accounts/${accountId()}/email/routing/addresses`);
  }
  if (tool === 'cf_create_email_routing_address') {
    const { email } = args;
    if (!email) throw new Error('email is required');
    return await cf('POST', `/accounts/${accountId()}/email/routing/addresses`, { email });
  }
  if (tool === 'cf_delete_email_routing_address') {
    return await cf('DELETE', `/accounts/${accountId()}/email/routing/addresses/${args.address_id}`);
  }

  // ── WAF & BOT MANAGEMENT ─────────────────────────────────────────────────
  if (tool === 'cf_list_waf_packages') {
    return await cf('GET', `/zones/${args.zone_id}/firewall/waf/packages`);
  }
  if (tool === 'cf_list_waf_rule_groups') {
    return await cf('GET', `/zones/${args.zone_id}/firewall/waf/packages/${args.package_id}/groups`);
  }
  if (tool === 'cf_list_waf_rules') {
    return await cf('GET', `/zones/${args.zone_id}/firewall/waf/packages/${args.package_id}/rules?per_page=${args.limit || 25}`);
  }
  if (tool === 'cf_update_waf_rule') {
    return await cf('PATCH', `/zones/${args.zone_id}/firewall/waf/packages/${args.package_id}/rules/${args.rule_id}`, { mode: args.mode });
  }
  if (tool === 'cf_get_bot_management_config') {
    return await cf('GET', `/zones/${args.zone_id}/bot_management`);
  }
  if (tool === 'cf_update_bot_management_config') {
    const { zone_id, fight_mode, session_score, auto_update_model, using_latest_model } = args;
    if (!zone_id) throw new Error('zone_id is required');
    const body = {};
    if (fight_mode !== undefined) body.fight_mode = fight_mode;
    if (session_score !== undefined) body.session_score = session_score;
    if (auto_update_model !== undefined) body.auto_update_model = auto_update_model;
    if (using_latest_model !== undefined) body.using_latest_model = using_latest_model;
    return await cf('PUT', `/zones/${zone_id}/bot_management`, body);
  }

  // ── WORKERS AI (additional) ───────────────────────────────────────────────
  if (tool === 'cf_list_ai_finetune_assets') {
    return await cf('GET', `/accounts/${accountId()}/ai/finetunes/${args.finetune_id}/finetune-assets`);
  }
  if (tool === 'cf_create_ai_finetune') {
    const { name, description } = args;
    if (!name) throw new Error('name is required');
    return await cf('POST', `/accounts/${accountId()}/ai/finetunes`, { name, description });
  }

  // ── R2 OBJECT OPERATIONS ─────────────────────────────────────────────────
  if (tool === 'cf_r2_list_objects') {
    const { bucket, prefix, limit = 100, cursor } = args;
    if (!bucket) throw new Error('bucket is required');
    let path = `/accounts/${accountId()}/r2/buckets/${bucket}/objects?per_page=${limit}`;
    if (prefix) path += `&prefix=${encodeURIComponent(prefix)}`;
    if (cursor) path += `&cursor=${cursor}`;
    return await cf('GET', path);
  }
  if (tool === 'cf_r2_delete_object') {
    const { bucket, key } = args;
    if (!bucket || !key) throw new Error('bucket and key are required');
    return await cf('DELETE', `/accounts/${accountId()}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`);
  }
  if (tool === 'cf_r2_head_object') {
    const { bucket, key } = args;
    if (!bucket || !key) throw new Error('bucket and key are required');
    return await cf('GET', `/accounts/${accountId()}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}/metadata`);
  }

  // ── WORKERS ANALYTICS ENGINE ──────────────────────────────────────────────
  if (tool === 'cf_list_analytics_engine_datasets') {
    return await cf('GET', `/accounts/${accountId()}/analytics_engine/datasets`);
  }
  if (tool === 'cf_query_analytics_engine') {
    const { sql } = args;
    if (!sql) throw new Error('sql query is required');
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId()}/analytics_engine/sql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken()}`, 'Content-Type': 'text/plain' },
      body: sql
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`CF Analytics Engine: ${data.errors?.[0]?.message || JSON.stringify(data)}`);
    return data;
  }

  // ── ACCESS IDENTITY PROVIDERS ────────────────────────────────────────────
  if (tool === 'cf_list_identity_providers') {
    return await cf('GET', `/accounts/${accountId()}/access/identity_providers`);
  }
  if (tool === 'cf_get_identity_provider') {
    return await cf('GET', `/accounts/${accountId()}/access/identity_providers/${args.provider_id}`);
  }
  if (tool === 'cf_create_identity_provider') {
    const { name, type, config } = args;
    if (!name || !type || !config) throw new Error('name, type, and config are required');
    return await cf('POST', `/accounts/${accountId()}/access/identity_providers`, { name, type, config });
  }
  if (tool === 'cf_delete_identity_provider') {
    return await cf('DELETE', `/accounts/${accountId()}/access/identity_providers/${args.provider_id}`);
  }

  // ── ACCOUNT TOKENS & MEMBERS ─────────────────────────────────────────────


  if (tool === 'cf_roll_api_token') {
    return await cf('PUT', `/user/tokens/${args.token_id}/value`, {});
  }
  if (tool === 'cf_delete_api_token') {
    return await cf('DELETE', `/user/tokens/${args.token_id}`);
  }
  if (tool === 'cf_invite_account_member') {
    const { email, roles } = args;
    if (!email || !roles) throw new Error('email and roles array are required');
    return await cf('POST', `/accounts/${accountId()}/members`, { email, roles });
  }
  if (tool === 'cf_remove_account_member') {
    return await cf('DELETE', `/accounts/${accountId()}/members/${args.member_id}`);
  }
  if (tool === 'cf_update_account_member_roles') {
    return await cf('PUT', `/accounts/${accountId()}/members/${args.member_id}`, { roles: args.roles });
  }

  // ── ZONE SETTINGS BULK ───────────────────────────────────────────────────
  if (tool === 'cf_get_all_zone_settings') {
    return await cf('GET', `/zones/${args.zone_id}/settings`);
  }
  if (tool === 'cf_update_zone_settings_bulk') {
    const { zone_id, settings } = args;
    if (!zone_id || !settings?.length) throw new Error('zone_id and settings array are required');
    return await cf('PATCH', `/zones/${zone_id}/settings`, { items: settings });
  }
  if (tool === 'cf_get_zone_ssl_setting') {
    return await cf('GET', `/zones/${args.zone_id}/settings/ssl`);
  }
  if (tool === 'cf_update_zone_ssl_setting') {
    return await cf('PATCH', `/zones/${args.zone_id}/settings/ssl`, { value: args.value });
  }

  // ── SUPER TOOL: Zone health report ───────────────────────────────────────
  if (tool === 'cf_zone_health_report') {
    const { zone_id } = args;
    if (!zone_id) throw new Error('zone_id is required');
    const [zone, settings, dnsRecords, rateLimits, firewallRules] = await Promise.all([
      cf('GET', `/zones/${zone_id}`),
      cf('GET', `/zones/${zone_id}/settings`),
      cf('GET', `/zones/${zone_id}/dns_records?per_page=10`),
      cf('GET', `/zones/${zone_id}/rate_limits?per_page=10`).catch(() => ({ result: [] })),
      cf('GET', `/zones/${zone_id}/firewall/rules?per_page=10`).catch(() => ({ result: [] }))
    ]);
    const settingsMap = {};
    for (const s of (settings.result || [])) settingsMap[s.id] = s.value;
    return {
      zone: { name: zone.result?.name, status: zone.result?.status, plan: zone.result?.plan?.name, paused: zone.result?.paused },
      ssl: settingsMap['ssl'],
      always_https: settingsMap['always_use_https'],
      min_tls_version: settingsMap['min_tls_version'],
      http2: settingsMap['http2'],
      brotli: settingsMap['brotli'],
      dns_record_count: dnsRecords.result_info?.count || dnsRecords.result?.length,
      rate_limit_count: rateLimits.result?.length || 0,
      firewall_rule_count: firewallRules.result?.length || 0,
      generated_at: new Date().toISOString()
    };
  }

  // ── SUPER TOOL: Worker deployment summary ────────────────────────────────
  if (tool === 'cf_workers_summary') {
    const [workers, routes, secrets] = await Promise.all([
      cf('GET', `/accounts/${accountId()}/workers/scripts`),
      cf('GET', `/zones/${args.zone_id || ''}/workers/routes`).catch(() => ({ result: [] })),
      Promise.resolve({ result: [] })
    ]);
    return {
      total_workers: (workers.result || []).length,
      workers: (workers.result || []).map(w => ({ id: w.id, etag: w.etag, size: w.size, created_on: w.created_on, modified_on: w.modified_on })),
      routes: routes.result || [],
      generated_at: new Date().toISOString()
    };
  }

  throw new Error(`Unknown Cloudflare tool: ${tool}`);
}

export default { execute };
