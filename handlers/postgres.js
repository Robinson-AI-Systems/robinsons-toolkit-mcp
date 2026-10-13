import {dumpPostgres} from '../src/integrations/postgres/dump.js';
/**
 * Postgres Handler — 52 tools
 * Direct PostgreSQL operations: SQL, schema inspection, data ops,
 * indexes, roles, extensions, maintenance, monitoring, and Super Tools.
 * Uses pg via POSTGRES_CONNECTION_STRING.
 */

async function pg(sql, params = []) {
  const connStr = process.env.POSTGRES_CONNECTION_STRING;
  if (!connStr) throw new Error('POSTGRES_CONNECTION_STRING not set in .env');
  // Dynamic import to avoid startup errors when not configured
  const { default: postgres } = await import('postgres');
  const sql_client = postgres(connStr, { max: 1, idle_timeout: 5 });
  try {
    const result = await sql_client.unsafe(sql, params);
    return result;
  } finally {
    await sql_client.end({ timeout: 3 });
  }
}

async function execute(tool, args) {

  // ── RAW SQL ───────────────────────────────────────────────────────────────
  if (tool === 'postgres_run_sql') {
    if (!args.sql) throw new Error('sql is required');
    const result = await pg(args.sql, args.params || []);
    return Array.isArray(result) ? result : { rows: result, count: result.count };
  }
  if (tool === 'postgres_run_transaction') {
    const { statements } = args;
    if (!statements?.length) throw new Error('statements array is required');
    const allSql = ['BEGIN', ...statements, 'COMMIT'].join('; ');
    return await pg(allSql);
  }
  if (tool === 'postgres_explain_query') {
    const result = await pg(`EXPLAIN ${args.analyze ? 'ANALYZE' : ''} ${args.sql}`);
    return { plan: result.map(r => Object.values(r)[0]).join('\n') };
  }

  // ── SCHEMA INSPECTION ─────────────────────────────────────────────────────
  if (tool === 'postgres_list_schemas') {
    const result = await pg(`SELECT schema_name, schema_owner FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY schema_name`);
    return result;
  }
  if (tool === 'postgres_list_tables') {
    const schema = args.schema || 'public';
    const result = await pg(`SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`, [schema]);
    return result;
  }
  if (tool === 'postgres_describe_table') {
    const result = await pg(`SELECT c.column_name, c.data_type, c.character_maximum_length, c.is_nullable, c.column_default, c.ordinal_position FROM information_schema.columns c WHERE c.table_name = $1 AND c.table_schema = $2 ORDER BY c.ordinal_position`, [args.table_name, args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_list_columns') {
    const result = await pg(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, ordinal_position`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_list_indexes') {
    const result = await pg(`SELECT schemaname, tablename, indexname, indexdef, indisunique FROM pg_indexes WHERE schemaname = $1 ORDER BY tablename, indexname`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_list_views') {
    const result = await pg(`SELECT table_name AS view_name, view_definition FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_list_functions') {
    const result = await pg(`SELECT routine_name, routine_type, data_type AS return_type FROM information_schema.routines WHERE routine_schema = $1 ORDER BY routine_name`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_list_triggers') {
    const result = await pg(`SELECT trigger_name, event_object_table, event_manipulation, action_timing FROM information_schema.triggers WHERE trigger_schema = $1 ORDER BY event_object_table, trigger_name`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_list_sequences') {
    const result = await pg(`SELECT sequence_name, data_type, start_value, minimum_value, maximum_value, increment FROM information_schema.sequences WHERE sequence_schema = $1 ORDER BY sequence_name`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_list_foreign_keys') {
    const result = await pg(`SELECT kcu.table_name, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column, tc.constraint_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.constraint_schema = $1 ORDER BY kcu.table_name`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_list_constraints') {
    const result = await pg(`SELECT tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name WHERE tc.constraint_schema = $1 ORDER BY tc.table_name, tc.constraint_type`, [args.schema || 'public']);
    return result;
  }

  // ── DATA OPERATIONS ───────────────────────────────────────────────────────
  if (tool === 'postgres_select') {
    const { table, columns = '*', where, order_by, limit = 50, offset = 0, schema = 'public' } = args;
    if (!table) throw new Error('table is required');
    let sql = `SELECT ${columns} FROM ${schema}.${table}`;
    const params = [];
    if (where) { sql += ` WHERE ${where}`; }
    if (order_by) sql += ` ORDER BY ${order_by}`;
    sql += ` LIMIT ${limit} OFFSET ${offset}`;
    return await pg(sql, params);
  }
  if (tool === 'postgres_insert') {
    const { table, data, schema = 'public', returning = '*' } = args;
    if (!table || !data) throw new Error('table and data are required');
    const keys = Object.keys(data);
    const vals = keys.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO ${schema}.${table} (${keys.join(', ')}) VALUES (${vals}) RETURNING ${returning}`;
    return await pg(sql, Object.values(data));
  }
  if (tool === 'postgres_update') {
    const { table, data, where, schema = 'public', returning = '*' } = args;
    if (!table || !data || !where) throw new Error('table, data, and where are required');
    const keys = Object.keys(data);
    const params = Object.values(data);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const sql = `UPDATE ${schema}.${table} SET ${sets} WHERE ${where} RETURNING ${returning}`;
    return await pg(sql, params);
  }
  if (tool === 'postgres_delete') {
    const { table, where, schema = 'public', returning = 'id' } = args;
    if (!table || !where) throw new Error('table and where are required');
    return await pg(`DELETE FROM ${schema}.${table} WHERE ${where} RETURNING ${returning}`);
  }
  if (tool === 'postgres_upsert') {
    const { table, data, conflict_column, schema = 'public', returning = '*' } = args;
    if (!table || !data || !conflict_column) throw new Error('table, data, and conflict_column are required');
    const keys = Object.keys(data);
    const vals = keys.map((_, i) => `$${i + 1}`).join(', ');
    const updates = keys.filter(k => k !== conflict_column).map((k, i) => `${k} = EXCLUDED.${k}`).join(', ');
    const sql = `INSERT INTO ${schema}.${table} (${keys.join(', ')}) VALUES (${vals}) ON CONFLICT (${conflict_column}) DO UPDATE SET ${updates} RETURNING ${returning}`;
    return await pg(sql, Object.values(data));
  }

  // ── TABLE STATS & MONITORING ──────────────────────────────────────────────
  if (tool === 'postgres_get_table_row_count') {
    const result = await pg(`SELECT relname AS table_name, n_live_tup AS estimated_rows FROM pg_stat_user_tables WHERE schemaname = $1 ORDER BY n_live_tup DESC`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_list_slow_queries') {
    const result = await pg(`SELECT query, calls, total_exec_time, mean_exec_time, rows FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT ${args.limit || 10}`);
    return result;
  }
  if (tool === 'postgres_get_active_connections') {
    const result = await pg(`SELECT pid, usename, application_name, client_addr, state, wait_event, LEFT(query, 100) AS query_snippet FROM pg_stat_activity WHERE state != 'idle' ORDER BY state`);
    return result;
  }
  if (tool === 'postgres_kill_query') {
    return await pg(`SELECT pg_terminate_backend($1)`, [args.pid]);
  }
  if (tool === 'postgres_get_database_size') {
    const result = await pg(`SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size, pg_database_size(datname) AS size_bytes FROM pg_database ORDER BY pg_database_size(datname) DESC`);
    return result;
  }
  if (tool === 'postgres_get_table_sizes') {
    const result = await pg(`SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size, pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size FROM pg_tables WHERE schemaname = $1 ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC LIMIT ${args.limit || 20}`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_get_index_usage') {
    const result = await pg(`SELECT schemaname, tablename, indexname, idx_scan AS index_scans, idx_tup_read AS tuples_read, idx_tup_fetch AS tuples_fetched FROM pg_stat_user_indexes WHERE schemaname = $1 ORDER BY idx_scan DESC`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_get_unused_indexes') {
    const result = await pg(`SELECT schemaname, tablename, indexname, pg_size_pretty(pg_relation_size(indexrelid)) AS index_size FROM pg_stat_user_indexes WHERE idx_scan = 0 AND schemaname = $1 ORDER BY pg_relation_size(indexrelid) DESC`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_get_table_bloat') {
    const result = await pg(`SELECT schemaname, tablename, n_dead_tup AS dead_tuples, n_live_tup AS live_tuples, CASE WHEN n_live_tup > 0 THEN round(100*n_dead_tup::numeric/n_live_tup,1) ELSE 0 END AS dead_percent, last_vacuum, last_autovacuum FROM pg_stat_user_tables WHERE schemaname = $1 AND n_dead_tup > 100 ORDER BY n_dead_tup DESC`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_get_locks') {
    const result = await pg(`SELECT l.pid, l.granted, l.locktype, l.relation::regclass AS table_name, l.mode, LEFT(a.query, 100) AS query FROM pg_locks l JOIN pg_stat_activity a ON l.pid = a.pid WHERE NOT l.granted ORDER BY l.pid`);
    return result;
  }
  if (tool === 'postgres_get_replication_status') {
    const result = await pg(`SELECT client_addr, state, sent_lsn, write_lsn, flush_lsn, replay_lsn FROM pg_stat_replication`);
    return result;
  }

  // ── SCHEMA MODIFICATION ───────────────────────────────────────────────────
  if (tool === 'postgres_create_index') {
    const { index_name, table_name, columns, unique = false, schema = 'public', method = 'btree', concurrently = true } = args;
    if (!index_name || !table_name || !columns) throw new Error('index_name, table_name, and columns are required');
    const sql = `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${concurrently ? 'CONCURRENTLY ' : ''}IF NOT EXISTS ${index_name} ON ${schema}.${table_name} USING ${method} (${Array.isArray(columns) ? columns.join(', ') : columns})`;
    return await pg(sql);
  }
  if (tool === 'postgres_drop_index') {
    return await pg(`DROP INDEX ${args.concurrently ? 'CONCURRENTLY' : ''} IF EXISTS ${args.index_name}`);
  }
  if (tool === 'postgres_add_column') {
    const { table_name, column_name, data_type, nullable = true, default_value, schema = 'public' } = args;
    let sql = `ALTER TABLE ${schema}.${table_name} ADD COLUMN IF NOT EXISTS ${column_name} ${data_type}`;
    if (!nullable) sql += ' NOT NULL';
    if (default_value !== undefined) sql += ` DEFAULT ${default_value}`;
    return await pg(sql);
  }
  if (tool === 'postgres_drop_column') {
    return await pg(`ALTER TABLE ${args.schema || 'public'}.${args.table_name} DROP COLUMN IF EXISTS ${args.column_name} ${args.cascade ? 'CASCADE' : ''}`);
  }

  // ── ROLES & PERMISSIONS ───────────────────────────────────────────────────
  if (tool === 'postgres_list_roles') {
    const result = await pg(`SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolreplication FROM pg_roles ORDER BY rolname`);
    return result;
  }
  if (tool === 'postgres_get_grants') {
    const result = await pg(`SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants WHERE table_schema = $1 ORDER BY grantee, table_name`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_grant_privileges') {
    const { role, table_name, privileges = 'SELECT,INSERT,UPDATE,DELETE', schema = 'public' } = args;
    return await pg(`GRANT ${privileges} ON ${schema}.${table_name} TO ${role}`);
  }

  // ── EXTENSIONS ────────────────────────────────────────────────────────────
  if (tool === 'postgres_list_extensions') {
    const result = await pg(`SELECT extname, extversion, installed_version FROM pg_available_extensions WHERE installed_version IS NOT NULL ORDER BY extname`);
    return result;
  }
  if (tool === 'postgres_enable_extension') {
    return await pg(`CREATE EXTENSION IF NOT EXISTS "${args.extension_name}" SCHEMA ${args.schema || 'public'}`);
  }

  // ── MAINTENANCE ───────────────────────────────────────────────────────────
  if (tool === 'postgres_vacuum_table') {
    const { table_name, analyze = true, schema = 'public' } = args;
    return await pg(`VACUUM${analyze ? ' ANALYZE' : ''} ${schema}.${table_name}`);
  }
  if (tool === 'postgres_reindex_table') {
    return await pg(`REINDEX TABLE ${args.schema || 'public'}.${args.table_name}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SUPER TOOLS
  // ══════════════════════════════════════════════════════════════════════════

  // SUPER: Full schema audit — tables, columns, row counts, indexes, bloat
  if (tool === 'postgres_schema_audit') {
    const schema = args.schema || 'public';
    const [tables, indexes, bloat, sizes, extensions] = await Promise.all([
      pg(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`, [schema]),
      pg(`SELECT tablename, COUNT(*) AS index_count FROM pg_indexes WHERE schemaname = $1 GROUP BY tablename`, [schema]),
      pg(`SELECT tablename, n_dead_tup, n_live_tup FROM pg_stat_user_tables WHERE schemaname = $1 AND n_dead_tup > 1000 ORDER BY n_dead_tup DESC LIMIT 5`, [schema]),
      pg(`SELECT tablename, pg_size_pretty(pg_total_relation_size($1||'.'||tablename)) AS size FROM pg_tables WHERE schemaname = $1 ORDER BY pg_total_relation_size($1||'.'||tablename) DESC LIMIT 10`, [schema]),
      pg(`SELECT extname FROM pg_extension ORDER BY extname`)
    ]);
    return {
      schema, table_count: tables.length,
      tables: tables.map(t => t.table_name),
      indexes_per_table: Object.fromEntries((indexes).map(i => [i.tablename, parseInt(i.index_count)])),
      bloated_tables: bloat,
      largest_tables: sizes,
      installed_extensions: extensions.map(e => e.extname)
    };
  }

  // SUPER: Health check — connections, db size, replication lag, bloat summary
  if (tool === 'postgres_health_check') {
    const [version, connections, dbSize, bloat] = await Promise.all([
      pg(`SELECT version()`),
      pg(`SELECT state, COUNT(*) AS count FROM pg_stat_activity GROUP BY state`),
      pg(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`),
      pg(`SELECT COUNT(*) AS tables_needing_vacuum FROM pg_stat_user_tables WHERE n_dead_tup > 1000`)
    ]);
    return {
      version: version[0]?.version?.split(' ').slice(0,2).join(' '),
      connections: Object.fromEntries(connections.map(r => [r.state || 'null', parseInt(r.count)])),
      database_size: dbSize[0]?.size,
      tables_needing_vacuum: parseInt(bloat[0]?.tables_needing_vacuum || 0),
      checked_at: new Date().toISOString()
    };
  }


  // ── SCHEMA MANAGEMENT ────────────────────────────────────────────────────
  if (tool === 'postgres_create_schema') {
    const { schema_name, authorization } = args;
    if (!schema_name) throw new Error('schema_name is required');
    let sql = `CREATE SCHEMA IF NOT EXISTS ${schema_name}`;
    if (authorization) sql += ` AUTHORIZATION ${authorization}`;
    return await pg(sql);
  }
  if (tool === 'postgres_drop_schema') {
    const { schema_name, cascade = false } = args;
    if (!schema_name) throw new Error('schema_name is required');
    return await pg(`DROP SCHEMA IF EXISTS ${schema_name} ${cascade ? 'CASCADE' : 'RESTRICT'}`);
  }
  if (tool === 'postgres_create_table') {
    const { table_name, columns, schema = 'public', if_not_exists = true } = args;
    if (!table_name || !columns) throw new Error('table_name and columns are required');
    // columns: [{name, type, nullable, default, primary_key}]
    const colDefs = columns.map(c => {
      let def = `${c.name} ${c.type}`;
      if (c.primary_key) def += ' PRIMARY KEY';
      if (c.not_null || c.nullable === false) def += ' NOT NULL';
      if (c.default !== undefined) def += ` DEFAULT ${c.default}`;
      return def;
    }).join(', ');
    return await pg(`CREATE TABLE ${if_not_exists ? 'IF NOT EXISTS' : ''} ${schema}.${table_name} (${colDefs})`);
  }
  if (tool === 'postgres_truncate_table') {
    const { table_name, schema = 'public', cascade = false, restart_identity = false } = args;
    if (!table_name) throw new Error('table_name is required');
    let sql = `TRUNCATE TABLE ${schema}.${table_name}`;
    if (restart_identity) sql += ' RESTART IDENTITY';
    if (cascade) sql += ' CASCADE';
    return await pg(sql);
  }
  if (tool === 'postgres_copy_to_csv') {
    // Export query results as CSV text using PostgreSQL COPY TO STDOUT
    const { sql, delimiter = ',' } = args;
    if (!sql) throw new Error('sql is required');
    const result = await pg(`COPY (${sql}) TO STDOUT WITH (FORMAT csv, HEADER true, DELIMITER '${delimiter}')`);
    return { csv: result, note: 'CSV output with headers' };
  }

  // ── USER MANAGEMENT ──────────────────────────────────────────────────────
  if (tool === 'postgres_create_user') {
    const { username, password, superuser = false, createdb = false, login = true } = args;
    if (!username) throw new Error('username is required');
    let sql = `CREATE ROLE ${username}`;
    const opts = [];
    if (login) opts.push('LOGIN');
    if (password) opts.push(`PASSWORD '${password.replace(/'/g, "''")}'`);
    if (superuser) opts.push('SUPERUSER');
    if (createdb) opts.push('CREATEDB');
    if (opts.length) sql += ' ' + opts.join(' ');
    return await pg(sql);
  }
  if (tool === 'postgres_drop_user') {
    const { username } = args;
    if (!username) throw new Error('username is required');
    return await pg(`DROP ROLE IF EXISTS ${username}`);
  }
  if (tool === 'postgres_alter_user_password') {
    const { username, password } = args;
    if (!username || !password) throw new Error('username and password are required');
    return await pg(`ALTER ROLE ${username} WITH PASSWORD '${password.replace(/'/g, "''")}'`);
  }

  // ── SEQUENCES ────────────────────────────────────────────────────────────
  if (tool === 'postgres_nextval') {
    const { sequence_name, schema = 'public' } = args;
    if (!sequence_name) throw new Error('sequence_name is required');
    const result = await pg(`SELECT nextval('${schema}.${sequence_name}')`);
    return { nextval: result[0]?.nextval };
  }
  if (tool === 'postgres_setval') {
    const { sequence_name, value, is_called = true, schema = 'public' } = args;
    if (!sequence_name || value === undefined) throw new Error('sequence_name and value are required');
    const result = await pg(`SELECT setval('${schema}.${sequence_name}', ${value}, ${is_called})`);
    return { setval: result[0]?.setval };
  }

  // ── REPLICATION ──────────────────────────────────────────────────────────
  if (tool === 'postgres_list_publications') {
    return await pg(`SELECT pubname, puballtables, pubinsert, pubupdate, pubdelete FROM pg_publication ORDER BY pubname`);
  }
  if (tool === 'postgres_list_subscriptions') {
    return await pg(`SELECT subname, subenabled, subslotname, subpublications FROM pg_subscription ORDER BY subname`);
  }

  // ── SESSION CONFIG ───────────────────────────────────────────────────────
  if (tool === 'postgres_set_session_config') {
    const { parameter, value } = args;
    if (!parameter || value === undefined) throw new Error('parameter and value are required');
    return await pg(`SET LOCAL ${parameter} = '${String(value).replace(/'/g, "''")}'`);
  }
  if (tool === 'postgres_show_config') {
    const { parameter } = args;
    if (parameter) {
      const result = await pg(`SHOW ${parameter}`);
      return result[0];
    }
    return await pg(`SELECT name, setting, unit, short_desc, source FROM pg_settings ORDER BY name`);
  }
  if (tool === 'postgres_get_wait_events') {
    return await pg(`SELECT pid, wait_event_type, wait_event, state, LEFT(query, 80) AS query_snippet FROM pg_stat_activity WHERE wait_event IS NOT NULL AND state != 'idle' ORDER BY wait_event_type, wait_event`);
  }
  if (tool === 'postgres_get_bgwriter_stats') {
    return await pg(`SELECT checkpoints_timed, checkpoints_req, checkpoint_write_time, checkpoint_sync_time, buffers_checkpoint, buffers_clean, maxwritten_clean, buffers_backend, buffers_alloc, stats_reset FROM pg_stat_bgwriter`);
  }


  // ── ADVISORY LOCKS ────────────────────────────────────────────────────────
  if (tool === 'postgres_advisory_lock') {
    const { lock_key, shared = false } = args;
    if (lock_key === undefined) throw new Error('lock_key (integer) is required');
    const fn = shared ? 'pg_try_advisory_lock_shared' : 'pg_try_advisory_lock';
    const result = await pg(`SELECT ${fn}(${parseInt(lock_key)}) as acquired`);
    return { lock_key: parseInt(lock_key), acquired: result[0]?.acquired ?? false, shared };
  }
  if (tool === 'postgres_advisory_unlock') {
    const { lock_key, shared = false } = args;
    if (lock_key === undefined) throw new Error('lock_key (integer) is required');
    const fn = shared ? 'pg_advisory_unlock_shared' : 'pg_advisory_unlock';
    const result = await pg(`SELECT ${fn}(${parseInt(lock_key)}) as released`);
    return { lock_key: parseInt(lock_key), released: result[0]?.released ?? false };
  }

  // ── NOTIFY ─────────────────────────────────────────────────────────────────
  if (tool === 'postgres_notify') {
    const { channel, payload } = args;
    if (!channel) throw new Error('channel is required');
    const safeChannel = channel.replace(/[^a-zA-Z0-9_]/g, '_');
    if (payload !== undefined) {
      await pg(`SELECT pg_notify($1, $2)`, [safeChannel, String(payload)]);
    } else {
      await pg(`SELECT pg_notify($1, '')`, [safeChannel]);
    }
    return { sent: true, channel: safeChannel, payload: payload || null };
  }

  // ── LOGICAL REPLICATION SLOTS ──────────────────────────────────────────────
  if (tool === 'postgres_list_replication_slots') {
    const result = await pg(`SELECT slot_name, plugin, slot_type, database, active, restart_lsn, confirmed_flush_lsn FROM pg_replication_slots ORDER BY slot_name`);
    return { slots: result, count: result.length };
  }
  if (tool === 'postgres_create_replication_slot') {
    const { slot_name, plugin = 'pgoutput' } = args;
    if (!slot_name) throw new Error('slot_name is required');
    const result = await pg(`SELECT * FROM pg_create_logical_replication_slot($1, $2)`, [slot_name, plugin]);
    return { created: true, slot_name, plugin, lsn: result[0]?.lsn };
  }
  if (tool === 'postgres_drop_replication_slot') {
    const { slot_name } = args;
    if (!slot_name) throw new Error('slot_name is required');
    await pg(`SELECT pg_drop_replication_slot($1)`, [slot_name]);
    return { dropped: true, slot_name };
  }


  // ── BACKUP & DUMP (credential-scoped pg_dump process) ─────────────────────
  if (tool === 'postgres_dump_schema') {
    const connStr = process.env.POSTGRES_CONNECTION_STRING;
    if (!connStr) throw new Error('POSTGRES_CONNECTION_STRING not set in .env');
    const { schema = 'public', output_path } = args;
    return { ...dumpPostgres({connectionString:connStr,outputPath:output_path,schema,schemaOnly:true}), schema };
  }
  if (tool === 'postgres_dump_table') {
    const connStr = process.env.POSTGRES_CONNECTION_STRING;
    if (!connStr) throw new Error('POSTGRES_CONNECTION_STRING not set in .env');
    const { table_name, schema = 'public', output_path, format = 'plain' } = args;
    if (!table_name) throw new Error('table_name is required');
    return { ...dumpPostgres({connectionString:connStr,outputPath:output_path,schema,table:table_name,format}), table: `${schema}.${table_name}` };
  }

    throw new Error(`Unknown Postgres tool: ${tool}`);

  // ── DATABASE MANAGEMENT ──────────────────────────────────────────────────
  if (tool === 'postgres_list_databases') {
    return await pg(`SELECT datname AS database, pg_encoding_to_char(encoding) AS encoding, datcollate AS collation, pg_size_pretty(pg_database_size(datname)) AS size FROM pg_database WHERE datistemplate = false ORDER BY datname`);
  }
  if (tool === 'postgres_create_database') {
    const { database_name, owner, encoding = 'UTF8', template } = args;
    if (!database_name) throw new Error('database_name is required');
    let sql = `CREATE DATABASE "${database_name}"`;
    if (owner) sql += ` OWNER ${owner}`;
    if (encoding) sql += ` ENCODING '${encoding}'`;
    if (template) sql += ` TEMPLATE ${template}`;
    return await pg(sql);
  }
  if (tool === 'postgres_drop_database') {
    const { database_name, force = false } = args;
    if (!database_name) throw new Error('database_name is required');
    const sql = `DROP DATABASE IF EXISTS "${database_name}"${force ? ' WITH (FORCE)' : ''}`;
    return await pg(sql);
  }
  if (tool === 'postgres_rename_database') {
    const { database_name, new_name } = args;
    if (!database_name || !new_name) throw new Error('database_name and new_name are required');
    return await pg(`ALTER DATABASE "${database_name}" RENAME TO "${new_name}"`);
  }
  if (tool === 'postgres_change_database_owner') {
    const { database_name, new_owner } = args;
    if (!database_name || !new_owner) throw new Error('database_name and new_owner are required');
    return await pg(`ALTER DATABASE "${database_name}" OWNER TO ${new_owner}`);
  }
  if (tool === 'postgres_get_database_config') {
    const { database_name } = args;
    if (!database_name) throw new Error('database_name is required');
    return await pg(`SELECT name, setting, unit, context, source FROM pg_settings WHERE source != 'default' ORDER BY name`);
  }

  // ── ADVANCED USER / ROLE MANAGEMENT ──────────────────────────────────────
  if (tool === 'postgres_create_role') {
    const { role_name, inherit = true, nologin = true } = args;
    if (!role_name) throw new Error('role_name is required');
    const opts = [nologin ? 'NOLOGIN' : 'LOGIN', inherit ? 'INHERIT' : 'NOINHERIT'];
    return await pg(`CREATE ROLE ${role_name} ${opts.join(' ')}`);
  }
  if (tool === 'postgres_grant_role') {
    const { role, grantee } = args;
    if (!role || !grantee) throw new Error('role and grantee are required');
    return await pg(`GRANT ${role} TO ${grantee}`);
  }
  if (tool === 'postgres_revoke_role') {
    const { role, revokee } = args;
    if (!role || !revokee) throw new Error('role and revokee are required');
    return await pg(`REVOKE ${role} FROM ${revokee}`);
  }
  if (tool === 'postgres_revoke_privileges') {
    const { role, table_name, privileges = 'ALL', schema = 'public' } = args;
    if (!role || !table_name) throw new Error('role and table_name are required');
    return await pg(`REVOKE ${privileges} ON ${schema}.${table_name} FROM ${role}`);
  }
  if (tool === 'postgres_grant_schema_privileges') {
    const { role, schema = 'public', privileges = 'USAGE' } = args;
    if (!role) throw new Error('role is required');
    return await pg(`GRANT ${privileges} ON SCHEMA ${schema} TO ${role}`);
  }
  if (tool === 'postgres_grant_all_tables') {
    const { role, schema = 'public', privileges = 'SELECT' } = args;
    if (!role) throw new Error('role is required');
    return await pg(`GRANT ${privileges} ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  }
  if (tool === 'postgres_set_default_privileges') {
    const { grantor, grantee, schema = 'public', privileges = 'SELECT', object_type = 'TABLES' } = args;
    if (!grantee) throw new Error('grantee is required');
    let sql = `ALTER DEFAULT PRIVILEGES`;
    if (grantor) sql += ` FOR ROLE ${grantor}`;
    sql += ` IN SCHEMA ${schema} GRANT ${privileges} ON ${object_type} TO ${grantee}`;
    return await pg(sql);
  }
  if (tool === 'postgres_alter_user') {
    const { username, options } = args;
    if (!username || !options) throw new Error('username and options string required');
    return await pg(`ALTER ROLE ${username} ${options}`);
  }
  if (tool === 'postgres_list_role_members') {
    return await pg(`SELECT r.rolname AS role, m.rolname AS member FROM pg_roles r JOIN pg_auth_members am ON r.oid = am.roleid JOIN pg_roles m ON am.member = m.oid ORDER BY r.rolname, m.rolname`);
  }

  // ── ADVANCED PERFORMANCE ──────────────────────────────────────────────────
  if (tool === 'postgres_get_query_stats') {
    const result = await pg(`SELECT query, calls, total_exec_time, mean_exec_time, stddev_exec_time, rows, shared_blks_hit, shared_blks_read, (shared_blks_hit::float / NULLIF(shared_blks_hit + shared_blks_read, 0) * 100)::int AS cache_hit_pct FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT ${args.limit || 20}`);
    return result;
  }
  if (tool === 'postgres_get_cache_hit_ratio') {
    const result = await pg(`SELECT sum(heap_blks_read) AS heap_read, sum(heap_blks_hit) AS heap_hit, (sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0))::numeric(5,4) AS cache_ratio FROM pg_statio_user_tables`);
    return result[0];
  }
  if (tool === 'postgres_get_index_bloat') {
    const result = await pg(`SELECT schemaname, tablename, indexname, pg_size_pretty(pg_relation_size(indexrelid)) AS index_size, idx_scan, CASE WHEN idx_scan = 0 AND pg_relation_size(indexrelid) > 1024*1024 THEN 'candidate for removal' ELSE 'ok' END AS status FROM pg_stat_user_indexes WHERE schemaname = $1 ORDER BY pg_relation_size(indexrelid) DESC LIMIT ${args.limit || 20}`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_get_long_running_queries') {
    const threshold = args.min_seconds || 5;
    const result = await pg(`SELECT pid, now() - query_start AS duration, state, wait_event_type, wait_event, LEFT(query, 200) AS query FROM pg_stat_activity WHERE state != 'idle' AND query_start IS NOT NULL AND now() - query_start > interval '${threshold} seconds' ORDER BY duration DESC`);
    return result;
  }
  if (tool === 'postgres_get_missing_indexes') {
    const result = await pg(`SELECT schemaname, tablename, seq_scan, seq_tup_read, idx_scan, seq_tup_read / NULLIF(seq_scan, 0) AS avg_rows_per_scan FROM pg_stat_user_tables WHERE seq_scan > 50 AND (idx_scan IS NULL OR idx_scan = 0) AND schemaname = $1 ORDER BY seq_tup_read DESC LIMIT 20`, [args.schema || 'public']);
    return result;
  }
  if (tool === 'postgres_reset_statistics') {
    return await pg(`SELECT pg_stat_reset()`);
  }
  if (tool === 'postgres_analyze_table') {
    const { table_name, schema = 'public', verbose = false } = args;
    if (!table_name) throw new Error('table_name is required');
    return await pg(`ANALYZE ${verbose ? 'VERBOSE' : ''} ${schema}.${table_name}`);
  }
  if (tool === 'postgres_cluster_table') {
    const { table_name, index_name, schema = 'public' } = args;
    if (!table_name) throw new Error('table_name is required');
    if (index_name) {
      return await pg(`CLUSTER ${schema}.${table_name} USING ${index_name}`);
    }
    return await pg(`CLUSTER ${schema}.${table_name}`);
  }

  // ── EXTENSIONS MANAGEMENT ─────────────────────────────────────────────────
  if (tool === 'postgres_list_available_extensions') {
    const result = await pg(`SELECT name, default_version, installed_version, comment FROM pg_available_extensions ORDER BY name`);
    return result;
  }
  if (tool === 'postgres_drop_extension') {
    const { extension_name, cascade = false } = args;
    if (!extension_name) throw new Error('extension_name is required');
    return await pg(`DROP EXTENSION IF EXISTS "${extension_name}" ${cascade ? 'CASCADE' : 'RESTRICT'}`);
  }
  if (tool === 'postgres_get_extension_info') {
    const result = await pg(`SELECT name, default_version, installed_version, comment FROM pg_available_extensions WHERE name = $1`, [args.extension_name]);
    return result[0] || { error: 'Extension not found' };
  }

  // ── TABLE & COLUMN OPERATIONS ─────────────────────────────────────────────
  if (tool === 'postgres_rename_table') {
    const { table_name, new_name, schema = 'public' } = args;
    if (!table_name || !new_name) throw new Error('table_name and new_name are required');
    return await pg(`ALTER TABLE ${schema}.${table_name} RENAME TO ${new_name}`);
  }
  if (tool === 'postgres_drop_table') {
    const { table_name, schema = 'public', cascade = false, if_exists = true } = args;
    if (!table_name) throw new Error('table_name is required');
    return await pg(`DROP TABLE ${if_exists ? 'IF EXISTS' : ''} ${schema}.${table_name} ${cascade ? 'CASCADE' : 'RESTRICT'}`);
  }
  if (tool === 'postgres_rename_column') {
    const { table_name, column_name, new_name, schema = 'public' } = args;
    if (!table_name || !column_name || !new_name) throw new Error('table_name, column_name, and new_name are required');
    return await pg(`ALTER TABLE ${schema}.${table_name} RENAME COLUMN ${column_name} TO ${new_name}`);
  }
  if (tool === 'postgres_alter_column_type') {
    const { table_name, column_name, new_type, using_expression, schema = 'public' } = args;
    if (!table_name || !column_name || !new_type) throw new Error('table_name, column_name, and new_type are required');
    let sql = `ALTER TABLE ${schema}.${table_name} ALTER COLUMN ${column_name} TYPE ${new_type}`;
    if (using_expression) sql += ` USING ${using_expression}`;
    return await pg(sql);
  }
  if (tool === 'postgres_set_column_not_null') {
    const { table_name, column_name, not_null = true, schema = 'public' } = args;
    if (!table_name || !column_name) throw new Error('table_name and column_name are required');
    const action = not_null ? 'SET NOT NULL' : 'DROP NOT NULL';
    return await pg(`ALTER TABLE ${schema}.${table_name} ALTER COLUMN ${column_name} ${action}`);
  }
  if (tool === 'postgres_set_column_default') {
    const { table_name, column_name, default_value, schema = 'public' } = args;
    if (!table_name || !column_name) throw new Error('table_name and column_name are required');
    if (default_value === null || default_value === undefined) {
      return await pg(`ALTER TABLE ${schema}.${table_name} ALTER COLUMN ${column_name} DROP DEFAULT`);
    }
    return await pg(`ALTER TABLE ${schema}.${table_name} ALTER COLUMN ${column_name} SET DEFAULT ${default_value}`);
  }

  // ── CONSTRAINT MANAGEMENT ─────────────────────────────────────────────────
  if (tool === 'postgres_add_primary_key') {
    const { table_name, columns, schema = 'public', constraint_name } = args;
    if (!table_name || !columns) throw new Error('table_name and columns are required');
    const name = constraint_name || `${table_name}_pkey`;
    const cols = Array.isArray(columns) ? columns.join(', ') : columns;
    return await pg(`ALTER TABLE ${schema}.${table_name} ADD CONSTRAINT ${name} PRIMARY KEY (${cols})`);
  }
  if (tool === 'postgres_add_foreign_key') {
    const { table_name, column_name, ref_table, ref_column = 'id', schema = 'public', on_delete = 'NO ACTION', constraint_name } = args;
    if (!table_name || !column_name || !ref_table) throw new Error('table_name, column_name, and ref_table are required');
    const name = constraint_name || `${table_name}_${column_name}_fkey`;
    return await pg(`ALTER TABLE ${schema}.${table_name} ADD CONSTRAINT ${name} FOREIGN KEY (${column_name}) REFERENCES ${schema}.${ref_table}(${ref_column}) ON DELETE ${on_delete}`);
  }
  if (tool === 'postgres_add_unique_constraint') {
    const { table_name, columns, schema = 'public', constraint_name } = args;
    if (!table_name || !columns) throw new Error('table_name and columns are required');
    const name = constraint_name || `${table_name}_${Array.isArray(columns) ? columns.join('_') : columns}_key`;
    const cols = Array.isArray(columns) ? columns.join(', ') : columns;
    return await pg(`ALTER TABLE ${schema}.${table_name} ADD CONSTRAINT ${name} UNIQUE (${cols})`);
  }
  if (tool === 'postgres_add_check_constraint') {
    const { table_name, expression, constraint_name, schema = 'public' } = args;
    if (!table_name || !expression || !constraint_name) throw new Error('table_name, expression, and constraint_name are required');
    return await pg(`ALTER TABLE ${schema}.${table_name} ADD CONSTRAINT ${constraint_name} CHECK (${expression})`);
  }
  if (tool === 'postgres_drop_constraint') {
    const { table_name, constraint_name, schema = 'public', cascade = false } = args;
    if (!table_name || !constraint_name) throw new Error('table_name and constraint_name are required');
    return await pg(`ALTER TABLE ${schema}.${table_name} DROP CONSTRAINT IF EXISTS ${constraint_name} ${cascade ? 'CASCADE' : ''}`);
  }

  // ── VIEW MANAGEMENT ───────────────────────────────────────────────────────
  if (tool === 'postgres_create_view') {
    const { view_name, query, schema = 'public', replace = true, materialized = false } = args;
    if (!view_name || !query) throw new Error('view_name and query are required');
    let sql;
    if (materialized) {
      sql = `CREATE MATERIALIZED VIEW IF NOT EXISTS ${schema}.${view_name} AS ${query}`;
    } else {
      sql = `CREATE ${replace ? 'OR REPLACE ' : ''}VIEW ${schema}.${view_name} AS ${query}`;
    }
    return await pg(sql);
  }
  if (tool === 'postgres_drop_view') {
    const { view_name, schema = 'public', cascade = false, materialized = false } = args;
    if (!view_name) throw new Error('view_name is required');
    const type = materialized ? 'MATERIALIZED VIEW' : 'VIEW';
    return await pg(`DROP ${type} IF EXISTS ${schema}.${view_name} ${cascade ? 'CASCADE' : ''}`);
  }
  if (tool === 'postgres_refresh_materialized_view') {
    const { view_name, schema = 'public', concurrently = false } = args;
    if (!view_name) throw new Error('view_name is required');
    return await pg(`REFRESH MATERIALIZED VIEW ${concurrently ? 'CONCURRENTLY' : ''} ${schema}.${view_name}`);
  }

  // ── FUNCTION & PROCEDURE MANAGEMENT ──────────────────────────────────────
  if (tool === 'postgres_get_function_definition') {
    const result = await pg(`SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname = $1 AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = $2)`, [args.function_name, args.schema || 'public']);
    return result[0] || { error: 'Function not found' };
  }
  if (tool === 'postgres_drop_function') {
    const { function_name, signature, schema = 'public', cascade = false } = args;
    if (!function_name) throw new Error('function_name is required');
    const fullName = signature ? `${schema}.${function_name}(${signature})` : `${schema}.${function_name}`;
    return await pg(`DROP FUNCTION IF EXISTS ${fullName} ${cascade ? 'CASCADE' : ''}`);
  }

  // ── SUPER TOOL: Full permissions audit ────────────────────────────────────
  if (tool === 'postgres_permissions_audit') {
    const schema = args.schema || 'public';
    const [roles, grants, roleMembers, schemaGrants] = await Promise.all([
      pg(`SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin FROM pg_roles ORDER BY rolname`),
      pg(`SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges FROM information_schema.role_table_grants WHERE table_schema = $1 GROUP BY grantee, table_name ORDER BY grantee, table_name`, [schema]),
      pg(`SELECT r.rolname AS role, m.rolname AS member FROM pg_roles r JOIN pg_auth_members am ON r.oid = am.roleid JOIN pg_roles m ON am.member = m.oid ORDER BY r.rolname`),
      pg(`SELECT grantee, privilege_type FROM information_schema.role_schema_grants WHERE schema_name = $1`, [schema])
    ]);
    return { schema, roles, table_grants: grants, role_memberships: roleMembers, schema_grants: schemaGrants, generated_at: new Date().toISOString() };
  }

  // ── SUPER TOOL: Performance deep-dive ────────────────────────────────────
  if (tool === 'postgres_performance_report') {
    const schema = args.schema || 'public';
    const [slowQueries, missingIndexes, indexBloat, cacheHit, tableStats, lockInfo] = await Promise.all([
      pg(`SELECT LEFT(query, 150) AS query, calls, round(mean_exec_time::numeric, 2) AS avg_ms, round(total_exec_time::numeric, 2) AS total_ms FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10`).catch(() => []),
      pg(`SELECT tablename, seq_scan, idx_scan FROM pg_stat_user_tables WHERE seq_scan > 20 AND (idx_scan IS NULL OR idx_scan < seq_scan / 2) AND schemaname = $1 ORDER BY seq_scan DESC LIMIT 10`, [schema]),
      pg(`SELECT indexname, tablename, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS size FROM pg_stat_user_indexes WHERE idx_scan = 0 AND schemaname = $1 ORDER BY pg_relation_size(indexrelid) DESC LIMIT 10`, [schema]),
      pg(`SELECT round((sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100)::numeric, 2) AS cache_hit_pct FROM pg_statio_user_tables`),
      pg(`SELECT tablename, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum, last_analyze FROM pg_stat_user_tables WHERE schemaname = $1 ORDER BY n_dead_tup DESC LIMIT 10`, [schema]),
      pg(`SELECT count(*) AS blocking_locks FROM pg_locks WHERE NOT granted`)
    ]);
    return {
      schema,
      cache_hit_pct: cacheHit[0]?.cache_hit_pct,
      blocking_locks: parseInt(lockInfo[0]?.blocking_locks || 0),
      top_slow_queries: slowQueries,
      tables_needing_indexes: missingIndexes,
      unused_indexes: indexBloat,
      table_vacuum_status: tableStats,
      generated_at: new Date().toISOString()
    };
  }

  throw new Error(`Unknown Postgres tool: ${tool}`);
}

export default { execute };
