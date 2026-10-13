/**
 * Sentry Handler — 63 tools
 * Error monitoring, issue management, releases, performance,
 * teams, alerts, monitors, source maps, and Super Tools
 * for YardSync and Cortiware production apps.
 */

const BASE = 'https://sentry.io/api/0';

function headers() {
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token) throw new Error('SENTRY_AUTH_TOKEN not set in .env');
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const ORG = () => {
  const s = process.env.SENTRY_ORG_SLUG;
  if (!s) throw new Error('SENTRY_ORG_SLUG not set in .env');
  return s;
};
const PROJ = (p) => p || process.env.SENTRY_PROJECT_SLUG;
const reqProj = (p) => { const s = PROJ(p); if (!s) throw new Error('project_slug is required or set SENTRY_PROJECT_SLUG in .env'); return s; };

async function sentry(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: headers(),
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(`Sentry ${res.status}: ${data.detail || JSON.stringify(data)}`);
  return data;
}

async function execute(tool, args) {
  const { project_slug } = args;

  // ── ISSUES ────────────────────────────────────────────────────────────────
  if (tool === 'sentry_list_issues') {
    const { limit = 25, query = 'is:unresolved', sort = 'date', environment, cursor } = args;
    let path = `/organizations/${ORG()}/issues/?limit=${limit}&query=${encodeURIComponent(query)}&sort=${sort}`;
    if (PROJ(project_slug)) path += `&project=${PROJ(project_slug)}`;
    if (environment) path += `&environment=${environment}`;
    if (cursor) path += `&cursor=${cursor}`;
    const data = await sentry('GET', path);
    return (data.map ? data : []).map(i => ({
      id: i.id, title: i.title, culprit: i.culprit, status: i.status,
      count: i.count, userCount: i.userCount, firstSeen: i.firstSeen,
      lastSeen: i.lastSeen, level: i.level, project: i.project?.slug
    }));
  }
  if (tool === 'sentry_get_issue') {
    return await sentry('GET', `/organizations/${ORG()}/issues/${args.issue_id}/`);
  }
  if (tool === 'sentry_update_issue') {
    const { issue_id, status, assignedTo, hasSeen } = args;
    const body = {};
    if (status) body.status = status;
    if (assignedTo !== undefined) body.assignedTo = assignedTo;
    if (hasSeen !== undefined) body.hasSeen = hasSeen;
    return await sentry('PUT', `/organizations/${ORG()}/issues/${issue_id}/`, body);
  }
  if (tool === 'sentry_resolve_issue') {
    return await sentry('PUT', `/organizations/${ORG()}/issues/${args.issue_id}/`, { status: 'resolved' });
  }
  if (tool === 'sentry_ignore_issue') {
    return await sentry('PUT', `/organizations/${ORG()}/issues/${args.issue_id}/`, { status: 'ignored' });
  }
  if (tool === 'sentry_delete_issue') {
    return await sentry('DELETE', `/organizations/${ORG()}/issues/${args.issue_id}/`);
  }
  if (tool === 'sentry_list_issue_events') {
    return await sentry('GET', `/organizations/${ORG()}/issues/${args.issue_id}/events/?limit=${args.limit || 5}`);
  }
  if (tool === 'sentry_get_latest_event') {
    return await sentry('GET', `/organizations/${ORG()}/issues/${args.issue_id}/events/latest/`);
  }

  // Bulk update multiple issues at once
  if (tool === 'sentry_bulk_update_issues') {
    const { issue_ids, status, assignedTo } = args;
    if (!issue_ids?.length) throw new Error('issue_ids array is required');
    const body = {};
    if (status) body.status = status;
    if (assignedTo !== undefined) body.assignedTo = assignedTo;
    const query = issue_ids.map(id => `id=${id}`).join('&');
    return await sentry('PUT', `/organizations/${ORG()}/issues/?${query}`, body);
  }

  // Assign an issue to a team member
  if (tool === 'sentry_assign_issue') {
    return await sentry('PUT', `/organizations/${ORG()}/issues/${args.issue_id}/`, { assignedTo: args.username });
  }

  // List tags attached to an issue
  if (tool === 'sentry_list_issue_tags') {
    return await sentry('GET', `/organizations/${ORG()}/issues/${args.issue_id}/tags/`);
  }

  // Get values for a specific tag on an issue (e.g. all user emails affected)
  if (tool === 'sentry_get_issue_tag_values') {
    return await sentry('GET', `/organizations/${ORG()}/issues/${args.issue_id}/tags/${args.tag_key}/values/?limit=${args.limit || 20}`);
  }

  // Get event hashes (for deduplication)
  if (tool === 'sentry_get_issue_hashes') {
    return await sentry('GET', `/organizations/${ORG()}/issues/${args.issue_id}/hashes/?limit=${args.limit || 10}`);
  }

  // Merge multiple issues into one
  if (tool === 'sentry_merge_issues') {
    const { parent_issue_id, child_issue_ids } = args;
    if (!parent_issue_id || !child_issue_ids?.length) throw new Error('parent_issue_id and child_issue_ids are required');
    const ids = [parent_issue_id, ...child_issue_ids];
    const query = ids.map(id => `id=${id}`).join('&');
    return await sentry('PUT', `/organizations/${ORG()}/issues/?${query}`, { merge: 1 });
  }

  // ── EVENTS ────────────────────────────────────────────────────────────────
  if (tool === 'sentry_list_project_events') {
    const proj = reqProj(project_slug);
    return await sentry('GET', `/projects/${ORG()}/${proj}/events/?limit=${args.limit || 10}&query=${encodeURIComponent(args.query || '')}`);
  }
  if (tool === 'sentry_get_event') {
    const proj = reqProj(project_slug);
    return await sentry('GET', `/projects/${ORG()}/${proj}/events/${args.event_id}/`);
  }

  // ── PROJECTS ──────────────────────────────────────────────────────────────
  if (tool === 'sentry_list_projects') {
    return await sentry('GET', `/organizations/${ORG()}/projects/`);
  }
  if (tool === 'sentry_get_project' || tool === 'sentry_get_project_data_scrubbing') {
    return await sentry('GET', `/projects/${encodeURIComponent(ORG())}/${encodeURIComponent(reqProj(project_slug))}/`);
  }
  if (tool === 'sentry_create_project') {
    const { name, team_slug, platform } = args;
    if (!name || !team_slug) throw new Error('name and team_slug are required');
    return await sentry('POST', `/teams/${ORG()}/${team_slug}/projects/`, { name, platform: platform || 'other' });
  }
  if (tool === 'sentry_update_project') {
    const { name, platform, resolve_age, default_environment } = args;
    const body = {};
    if (name) body.name = name;
    if (platform) body.platform = platform;
    if (resolve_age !== undefined) body.resolveAge = resolve_age;
    if (default_environment) body.defaultEnvironment = default_environment;
    return await sentry('PUT', `/projects/${ORG()}/${reqProj(project_slug)}/`, body);
  }
  if (tool === 'sentry_delete_project') {
    return await sentry('DELETE', `/projects/${ORG()}/${reqProj(project_slug)}/`);
  }
  if (tool === 'sentry_get_project_stats') {
    const proj = reqProj(project_slug);
    const since = args.since || Math.floor(Date.now()/1000) - 86400;
    const until = args.until || Math.floor(Date.now()/1000);
    return await sentry('GET', `/projects/${ORG()}/${proj}/stats/?stat=${args.stat || 'received'}&since=${since}&until=${until}`);
  }
  if (tool === 'sentry_list_project_keys') {
    return await sentry('GET', `/projects/${ORG()}/${reqProj(project_slug)}/keys/`);
  }
  if (tool === 'sentry_create_project_key') {
    return await sentry('POST', `/projects/${ORG()}/${reqProj(project_slug)}/keys/`, { name: args.name || 'New Key' });
  }
  if (tool === 'sentry_delete_project_key') {
    return await sentry('DELETE', `/projects/${ORG()}/${reqProj(project_slug)}/keys/${args.key_id}/`);
  }

  // ── TEAMS ─────────────────────────────────────────────────────────────────
  if (tool === 'sentry_list_teams') {
    return await sentry('GET', `/organizations/${ORG()}/teams/`);
  }
  if (tool === 'sentry_get_team') {
    return await sentry('GET', `/teams/${ORG()}/${args.team_slug}/`);
  }
  if (tool === 'sentry_create_team') {
    if (!args.name) throw new Error('name is required');
    return await sentry('POST', `/organizations/${ORG()}/teams/`, { name: args.name, slug: args.slug });
  }
  if (tool === 'sentry_update_team') {
    const { team_slug, name } = args;
    return await sentry('PUT', `/teams/${ORG()}/${team_slug}/`, { name });
  }
  if (tool === 'sentry_delete_team') {
    return await sentry('DELETE', `/teams/${ORG()}/${args.team_slug}/`);
  }
  if (tool === 'sentry_list_team_members') {
    return await sentry('GET', `/teams/${ORG()}/${args.team_slug}/members/`);
  }

  // ── ORGANIZATION MEMBERS ──────────────────────────────────────────────────
  if (tool === 'sentry_list_members') {
    return await sentry('GET', `/organizations/${ORG()}/members/?limit=${args.limit || 50}`);
  }
  if (tool === 'sentry_get_member') {
    return await sentry('GET', `/organizations/${ORG()}/members/${args.member_id}/`);
  }

  // ── RELEASES ──────────────────────────────────────────────────────────────
  if (tool === 'sentry_list_releases') {
    let path = `/organizations/${ORG()}/releases/?limit=${args.limit || 10}`;
    if (PROJ(project_slug)) path += `&project=${PROJ(project_slug)}`;
    return await sentry('GET', path);
  }
  if (tool === 'sentry_get_release') {
    return await sentry('GET', `/organizations/${ORG()}/releases/${args.version}/`);
  }
  if (tool === 'sentry_create_release') {
    const { version, refs, projects, url, date_released } = args;
    if (!version) throw new Error('version is required');
    const body = { version, projects: projects || [reqProj(project_slug)] };
    if (refs) body.refs = refs;
    if (url) body.url = url;
    if (date_released) body.dateReleased = date_released;
    return await sentry('POST', `/organizations/${ORG()}/releases/`, body);
  }
  if (tool === 'sentry_finalize_release') {
    return await sentry('PUT', `/organizations/${ORG()}/releases/${args.version}/`, {
      projects: [reqProj(project_slug)], dateReleased: new Date().toISOString()
    });
  }
  if (tool === 'sentry_delete_release') {
    return await sentry('DELETE', `/organizations/${ORG()}/releases/${args.version}/`);
  }
  if (tool === 'sentry_list_release_commits') {
    return await sentry('GET', `/organizations/${ORG()}/releases/${args.version}/commitfiles/`);
  }
  if (tool === 'sentry_list_release_deploys') {
    return await sentry('GET', `/organizations/${ORG()}/releases/${args.version}/deploys/`);
  }
  if (tool === 'sentry_create_release_deploy') {
    const { version, environment, url, name, started_at, finished_at } = args;
    if (!version || !environment) throw new Error('version and environment are required');
    const body = { environment };
    if (url) body.url = url;
    if (name) body.name = name;
    if (started_at) body.dateStarted = started_at;
    if (finished_at) body.dateFinished = finished_at || new Date().toISOString();
    return await sentry('POST', `/organizations/${ORG()}/releases/${version}/deploys/`, body);
  }

  // ── ALERTS ────────────────────────────────────────────────────────────────
  if (tool === 'sentry_list_alert_rules') {
    return await sentry('GET', `/projects/${ORG()}/${reqProj(project_slug)}/alert-rules/`);
  }
  if (tool === 'sentry_get_alert_rule') {
    return await sentry('GET', `/projects/${ORG()}/${reqProj(project_slug)}/alert-rules/${args.alert_id}/`);
  }
  if (tool === 'sentry_delete_alert_rule') {
    return await sentry('DELETE', `/projects/${ORG()}/${reqProj(project_slug)}/alert-rules/${args.alert_id}/`);
  }
  if (tool === 'sentry_list_issue_alert_rules') {
    return await sentry('GET', `/projects/${ORG()}/${reqProj(project_slug)}/rules/`);
  }

  // ── MONITORS (cron job monitoring) ────────────────────────────────────────
  if (tool === 'sentry_list_monitors') {
    return await sentry('GET', `/organizations/${ORG()}/monitors/?limit=${args.limit || 25}`);
  }
  if (tool === 'sentry_get_monitor') {
    return await sentry('GET', `/organizations/${ORG()}/monitors/${args.monitor_slug}/`);
  }
  if (tool === 'sentry_create_monitor') {
    const { name, slug, schedule, timezone = 'UTC', checkin_margin = 5, max_runtime = 30 } = args;
    if (!name || !schedule) throw new Error('name and schedule are required (schedule: {type, value} e.g. {type: "crontab", value: "0 * * * *"})');
    return await sentry('POST', `/organizations/${ORG()}/monitors/`, {
      name, slug, type: 'cron_job',
      config: { schedule_type: schedule.type || 'crontab', schedule: schedule.value, timezone, checkin_margin, max_runtime }
    });
  }
  if (tool === 'sentry_update_monitor') {
    const { monitor_slug, name, schedule, is_muted } = args;
    const body = {};
    if (name) body.name = name;
    if (is_muted !== undefined) body.isMuted = is_muted;
    if (schedule) body.config = { schedule_type: schedule.type || 'crontab', schedule: schedule.value };
    return await sentry('PUT', `/organizations/${ORG()}/monitors/${monitor_slug}/`, body);
  }
  if (tool === 'sentry_delete_monitor') {
    return await sentry('DELETE', `/organizations/${ORG()}/monitors/${args.monitor_slug}/`);
  }
  if (tool === 'sentry_list_monitor_checkins') {
    return await sentry('GET', `/organizations/${ORG()}/monitors/${args.monitor_slug}/checkins/?limit=${args.limit || 10}`);
  }

  // ── STATS ─────────────────────────────────────────────────────────────────
  if (tool === 'sentry_get_org_stats') {
    const now = new Date();
    const start = args.start || new Date(Date.now() - 86400000).toISOString();
    const end = args.end || now.toISOString();
    return await sentry('GET', `/organizations/${ORG()}/stats_v2/?field=sum(quantity)&groupBy=outcome&category=${args.category || 'error'}&start=${start}&end=${end}`);
  }

  // ── DASHBOARDS ────────────────────────────────────────────────────────────
  if (tool === 'sentry_list_dashboards') {
    return await sentry('GET', `/organizations/${ORG()}/dashboards/?limit=${args.limit || 20}`);
  }
  if (tool === 'sentry_get_dashboard') {
    return await sentry('GET', `/organizations/${ORG()}/dashboards/${args.dashboard_id}/`);
  }

  // ── SOURCE MAPS & DEBUG FILES ─────────────────────────────────────────────
  if (tool === 'sentry_list_debug_files') {
    return await sentry('GET', `/projects/${ORG()}/${reqProj(project_slug)}/files/dsyms/?limit=${args.limit || 10}`);
  }
  if (tool === 'sentry_list_source_map_archives') {
    return await sentry('GET', `/projects/${ORG()}/${reqProj(project_slug)}/artifact-bundles/?limit=${args.limit || 10}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SUPER TOOLS
  // ══════════════════════════════════════════════════════════════════════════

  // SUPER: Triage — top unresolved errors with counts, users affected, last stack frame
  if (tool === 'sentry_triage_errors') {
    const { limit = 20, environment } = args;
    let path = `/organizations/${ORG()}/issues/?limit=${limit}&query=${encodeURIComponent('is:unresolved')}&sort=users`;
    if (PROJ(project_slug)) path += `&project=${PROJ(project_slug)}`;
    if (environment) path += `&environment=${environment}`;
    const issues = await sentry('GET', path);
    return {
      total: Array.isArray(issues) ? issues.length : 0,
      issues: (Array.isArray(issues) ? issues : []).map(i => ({
        id: i.id, title: i.title, level: i.level,
        count: i.count, users_affected: i.userCount,
        first_seen: i.firstSeen, last_seen: i.lastSeen,
        culprit: i.culprit, project: i.project?.slug
      })),
      summary: `${Array.isArray(issues) ? issues.reduce((s,i) => s+(i.userCount||0), 0) : 0} total users affected`
    };
  }

  // SUPER: Production health — error rate, recent issues, org stats
  if (tool === 'sentry_production_health') {
    const [projects, recentIssues, orgStats] = await Promise.all([
      sentry('GET', `/organizations/${ORG()}/projects/`).catch(() => []),
      sentry('GET', `/organizations/${ORG()}/issues/?limit=5&query=${encodeURIComponent('is:unresolved')}&sort=date`).catch(() => []),
      sentry('GET', `/organizations/${ORG()}/stats_v2/?field=sum(quantity)&groupBy=outcome&category=error&start=${new Date(Date.now()-3600000).toISOString()}&end=${new Date().toISOString()}`).catch(() => null)
    ]);
    return {
      projects: Array.isArray(projects) ? projects.length : 0,
      recent_unresolved_issues: (Array.isArray(recentIssues) ? recentIssues : []).map(i => ({ id: i.id, title: i.title, count: i.count, level: i.level, lastSeen: i.lastSeen })),
      error_stats_last_hour: orgStats,
      checked_at: new Date().toISOString()
    };
  }

  // SUPER: Create release + mark deployed in one call (typical CI/CD workflow)
  if (tool === 'sentry_deploy_release') {
    const { version, environment = 'production', refs, projects } = args;
    if (!version || !environment) throw new Error('version and environment are required');
    const proj = reqProj(project_slug);
    const release = await sentry('POST', `/organizations/${ORG()}/releases/`, {
      version, projects: projects || [proj],
      refs: refs || [], dateReleased: new Date().toISOString()
    }).catch(async (e) => {
      // Release may already exist — that's OK, just proceed to deploy
      if (e.message.includes('400')) return { version };
      throw e;
    });
    const deploy = await sentry('POST', `/organizations/${ORG()}/releases/${version}/deploys/`, {
      environment, dateStarted: new Date().toISOString(), dateFinished: new Date().toISOString()
    });
    return { version, environment, release_created: !!release?.id, deploy_id: deploy?.id, deployed_at: new Date().toISOString() };
  }


  // ── ISSUE ALERT RULES (notification rules) ──────────────────────────────
  if (tool === 'sentry_create_issue_alert_rule') {
    const { project_slug, name, conditions, actions, frequency = 30 } = args;
    if (!name || !conditions || !actions) throw new Error('name, conditions, and actions are required');
    return await sentry('POST', `/projects/${ORG()}/${reqProj(project_slug)}/rules/`, { name, conditions, actions, frequency });
  }
  if (tool === 'sentry_update_issue_alert_rule') {
    const { project_slug, rule_id, name, conditions, actions, frequency } = args;
    if (!rule_id) throw new Error('rule_id is required');
    const body = {};
    if (name) body.name = name;
    if (conditions) body.conditions = conditions;
    if (actions) body.actions = actions;
    if (frequency !== undefined) body.frequency = frequency;
    return await sentry('PUT', `/projects/${ORG()}/${reqProj(project_slug)}/rules/${rule_id}/`, body);
  }
  if (tool === 'sentry_delete_issue_alert_rule') {
    if (!args.rule_id) throw new Error('rule_id is required');
    return await sentry('DELETE', `/projects/${ORG()}/${reqProj(project_slug)}/rules/${args.rule_id}/`);
  }

  // ── METRIC ALERT RULES (create) ───────────────────────────────────────────
  if (tool === 'sentry_create_metric_alert_rule') {
    const { project_slug, name, aggregate, query = '', time_window = 60, threshold_type = 0, resolve_threshold, alert_threshold, dataset = 'errors' } = args;
    if (!name || !aggregate || alert_threshold === undefined) throw new Error('name, aggregate, and alert_threshold are required');
    return await sentry('POST', `/projects/${ORG()}/${reqProj(project_slug)}/alert-rules/`, {
      name, aggregate, query, timeWindow: time_window, thresholdType: threshold_type,
      resolveThreshold: resolve_threshold, triggers: [{ label: 'critical', alertThreshold: alert_threshold, actions: [] }],
      projects: [reqProj(project_slug)], dataset
    });
  }

  // ── DISCOVER (analytics queries) ──────────────────────────────────────────
  if (tool === 'sentry_run_discover_query') {
    const { project_slug, fields, query = '', orderby, limit = 50, start, end } = args;
    if (!fields?.length) throw new Error('fields array is required (e.g. ["title", "count()", "project"])');
    const params = new URLSearchParams({ project: PROJ(project_slug) || '', field: fields, query, limit, sort: orderby || '-count' });
    if (start) params.append('start', start);
    if (end) params.append('end', end);
    return await sentry('GET', `/organizations/${ORG()}/events/?${params.toString()}`);
  }

  // ── ENVIRONMENTS ──────────────────────────────────────────────────────────
  if (tool === 'sentry_list_environments') {
    const { project_slug } = args;
    const filter = project_slug ? `?project=${PROJ(project_slug)}` : '';
    return await sentry('GET', `/organizations/${ORG()}/environments/${filter}`);
  }

  // ── TAGS ──────────────────────────────────────────────────────────────────
  if (tool === 'sentry_list_project_tags') {
    return await sentry('GET', `/projects/${ORG()}/${reqProj(args.project_slug)}/tags/`);
  }
  if (tool === 'sentry_get_tag_values') {
    const { project_slug, tag_key, query, limit = 20 } = args;
    if (!tag_key) throw new Error('tag_key is required');
    let path = `/projects/${ORG()}/${reqProj(project_slug)}/tags/${tag_key}/values/?limit=${limit}`;
    if (query) path += `&query=${encodeURIComponent(query)}`;
    return await sentry('GET', path);
  }

  // ── USER FEEDBACK ────────────────────────────────────────────────────────
  if (tool === 'sentry_list_user_feedback') {
    const { project_slug, limit = 25, environment } = args;
    let path = `/projects/${ORG()}/${reqProj(project_slug)}/user-feedback/?limit=${limit}`;
    if (environment) path += `&environment=${environment}`;
    return await sentry('GET', path);
  }

  // ── UPTIME MONITORS ──────────────────────────────────────────────────────
  if (tool === 'sentry_list_uptime_subscriptions') {
    return await sentry('GET', `/projects/${ORG()}/${reqProj(args.project_slug)}/uptime/`);
  }
  if (tool === 'sentry_create_uptime_subscription') {
    const { project_slug, url, name, interval_seconds = 60, timeout_ms = 10000 } = args;
    if (!url) throw new Error('url is required');
    return await sentry('POST', `/projects/${ORG()}/${reqProj(project_slug)}/uptime/`, { url, name: name || url, intervalSeconds: interval_seconds, timeoutMs: timeout_ms });
  }
  if (tool === 'sentry_delete_uptime_subscription') {
    if (!args.uptime_subscription_id) throw new Error('uptime_subscription_id is required');
    return await sentry('DELETE', `/projects/${ORG()}/${reqProj(args.project_slug)}/uptime/${args.uptime_subscription_id}/`);
  }


  // ── PERFORMANCE (Discover-based tracing queries) ───────────────────────────
  if (tool === 'sentry_get_performance_summary') {
    // Query performance metrics: p50/p75/p95 latency, error rate, throughput
    const { project_slug, transaction, environment, start, end } = args;
    const proj = PROJ(project_slug);
    const fields = ['transaction','count()','p50(transaction.duration)','p75(transaction.duration)','p95(transaction.duration)','failure_rate()'];
    const params = new URLSearchParams({
      field: fields,
      sort: '-count()',
      limit: '25',
      query: transaction ? `transaction:${transaction}` : 'event.type:transaction',
      ...(proj ? { project: proj } : {}),
      ...(environment ? { environment } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {})
    });
    return await sentry('GET', `/organizations/${ORG()}/events/?${params.toString()}`);
  }

  if (tool === 'sentry_list_transactions') {
    // List slowest transactions by p95 latency
    const { project_slug, limit = 20, environment, query = '' } = args;
    const proj = PROJ(project_slug);
    const params = new URLSearchParams({
      field: ['transaction','count()','p95(transaction.duration)','failure_rate()'],
      sort: '-p95(transaction.duration)',
      limit: String(limit),
      query: `event.type:transaction ${query}`.trim(),
      ...(proj ? { project: proj } : {}),
      ...(environment ? { environment } : {})
    });
    return await sentry('GET', `/organizations/${ORG()}/events/?${params.toString()}`);
  }

  if (tool === 'sentry_get_span_samples') {
    // Get sample spans for a specific transaction to diagnose slow spans
    const { project_slug, transaction, environment } = args;
    if (!transaction) throw new Error('transaction is required');
    const proj = reqProj(project_slug);
    const params = new URLSearchParams({
      field: ['id','timestamp','trace','transaction.duration','spans.db','spans.http'],
      query: `transaction:${transaction} event.type:transaction`,
      limit: '10',
      project: proj,
      ...(environment ? { environment } : {})
    });
    return await sentry('GET', `/organizations/${ORG()}/events/?${params.toString()}`);
  }

  // ── SAVED SEARCHES ────────────────────────────────────────────────────────
  if (tool === 'sentry_list_saved_searches') {
    const { project_slug } = args;
    const proj = PROJ(project_slug);
    const path = proj
      ? `/projects/${ORG()}/${proj}/searches/`
      : `/organizations/${ORG()}/searches/`;
    return await sentry('GET', path);
  }

  if (tool === 'sentry_create_saved_search') {
    const { name, query, project_slug, is_global = false } = args;
    if (!name || !query) throw new Error('name and query are required');
    const proj = PROJ(project_slug);
    const path = proj
      ? `/projects/${ORG()}/${proj}/searches/`
      : `/organizations/${ORG()}/searches/`;
    return await sentry('POST', path, { name, query, isGlobal: is_global });
  }

  if (tool === 'sentry_delete_saved_search') {
    const { search_id, project_slug } = args;
    if (!search_id) throw new Error('search_id is required');
    const proj = PROJ(project_slug);
    const path = proj
      ? `/projects/${ORG()}/${proj}/searches/${search_id}/`
      : `/organizations/${ORG()}/searches/${search_id}/`;
    return await sentry('DELETE', path);
  }

  // ── SESSION REPLAYS ────────────────────────────────────────────────────────
  if (tool === 'sentry_list_replays') {
    const { project_slug, limit = 25, query, environment, sort = '-started_at' } = args;
    const proj = PROJ(project_slug);
    const params = new URLSearchParams({ limit: String(limit), sort });
    if (proj) params.set('project', proj);
    if (query) params.set('query', query);
    if (environment) params.set('environment', environment);
    const data = await sentry('GET', `/organizations/${ORG()}/replays/?${params.toString()}`);
    return {
      replays: (data.data || []).map(r => ({
        id: r.id,
        project_id: r.project_id,
        started_at: r.started_at,
        finished_at: r.finished_at,
        duration: r.duration,
        error_ids: r.error_ids?.length || 0,
        urls: r.urls?.slice(0, 3),
        user: r.user ? { email: r.user.email, id: r.user.id } : null,
        sdk: r.sdk?.name
      })),
      count: data.data?.length || 0
    };
  }

  if (tool === 'sentry_get_replay') {
    const { replay_id, project_slug } = args;
    if (!replay_id) throw new Error('replay_id is required');
    const proj = reqProj(project_slug);
    const data = await sentry('GET', `/projects/${ORG()}/${proj}/replays/${replay_id}/`);
    return data.data || data;
  }

  // ── SPIKE PROTECTION ──────────────────────────────────────────────────────
  if (tool === 'sentry_list_spike_protections') {
    const proj = reqProj(args.project_slug);
    return await sentry('GET', `/projects/${ORG()}/${proj}/spike-protections/`);
  }

  if (tool === 'sentry_enable_spike_protection') {
    const { project_slug, enabled = true } = args;
    const proj = reqProj(project_slug);
    return await sentry('POST', `/projects/${ORG()}/${proj}/spike-protections/`, { enabled });
  }

  // ── SUPER: PERFORMANCE HEALTH ─────────────────────────────────────────────
  // p95 latency + error rate + slowest transactions + recent replays with errors in one call
  if (tool === 'sentry_performance_health') {
    const { project_slug, environment } = args;
    const results = {};
    const proj = PROJ(project_slug);
    const perfParams = new URLSearchParams({
      field: ['transaction','count()','p95(transaction.duration)','failure_rate()'],
      sort: '-p95(transaction.duration)', limit: '5', query: 'event.type:transaction',
      ...(proj ? { project: proj } : {}),
      ...(environment ? { environment } : {})
    });
    await Promise.all([
      sentry('GET', `/organizations/${ORG()}/events/?${perfParams.toString()}`)
        .then(d => { results.slowest_transactions = d.data?.slice(0, 5); })
        .catch(e => { results.perf_error = e.message; }),
      sentry('GET', `/organizations/${ORG()}/issues/?limit=5&query=${encodeURIComponent('is:unresolved level:error')}&sort=date${proj ? `&project=${proj}` : ''}`)
        .then(d => { results.recent_errors = Array.isArray(d) ? d.map(i => ({ id: i.id, title: i.title, count: i.count, lastSeen: i.lastSeen })) : []; })
        .catch(e => { results.errors_error = e.message; }),
    ]);
    results.checked_at = new Date().toISOString();
    return results;
  }



  // ── DATA SCRUBBING / PII ──────────────────────────────────────────────────
  if (tool === 'sentry_get_data_scrubbing_config') {
    return await sentry('GET', `/organizations/${ORG()}/data-scrubbing/`);
  }
  if (tool === 'sentry_update_data_scrubbing_config') {
    const { require_scrub_data, require_scrub_defaults, sensitive_fields, safe_fields, scrub_ip_addresses, scrub_defaults } = args;
    const body = {};
    if (require_scrub_data !== undefined) body.requiresScrubData = require_scrub_data;
    if (require_scrub_defaults !== undefined) body.requiresScrubDefaults = require_scrub_defaults;
    if (sensitive_fields) body.sensitiveFields = sensitive_fields;
    if (safe_fields) body.safeFields = safe_fields;
    if (scrub_ip_addresses !== undefined) body.scrubIPAddresses = scrub_ip_addresses;
    if (scrub_defaults !== undefined) body.scrubDefaults = scrub_defaults;
    return await sentry('PUT', `/organizations/${ORG()}/data-scrubbing/`, body);
  }

  // ── RETENTION RULES ───────────────────────────────────────────────────────
  if (tool === 'sentry_list_org_rules') {
    return await sentry('GET', `/organizations/${ORG()}/rules/`);
  }
  if (tool === 'sentry_create_org_inbound_filter') {
    const p = reqProj(project_slug);
    const { filter_id, active = true, subfilters } = args;
    if (!filter_id) throw new Error('filter_id is required (browser-extensions, localhost, legacy-browsers, web-crawlers)');
    const body = { active };
    if (subfilters) body.subfilters = subfilters;
    return await sentry('PUT', `/projects/${ORG()}/${p}/filters/${filter_id}/`, body);
  }
  if (tool === 'sentry_list_inbound_filters') {
    const p = reqProj(project_slug);
    return await sentry('GET', `/projects/${ORG()}/${p}/filters/`);
  }

  // ── CODEOWNERS ────────────────────────────────────────────────────────────
  if (tool === 'sentry_get_codeowners') {
    const p = reqProj(project_slug);
    return await sentry('GET', `/projects/${ORG()}/${p}/codeowners/`);
  }
  if (tool === 'sentry_create_codeowners') {
    const { raw, code_mapping_id } = args;
    const p = reqProj(project_slug);
    if (!raw) throw new Error('raw codeowners content is required');
    return await sentry('POST', `/projects/${ORG()}/${p}/codeowners/`, { raw, codeMappingId: code_mapping_id });
  }
  if (tool === 'sentry_update_codeowners') {
    const { codeowners_id, raw } = args;
    const p = reqProj(project_slug);
    if (!codeowners_id || !raw) throw new Error('codeowners_id and raw are required');
    return await sentry('PUT', `/projects/${ORG()}/${p}/codeowners/${codeowners_id}/`, { raw });
  }

  // ── DASHBOARDS CRUD ───────────────────────────────────────────────────────
  if (tool === 'sentry_create_dashboard') {
    const { title, widgets } = args;
    if (!title) throw new Error('title is required');
    const body = { title };
    if (widgets) body.widgets = widgets;
    return await sentry('POST', `/organizations/${ORG()}/dashboards/`, body);
  }
  if (tool === 'sentry_update_dashboard') {
    const { dashboard_id, title, widgets } = args;
    if (!dashboard_id) throw new Error('dashboard_id is required');
    const body = {};
    if (title) body.title = title;
    if (widgets) body.widgets = widgets;
    return await sentry('PUT', `/organizations/${ORG()}/dashboards/${dashboard_id}/`, body);
  }
  if (tool === 'sentry_delete_dashboard') {
    return await sentry('DELETE', `/organizations/${ORG()}/dashboards/${args.dashboard_id}/`);
  }

  // ── NOTIFICATION ACTIONS ──────────────────────────────────────────────────
  if (tool === 'sentry_list_notification_actions') {
    return await sentry('GET', `/organizations/${ORG()}/notifications/actions/`);
  }
  if (tool === 'sentry_create_notification_action') {
    const { trigger_type, service_type, target_display, target_identifier, target_type, integration_id, sentry_app_id, projects } = args;
    if (!trigger_type || !service_type || !target_type) throw new Error('trigger_type, service_type, and target_type are required');
    const body = { triggerType: trigger_type, serviceType: service_type, targetType: target_type };
    if (target_display) body.targetDisplay = target_display;
    if (target_identifier) body.targetIdentifier = target_identifier;
    if (integration_id) body.integrationId = integration_id;
    if (sentry_app_id) body.sentryAppId = sentry_app_id;
    if (projects) body.projects = projects;
    return await sentry('POST', `/organizations/${ORG()}/notifications/actions/`, body);
  }
  if (tool === 'sentry_delete_notification_action') {
    return await sentry('DELETE', `/organizations/${ORG()}/notifications/actions/${args.action_id}/`);
  }

  // ── ORG SETTINGS ─────────────────────────────────────────────────────────
  if (tool === 'sentry_get_org') {
    return await sentry('GET', `/organizations/${ORG()}/`);
  }
  if (tool === 'sentry_update_org') {
    const { name, slug, ...settings } = args;
    const body = {};
    if (name) body.name = name;
    if (slug) body.slug = slug;
    Object.assign(body, settings);
    return await sentry('PUT', `/organizations/${ORG()}/`, body);
  }
  if (tool === 'sentry_get_org_integrations') {
    return await sentry('GET', `/organizations/${ORG()}/integrations/`);
  }

  // ── PROJECT OWNERSHIP ─────────────────────────────────────────────────────
  if (tool === 'sentry_get_ownership_rules') {
    const p = reqProj(project_slug);
    return await sentry('GET', `/projects/${ORG()}/${p}/ownership/`);
  }
  if (tool === 'sentry_update_ownership_rules') {
    const { raw, fallthrough, auto_assignment } = args;
    const p = reqProj(project_slug);
    const body = {};
    if (raw !== undefined) body.raw = raw;
    if (fallthrough !== undefined) body.fallthrough = fallthrough;
    if (auto_assignment !== undefined) body.autoAssignment = auto_assignment;
    return await sentry('PUT', `/projects/${ORG()}/${p}/ownership/`, body);
  }

  // ── ISSUE GROUPING ────────────────────────────────────────────────────────
  if (tool === 'sentry_list_grouping_configs') {
    return await sentry('GET', `/organizations/${ORG()}/grouping-configs/`);
  }
  if (tool === 'sentry_update_project_grouping') {
    const { grouping_config, secondary_grouping_config, secondary_grouping_expiry } = args;
    const p = reqProj(project_slug);
    const body = {};
    if (grouping_config) body.groupingConfig = grouping_config;
    if (secondary_grouping_config) body.secondaryGroupingConfig = secondary_grouping_config;
    if (secondary_grouping_expiry) body.secondaryGroupingExpiry = secondary_grouping_expiry;
    return await sentry('PUT', `/projects/${ORG()}/${p}/`, body);
  }

  // ── SUPER TOOL: Org security posture ─────────────────────────────────────
  if (tool === 'sentry_org_security_posture') {
    const [org, members, projects, integrations] = await Promise.all([
      sentry('GET', `/organizations/${ORG()}/`),
      sentry('GET', `/organizations/${ORG()}/members/?limit=25`),
      sentry('GET', `/organizations/${ORG()}/projects/`),
      sentry('GET', `/organizations/${ORG()}/integrations/`).catch(() => [])
    ]);
    const memberList = Array.isArray(members) ? members : (members.results || []);
    const projectList = Array.isArray(projects) ? projects : (projects.results || []);
    const integrationList = Array.isArray(integrations) ? integrations : [];
    const twoFACount = memberList.filter(m => m.user?.has2fa).length;
    return {
      org: { name: org.name, slug: org.slug, plan: org.plan, member_count: org.stats?.members || memberList.length },
      security: {
        two_fa_members: twoFACount,
        total_members: memberList.length,
        two_fa_coverage_pct: memberList.length > 0 ? Math.round(twoFACount / memberList.length * 100) : 0,
        require_2fa: org.require2FA,
        scrub_ip_addresses: org.scrubIPAddresses,
        safe_fields: org.safeFields,
        sensitive_fields: org.sensitiveFields
      },
      projects_count: projectList.length,
      integrations: integrationList.map(i => ({ name: i.name, status: i.status })),
      generated_at: new Date().toISOString()
    };
  }

  // ── SUPER TOOL: Alert coverage audit ─────────────────────────────────────
  if (tool === 'sentry_alert_coverage_audit') {
    const [projects, issueAlerts, metricAlerts, monitors] = await Promise.all([
      sentry('GET', `/organizations/${ORG()}/projects/`),
      sentry('GET', `/organizations/${ORG()}/combined-rules/?limit=100`).catch(() => []),
      sentry('GET', `/organizations/${ORG()}/alert-rules/?limit=100`).catch(() => []),
      sentry('GET', `/organizations/${ORG()}/monitors/?limit=50`).catch(() => [])
    ]);
    const projectList = Array.isArray(projects) ? projects : (projects.results || []);
    const issueAlertList = Array.isArray(issueAlerts) ? issueAlerts : [];
    const metricAlertList = Array.isArray(metricAlerts) ? metricAlerts : [];
    const monitorList = Array.isArray(monitors) ? monitors : [];
    const coveredProjects = new Set([
      ...issueAlertList.map(a => a.projects?.[0]),
      ...metricAlertList.map(a => a.projects?.[0])
    ].filter(Boolean));
    return {
      total_projects: projectList.length,
      projects_with_alerts: coveredProjects.size,
      uncovered_projects: projectList.filter(p => !coveredProjects.has(p.slug)).map(p => p.slug),
      issue_alert_count: issueAlertList.length,
      metric_alert_count: metricAlertList.length,
      cron_monitor_count: monitorList.length,
      generated_at: new Date().toISOString()
    };
  }

    throw new Error(`Unknown Sentry tool: ${tool}`);
}

export default { execute };
