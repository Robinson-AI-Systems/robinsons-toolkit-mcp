import { currentWorkspace, currentDispatcher } from '../src/core/context.js';
/**
 * Compound Handler — 36 macro tools
 * Cross-service Super Tools that orchestrate multiple APIs in a single call.
 * These are the "power moves" — one tool replaces 5-10 individual calls.
 */

import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import {rollbackTransaction} from '../src/core/transactions.js';



async function loadHandler(name) {
  const dispatch = currentDispatcher();
  if (dispatch) return { execute: (tool, args) => dispatch(tool, args) };
  const { default: handler } = await import(`./${name}.js`);
  return handler;
}

async function execute(tool, args) {

  // ── FEATURE SCAFFOLDING ───────────────────────────────────────────────────
  if (tool === 'compound_scaffold_feature') {
    const { github_owner, github_repo, feature_name, neon_project_id, run_migrations = false, migration_command = 'npx prisma db push', env_file_path } = args;
    const results = { feature: feature_name, steps: [] };
    try {
      const gh = await loadHandler('github');
      const branch = await gh.execute('github_create_branch', { owner: github_owner, repo: github_repo, branch: `feature/${feature_name}`, from_branch: 'main' });
      results.steps.push({ step: 'github_branch', success: true, branch: `feature/${feature_name}`, sha: branch.object?.sha });
    } catch (e) { results.steps.push({ step: 'github_branch', success: false, error: e.message }); }
    try {
      const neon = await loadHandler('neon');
      const neonBranch = await neon.execute('neon_create_branch', { project_id: neon_project_id, branch_name: `feature-${feature_name}` });
      results.neon_branch = neonBranch;
      results.steps.push({ step: 'neon_branch', success: true, branch_name: `feature-${feature_name}` });
      const connInfo = await neon.execute('neon_get_connection_string', { project_id: neon_project_id, branch_id: neonBranch.branch?.id, database: 'neondb' });
      results.connection_string = connInfo.connection_string;
      results.steps.push({ step: 'connection_string', success: true, host: connInfo.host });
      if (connInfo.connection_string) {
        const envPath = env_file_path ? join(currentWorkspace(), env_file_path) : join(currentWorkspace(), '.env.local');
        let content = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
        const newLine = `DATABASE_URL=${connInfo.connection_string}`;
        if (/^DATABASE_URL=.*/m.test(content)) content = content.replace(/^DATABASE_URL=.*/m, newLine);
        else content = content.trimEnd() + '\n' + newLine + '\n';
        writeFileSync(envPath, content);
        results.steps.push({ step: 'env_updated', success: true, path: envPath });
      }
      if (run_migrations && connInfo.connection_string) {
        const result = execSync(migration_command, { cwd: currentWorkspace(), env: { ...process.env, DATABASE_URL: connInfo.connection_string }, timeout: 120000, encoding: 'utf-8' });
        results.steps.push({ step: 'migrations', success: true, output: result.slice(0, 1000) });
      }
    } catch (e) { results.steps.push({ step: 'neon_or_env', success: false, error: e.message }); }
    const allSucceeded = results.steps.every(s => s.success);
    return { ...results, status: allSucceeded ? 'ready' : 'partial', message: allSucceeded ? `Feature environment for "${feature_name}" is ready.` : 'Some steps failed.' };
  }

  // ── SAFE DEPLOY ───────────────────────────────────────────────────────────
  if (tool === 'compound_safe_deploy') {
    const { vercel_project_id, git_push = false, project_path } = args;
    const results = { steps: [] };
    if (git_push && project_path) {
      try { execSync('git push', { cwd: join(currentWorkspace(), project_path), timeout: 30000, encoding: 'utf-8' }); results.steps.push({ step: 'git_push', success: true }); }
      catch (e) { results.steps.push({ step: 'git_push', success: false, error: e.message }); }
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
    try {
      const vercel = await loadHandler('vercel');
      const deployments = await vercel.execute('vercel_list_deployments', { projectId: vercel_project_id, limit: 3 });
      const latest = deployments.deployments?.[0];
      results.latest_deployment = latest;
      results.steps.push({ step: 'deployment_check', success: true, state: latest?.state, url: latest?.url ? `https://${latest.url}` : null });
    } catch (e) { results.steps.push({ step: 'deployment_check', success: false, error: e.message }); }
    return results;
  }

  // ── ONBOARD NEW SAAS CUSTOMER ─────────────────────────────────────────────
  if (tool === 'compound_onboard_saas_customer') {
    const { customer_email, customer_name, company_name, price_id, send_welcome_email = true, welcome_from, welcome_subject, welcome_html } = args;
    const results = { email: customer_email, company: company_name, steps: [] };
    try {
      const stripe = await loadHandler('stripe');
      const customer = await stripe.execute('stripe_create_customer', { email: customer_email, name: customer_name, metadata: { company: company_name } });
      results.stripe_customer_id = customer.id;
      results.steps.push({ step: 'stripe_customer', success: true, id: customer.id });
      if (price_id) {
        const sub = await stripe.execute('stripe_create_subscription', { customer_id: customer.id, price_id });
        results.stripe_subscription_id = sub.id;
        results.steps.push({ step: 'stripe_subscription', success: true, id: sub.id, status: sub.status });
      }
    } catch (e) { results.steps.push({ step: 'stripe', success: false, error: e.message }); }
    if (company_name) {
      try {
        const clerk = await loadHandler('clerk');
        const org = await clerk.execute('clerk_create_organization', { name: company_name });
        results.clerk_org_id = org.id;
        results.steps.push({ step: 'clerk_org', success: true, id: org.id });
      } catch (e) { results.steps.push({ step: 'clerk_org', success: false, error: e.message }); }
    }
    if (send_welcome_email && welcome_from) {
      try {
        const resend = await loadHandler('resend');
        await resend.execute('resend_send_email', { from: welcome_from, to: customer_email, subject: welcome_subject || 'Welcome!', html: welcome_html || '<p>Welcome aboard!</p>' });
        results.steps.push({ step: 'welcome_email', success: true });
      } catch (e) { results.steps.push({ step: 'welcome_email', success: false, error: e.message }); }
    }
    return { ...results, status: results.steps.every(s => s.success) ? 'complete' : 'partial' };
  }

  // ── INCIDENT RESPONSE ─────────────────────────────────────────────────────
  if (tool === 'compound_incident_response') {
    const { sentry_project, vercel_project_id, last_n_deployments = 3 } = args;
    const results = {};
    try { const sentry = await loadHandler('sentry'); results.sentry_issues = await sentry.execute('sentry_list_issues', { project_slug: sentry_project, limit: 5, query: 'is:unresolved' }); } catch (e) { results.sentry_error = e.message; }
    try { const vercel = await loadHandler('vercel'); results.recent_deployments = await vercel.execute('vercel_list_deployments', { projectId: vercel_project_id, limit: last_n_deployments }); } catch (e) { results.vercel_error = e.message; }
    return { ...results, message: 'Check sentry_issues for errors and recent_deployments for recent changes.' };
  }

  // ── NEON SAFE MIGRATION ───────────────────────────────────────────────────
  if (tool === 'compound_neon_safe_migration') {
    const { neon_project_id, migration_sql, database = 'neondb', verify_tables = [] } = args;
    const results = { project_id: neon_project_id };
    const neon = await loadHandler('neon');
    const tempBranchName = `migration-test-${Date.now()}`;
    const branchRes = await neon.execute('neon_create_branch', { project_id: neon_project_id, branch_name: tempBranchName });
    results.temp_branch = branchRes.branch?.id;
    results.temp_branch_name = tempBranchName;
    try {
      const sqlResult = await neon.execute('neon_run_sql', { project_id: neon_project_id, branch_id: branchRes.branch?.id, sql: migration_sql, database });
      results.migration_result = sqlResult;
      results.migration_success = true;
      if (verify_tables.length) {
        const tablesResult = await neon.execute('neon_get_database_tables', { project_id: neon_project_id, branch_id: branchRes.branch?.id, database });
        const existingTables = (tablesResult.rows || tablesResult).map(r => r.tablename || r.table_name);
        results.verified_tables = verify_tables.filter(t => existingTables.includes(t));
        results.missing_tables = verify_tables.filter(t => !existingTables.includes(t));
      }
      results.status = 'ready_to_apply';
    } catch (e) {
      results.migration_success = false; results.migration_error = e.message; results.status = 'failed';
      try { await neon.execute('neon_delete_branch', { project_id: neon_project_id, branch_id: branchRes.branch?.id }); } catch {}
    }
    return results;
  }

  // ── GIT COMMIT AND PUSH ────────────────────────────────────────────────────
  if (tool === 'compound_git_commit_push') {
    const { project_path, message, files = '.', branch } = args;
    const cwd = join(currentWorkspace(), project_path || '');
    const steps = [];
    try { execSync(`git add ${files}`, { cwd, encoding: 'utf-8' }); steps.push({ step: 'git add', success: true }); } catch (e) { steps.push({ step: 'git add', success: false, error: e.message }); return { steps }; }
    try { const out = execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd, encoding: 'utf-8' }); steps.push({ step: 'git commit', success: true, output: out.trim() }); }
    catch (e) {
      if (e.message.includes('nothing to commit')) return { steps: [{ step: 'git commit', success: true, note: 'Nothing to commit' }] };
      steps.push({ step: 'git commit', success: false, error: e.message }); return { steps };
    }
    try { const out = execSync(`git push ${branch ? `origin ${branch}` : 'origin HEAD'}`, { cwd, encoding: 'utf-8' }); steps.push({ step: 'git push', success: true, output: out.trim() }); } catch (e) { steps.push({ step: 'git push', success: false, error: e.message }); }
    return { steps, all_succeeded: steps.every(s => s.success) };
  }

  // ── PROJECT HEALTH CHECK ──────────────────────────────────────────────────
  if (tool === 'compound_project_health_check') {
    const { github_owner, github_repo, vercel_project_id, neon_project_id, sentry_project } = args;
    const health = {};
    if (github_owner && github_repo) {
      try {
        const gh = await loadHandler('github');
        const [issues, prs] = await Promise.all([gh.execute('github_list_issues', { owner: github_owner, repo: github_repo, state: 'open', per_page: 5 }), gh.execute('github_list_pull_requests', { owner: github_owner, repo: github_repo, state: 'open', per_page: 5 })]);
        health.github = { open_issues: issues.length, open_prs: prs.length };
      } catch (e) { health.github_error = e.message; }
    }
    if (vercel_project_id) {
      try { const vercel = await loadHandler('vercel'); const d = await vercel.execute('vercel_list_deployments', { projectId: vercel_project_id, limit: 3 }); health.vercel = { recent: d.deployments?.slice(0,3).map(x => ({ state: x.state, url: x.url })) }; } catch (e) { health.vercel_error = e.message; }
    }
    if (neon_project_id) {
      try { const neon = await loadHandler('neon'); const test = await neon.execute('neon_test_connection', { project_id: neon_project_id }); health.neon = { connected: true }; } catch (e) { health.neon = { connected: false, error: e.message }; }
    }
    if (sentry_project) {
      try { const sentry = await loadHandler('sentry'); const issues = await sentry.execute('sentry_list_issues', { project_slug: sentry_project, limit: 3 }); health.sentry = { recent_errors: issues.length || 0 }; } catch (e) { health.sentry_error = e.message; }
    }
    return { health, checked_at: new Date().toISOString() };
  }

  // ── SEND DISPATCH NOTIFICATION ────────────────────────────────────────────
  if (tool === 'compound_send_dispatch_notification') {
    const { driver_phone, customer_email, job_details, driver_message, customer_subject, customer_html, from_email } = args;
    const results = { steps: [] };
    if (driver_phone && driver_message) {
      try { const twilio = await loadHandler('twilio'); await twilio.execute('twilio_send_sms', { to: driver_phone, body: driver_message }); results.steps.push({ step: 'driver_sms', success: true }); } catch (e) { results.steps.push({ step: 'driver_sms', success: false, error: e.message }); }
    }
    if (customer_email && from_email) {
      try { const resend = await loadHandler('resend'); await resend.execute('resend_send_email', { from: from_email, to: customer_email, subject: customer_subject || 'Your Service Appointment', html: customer_html || '<p>Your appointment is scheduled.</p>' }); results.steps.push({ step: 'customer_email', success: true }); } catch (e) { results.steps.push({ step: 'customer_email', success: false, error: e.message }); }
    }
    return { ...results, all_sent: results.steps.every(s => s.success) };
  }

  // ── GENERATE AND EMBED ────────────────────────────────────────────────────
  if (tool === 'compound_generate_and_embed') {
    const { text_to_embed, collection_name, point_id, metadata } = args;
    if (!text_to_embed || !collection_name || !point_id) throw new Error('text_to_embed, collection_name, and point_id are required');
    const openai = await loadHandler('openai');
    const embeddingRes = await openai.execute('openai_create_embedding', { input: text_to_embed });
    const vector = embeddingRes.embeddings?.[0];
    if (!vector) throw new Error('Failed to generate embedding');
    const qdrant = await loadHandler('qdrant');
    await qdrant.execute('qdrant_upsert_points', { collection_name, points: [{ id: point_id, vector, payload: { text: text_to_embed, ...metadata } }] });
    return { success: true, point_id, collection_name, vector_dimensions: vector.length };
  }

  // ── SEMANTIC SEARCH ───────────────────────────────────────────────────────
  if (tool === 'compound_semantic_search') {
    const { query, collection_name, limit = 5, score_threshold, filter } = args;
    if (!query || !collection_name) throw new Error('query and collection_name are required');
    const openai = await loadHandler('openai');
    const embeddingRes = await openai.execute('openai_create_embedding', { input: query });
    const vector = embeddingRes.embeddings?.[0];
    if (!vector) throw new Error('Failed to generate query embedding');
    const qdrant = await loadHandler('qdrant');
    const results = await qdrant.execute('qdrant_search', { collection_name, vector, limit, score_threshold, filter, with_payload: true });
    return { query, results: results.map ? results.map(r => ({ id: r.id, score: r.score, payload: r.payload })) : results };
  }

  // ── ANALYTICS SNAPSHOT ────────────────────────────────────────────────────
  if (tool === 'compound_analytics_snapshot') {
    const snapshot = {};
    try {
      const stripe = await loadHandler('stripe');
      const mrr = await stripe.execute('stripe_get_mrr_summary', {});
      snapshot.stripe = { mrr_usd: mrr.mrr_usd, arr_usd: mrr.arr_usd, active_subscriptions: mrr.active_subscriptions };
    } catch (e) { snapshot.stripe_error = e.message; }
    return { snapshot, generated_at: new Date().toISOString() };
  }

  // ── DEPLOY AND RELEASE ────────────────────────────────────────────────────
  // Deploy to Vercel + create Sentry release + log deployment
  if (tool === 'compound_deploy_and_release') {
    const { version, project_path, vercel_project_id, sentry_project, environment = 'production', git_push = true } = args;
    if (!version) throw new Error('version is required (e.g. "1.2.0" or git SHA)');
    const results = { version, steps: [] };

    if (git_push && project_path) {
      try { execSync('git push', { cwd: join(currentWorkspace(), project_path), timeout: 30000, encoding: 'utf-8' }); results.steps.push({ step: 'git_push', success: true }); }
      catch (e) { results.steps.push({ step: 'git_push', success: false, error: e.message }); }
    }

    if (sentry_project) {
      try {
        const sentry = await loadHandler('sentry');
        await sentry.execute('sentry_deploy_release', { version, environment, project_slug: sentry_project });
        results.steps.push({ step: 'sentry_release', success: true, version, environment });
      } catch (e) { results.steps.push({ step: 'sentry_release', success: false, error: e.message }); }
    }

    if (vercel_project_id) {
      await new Promise(r => setTimeout(r, 5000));
      try {
        const vercel = await loadHandler('vercel');
        const d = await vercel.execute('vercel_list_deployments', { projectId: vercel_project_id, limit: 1 });
        const latest = d.deployments?.[0];
        results.deployment = { state: latest?.state, url: latest?.url ? `https://${latest.url}` : null };
        results.steps.push({ step: 'vercel_deploy', success: true, state: latest?.state });
      } catch (e) { results.steps.push({ step: 'vercel_deploy', success: false, error: e.message }); }
    }

    return { ...results, all_succeeded: results.steps.every(s => s.success) };
  }

  // ── CUSTOMER OFFBOARDING ──────────────────────────────────────────────────
  // Cancel Stripe sub + ban Clerk user + add to Sentry breadcrumb
  if (tool === 'compound_customer_offboard') {
    const { stripe_customer_id, clerk_user_id, reason = 'cancellation', notify_email, from_email, app_name = 'our service' } = args;
    const results = { steps: [] };

    if (stripe_customer_id) {
      try {
        const stripe = await loadHandler('stripe');
        const subs = await stripe.execute('stripe_list_subscriptions', { customer_id: stripe_customer_id, status: 'active', limit: 5 });
        for (const sub of subs.data || []) {
          await stripe.execute('stripe_cancel_subscription', { subscription_id: sub.id, at_period_end: false });
          results.steps.push({ step: 'cancel_subscription', success: true, sub_id: sub.id });
        }
      } catch (e) { results.steps.push({ step: 'cancel_subscription', success: false, error: e.message }); }
    }

    if (clerk_user_id) {
      try {
        const clerk = await loadHandler('clerk');
        await clerk.execute('clerk_offboard_user', { user_id: clerk_user_id });
        results.steps.push({ step: 'clerk_offboard', success: true });
      } catch (e) { results.steps.push({ step: 'clerk_offboard', success: false, error: e.message }); }
    }

    if (notify_email && from_email) {
      try {
        const resend = await loadHandler('resend');
        await resend.execute('resend_send_email', { from: from_email, to: notify_email, subject: `Account deactivated — ${app_name}`, html: `<p>Your account has been deactivated. Reason: ${reason}. Contact support if this was an error.</p>` });
        results.steps.push({ step: 'offboard_email', success: true });
      } catch (e) { results.steps.push({ step: 'offboard_email', success: false, error: e.message }); }
    }

    return { ...results, offboarded: results.steps.filter(s => s.success).length > 0 };
  }

  // ── PAYMENT FAILED DUNNING ────────────────────────────────────────────────
  // Find past-due Stripe subscriptions and send reminder emails
  if (tool === 'compound_payment_failed_flow') {
    const { from_email, subject, app_name = 'our service', update_url } = args;
    if (!from_email) throw new Error('from_email is required');

    const stripe = await loadHandler('stripe');
    const pastDue = await stripe.execute('stripe_dunning_check', {});
    const results = { past_due_count: pastDue.past_due_count, emails_sent: 0, failed: [] };

    const resend = await loadHandler('resend');
    for (const sub of pastDue.subscriptions || []) {
      if (!sub.customer_email) continue;
      try {
        await resend.execute('resend_send_email', {
          from: from_email, to: sub.customer_email,
          subject: subject || `Action required: Update your payment for ${app_name}`,
          html: `<p>Hi ${sub.customer_name || 'there'},</p><p>Your payment for ${app_name} failed. Please ${update_url ? `<a href="${update_url}">update your payment method</a>` : 'update your payment method'} to avoid service interruption.</p><p>Amount due: $${sub.amount}</p>`
        });
        results.emails_sent++;
      } catch (e) { results.failed.push({ email: sub.customer_email, error: e.message }); }
    }
    return results;
  }

  // ── CUSTOMER SUPPORT CONTEXT ──────────────────────────────────────────────
  // Pull together everything about a customer for a support agent
  if (tool === 'compound_customer_support_context') {
    const { email, stripe_customer_id, clerk_user_id, sentry_project } = args;
    const context = { email };

    if (stripe_customer_id) {
      try {
        const stripe = await loadHandler('stripe');
        context.billing = await stripe.execute('stripe_customer_billing_summary', { customer_id: stripe_customer_id });
      } catch (e) { context.billing_error = e.message; }
    }

    if (clerk_user_id) {
      try {
        const clerk = await loadHandler('clerk');
        context.auth = await clerk.execute('clerk_get_user_profile', { user_id: clerk_user_id });
      } catch (e) { context.auth_error = e.message; }
    }

    if (sentry_project && email) {
      try {
        const sentry = await loadHandler('sentry');
        context.recent_errors = await sentry.execute('sentry_list_issues', { project_slug: sentry_project, limit: 5, query: `is:unresolved user.email:${email}` });
      } catch (e) { context.errors_error = e.message; }
    }

    return { ...context, generated_at: new Date().toISOString() };
  }

  // ── LOCAL LLM RAG ─────────────────────────────────────────────────────────
  // Embed query locally (Ollama) → search Qdrant → generate answer with context (Ollama)
  if (tool === 'compound_local_llm_rag') {
    const { query, collection_name, ollama_model, system_instruction, limit = 3, score_threshold = 0.6 } = args;
    if (!query || !collection_name) throw new Error('query and collection_name are required');

    const ollama = await loadHandler('ollama');
    const embedRes = await ollama.execute('ollama_embed', { input: query });
    const vector = Array.isArray(embedRes.embeddings) ? embedRes.embeddings : embedRes.embeddings?.[0];
    if (!vector) throw new Error('Ollama embedding failed');

    const qdrant = await loadHandler('qdrant');
    const searchResults = await qdrant.execute('qdrant_search', { collection_name, vector, limit, score_threshold, with_payload: true });
    const contexts = (Array.isArray(searchResults) ? searchResults : []).map(r => r.payload?.text || JSON.stringify(r.payload)).filter(Boolean);

    if (!contexts.length) return { query, answer: 'No relevant context found.', sources: [] };

    const contextText = contexts.map((c, i) => `[${i+1}] ${c}`).join('\n\n');
    const prompt = `Based on the following context, answer the question.\n\nContext:\n${contextText}\n\nQuestion: ${query}`;
    const genRes = await ollama.execute('ollama_generate', { model: ollama_model, prompt, system_instruction: system_instruction || 'Answer based only on the provided context. Be concise.' });

    return { query, answer: genRes.text, sources: searchResults.map ? searchResults.slice(0, limit).map(r => ({ id: r.id, score: r.score })) : [], model: genRes.model };
  }

  // ── SYNC USERS TO RESEND AUDIENCE ─────────────────────────────────────────
  // Get users from Clerk (or Neon) and sync them to a Resend audience
  if (tool === 'compound_sync_users_to_audience') {
    const { audience_name, source = 'clerk', neon_project_id, neon_sql, limit = 100 } = args;
    if (!audience_name) throw new Error('audience_name is required');

    let users = [];
    if (source === 'clerk') {
      const clerk = await loadHandler('clerk');
      const result = await clerk.execute('clerk_list_users', { limit });
      users = (result || []).map(u => ({ email: u.email_addresses?.[0]?.email_address, first_name: u.first_name, last_name: u.last_name })).filter(u => u.email);
    } else if (source === 'neon' && neon_project_id && neon_sql) {
      const neon = await loadHandler('neon');
      const result = await neon.execute('neon_run_sql', { project_id: neon_project_id, sql: neon_sql });
      users = (result.rows || result).map(r => ({ email: r.email, first_name: r.first_name, last_name: r.last_name })).filter(u => u.email);
    }

    const resend = await loadHandler('resend');
    const subscribeResult = await resend.execute('resend_add_subscriber', { audience_name, email: users[0]?.email, first_name: users[0]?.first_name }).catch(() => null);
    // Find or create audience
    const audienceSearch = await resend.execute('resend_find_audience_by_name', { name: audience_name }).catch(() => null);
    const audienceId = audienceSearch?.id;

    let synced = 0, failed = 0;
    if (audienceId) {
      const bulkResult = await resend.execute('resend_bulk_create_contacts', { audience_id: audienceId, contacts: users });
      synced = bulkResult.created || 0;
      failed = bulkResult.failed || 0;
    }

    return { audience_name, users_found: users.length, synced, failed };
  }

  // ── GEOCODE AND STORE (YardSync) ──────────────────────────────────────────
  // Geocode an address and store coordinates in a Neon/Postgres table
  if (tool === 'compound_geocode_and_store') {
    const { address, neon_project_id, table_name = 'locations', record_id, schema = 'public', lat_col = 'latitude', lng_col = 'longitude', address_col = 'normalized_address' } = args;
    if (!address) throw new Error('address is required');

    const mapbox = await loadHandler('mapbox');
    const geo = await mapbox.execute('mapbox_address_to_coordinates', { address });
    if (!geo.found) return { success: false, address, reason: 'Address not found' };

    if (neon_project_id && record_id) {
      const neon = await loadHandler('neon');
      await neon.execute('neon_run_sql', {
        project_id: neon_project_id,
        sql: `UPDATE ${schema}.${table_name} SET ${lat_col} = ${geo.latitude}, ${lng_col} = ${geo.longitude}, ${address_col} = '${geo.place_name.replace(/'/g, "''")}'WHERE id = ${record_id}`
      });
      return { success: true, record_id, latitude: geo.latitude, longitude: geo.longitude, normalized_address: geo.place_name };
    }

    return { success: true, latitude: geo.latitude, longitude: geo.longitude, normalized_address: geo.place_name };
  }

  // ── REVENUE SUMMARY ───────────────────────────────────────────────────────
  // Stripe MRR + recent signups + failed payments in one shot
  if (tool === 'compound_revenue_summary') {
    const results = {};
    try {
      const stripe = await loadHandler('stripe');
      const [revenue, pastDue] = await Promise.all([
        stripe.execute('stripe_revenue_summary', {}),
        stripe.execute('stripe_dunning_check', {})
      ]);
      results.revenue = revenue;
      results.past_due = { count: pastDue.past_due_count, customers: pastDue.subscriptions?.slice(0, 5).map(s => ({ email: s.customer_email, amount: s.amount })) };
    } catch (e) { results.stripe_error = e.message; }
    results.generated_at = new Date().toISOString();
    return results;
  }

  // ── VALIDATE ENV VARS ─────────────────────────────────────────────────────
  // Check that all required env vars are set for a given set of services
  if (tool === 'compound_validate_env_vars') {
    const { services = [] } = args;
    const envMap = {
      stripe: ['STRIPE_SECRET_KEY'],
      clerk: ['CLERK_SECRET_KEY'],
      resend: ['RESEND_API_KEY'],
      neon: ['NEON_API_KEY'],
      vercel: ['VERCEL_TOKEN'],
      fly: ['FLY_API_TOKEN'],
      github: ['GITHUB_TOKEN'],
      sentry: ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG_SLUG'],
      openai: ['OPENAI_API_KEY'],
      anthropic: ['ANTHROPIC_API_KEY'],
      supabase: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      mapbox: ['MAPBOX_ACCESS_TOKEN'],
      twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
      ollama: ['OLLAMA_BASE_URL'],
      qdrant: ['QDRANT_URL'],
      cloudflare: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
      postgres: ['POSTGRES_CONNECTION_STRING'],
      upstash: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    };
    const toCheck = services.length ? services : Object.keys(envMap);
    const results = {};
    for (const svc of toCheck) {
      const vars = envMap[svc] || [];
      results[svc] = { required: vars, missing: vars.filter(v => !process.env[v]), configured: vars.every(v => !!process.env[v]) };
    }
    return { results, all_configured: Object.values(results).every(r => r.configured), services_checked: toCheck.length };
  }

  // ── FULL HEALTH DASHBOARD ─────────────────────────────────────────────────
  // Ping every configured service and report status
  if (tool === 'compound_full_health_dashboard') {
    const checks = {};

    const tryCheck = async (name, fn) => {
      try { checks[name] = { healthy: true, ...(await fn()) }; }
      catch (e) { checks[name] = { healthy: false, error: e.message }; }
    };

    await Promise.all([
      tryCheck('ollama', async () => { const h = await loadHandler('ollama'); return await h.execute('ollama_check_health', {}); }),
      tryCheck('neon', async () => { const h = await loadHandler('neon'); const p = await h.execute('neon_list_projects', {}); return { projects: p?.length || 0 }; }),
      tryCheck('vercel', async () => { const h = await loadHandler('vercel'); const p = await h.execute('vercel_list_projects', {}); return { projects: p?.projects?.length || 0 }; }),
      tryCheck('github', async () => { const h = await loadHandler('github'); const u = await h.execute('github_get_authenticated_user', {}); return { user: u.login }; }),
      tryCheck('stripe', async () => { const h = await loadHandler('stripe'); const b = await h.execute('stripe_get_balance', {}); return { available: b.available?.[0]?.amount / 100 }; }),
      tryCheck('sentry', async () => { const h = await loadHandler('sentry'); const p = await h.execute('sentry_list_projects', {}); return { projects: p?.length || 0 }; }),
      tryCheck('qdrant', async () => { const h = await loadHandler('qdrant'); return await h.execute('qdrant_health_check', {}); }),
    ]);

    const healthy = Object.values(checks).filter(c => c.healthy).length;
    const total = Object.keys(checks).length;
    return { checks, summary: `${healthy}/${total} services healthy`, checked_at: new Date().toISOString() };
  }

  // ── BATCH EMBED DOCUMENTS ─────────────────────────────────────────────────
  // Embed and store multiple documents in Qdrant in one call
  if (tool === 'compound_batch_embed_documents') {
    const { documents, collection_name, use_ollama = false, ollama_model } = args;
    if (!documents?.length || !collection_name) throw new Error('documents array and collection_name are required');
    // documents: [{id, text, ...payload}]
    const embedder = use_ollama ? await loadHandler('ollama') : await loadHandler('openai');
    const points = [];
    for (const doc of documents) {
      const text = doc.text || doc.content || doc.body || JSON.stringify(doc);
      const embedRes = use_ollama
        ? await embedder.execute('ollama_embed', { input: text, model: ollama_model })
        : await embedder.execute('openai_create_embedding', { input: text });
      const vector = use_ollama ? (Array.isArray(embedRes.embeddings) ? embedRes.embeddings[0] : embedRes.embeddings) : embedRes.embeddings?.[0];
      if (vector) points.push({ id: doc.id, vector, payload: { text, ...Object.fromEntries(Object.entries(doc).filter(([k]) => !['text','content','body'].includes(k))) } });
    }
    const qdrant = await loadHandler('qdrant');
    const result = await qdrant.execute('qdrant_upsert_points', { collection_name, points });
    return { stored: points.length, failed: documents.length - points.length, collection_name, result };
  }

  // ── ROLLBACK TRANSACTION ──────────────────────────────────────────────────
  // Reads the Observability Ledger and replays inverse operations in reverse order
  if (tool === 'compound_rollback_transaction') {
    return rollbackTransaction(args, async (name, parameters) => {
      const handler = await loadHandler(name.split('_')[0]);
      return handler.execute(name, parameters);
    });
  }


  // ── NOTIFY TEAM ───────────────────────────────────────────────────────────
  // Send a Slack alert AND create a Linear issue in one call
  if (tool === 'compound_notify_team') {
    const { title, message, slack_channel, linear_team_id, priority = 2, severity = 'warning', slack_action_url } = args;
    if (!title || !message) throw new Error('title and message are required');
    const results = { steps: [] };
    if (slack_channel || process.env.SLACK_DEFAULT_CHANNEL) {
      try {
        const slack = await loadHandler('slack');
        await slack.execute('slack_send_alert', { channel: slack_channel, title, message, severity, action_url: slack_action_url });
        results.steps.push({ step: 'slack_alert', success: true });
      } catch (e) { results.steps.push({ step: 'slack_alert', success: false, error: e.message }); }
    }
    if (linear_team_id) {
      try {
        const linear = await loadHandler('linear');
        const issue = await linear.execute('linear_create_issue', { title, description: message, team_id: linear_team_id, priority });
        results.steps.push({ step: 'linear_issue', success: true, identifier: issue.issue?.identifier });
        results.linear_issue = issue.issue?.identifier;
      } catch (e) { results.steps.push({ step: 'linear_issue', success: false, error: e.message }); }
    }
    return results;
  }

  // ── INCIDENT ALERT ────────────────────────────────────────────────────────
  // Sentry error → Slack critical alert → Linear urgent issue in one call
  if (tool === 'compound_incident_alert') {
    const { sentry_issue_id, slack_channel, linear_team_id, additional_context } = args;
    if (!sentry_issue_id) throw new Error('sentry_issue_id is required');
    const results = { steps: [] };
    let issueTitle = `Incident: Sentry issue ${sentry_issue_id}`;
    let issueDetails = additional_context || '';
    try {
      const sentry = await loadHandler('sentry');
      const issue = await sentry.execute('sentry_get_issue', { issue_id: sentry_issue_id });
      issueTitle = `🚨 ${issue.title}`;
      issueDetails = `**Sentry:** ${issue.permalink || ''}
**Level:** ${issue.level}
**Count:** ${issue.count} occurrences
**Last seen:** ${issue.lastSeen}
${additional_context || ''}`;
      results.sentry_issue = { title: issue.title, level: issue.level, count: issue.count };
      results.steps.push({ step: 'sentry_fetch', success: true });
    } catch (e) { results.steps.push({ step: 'sentry_fetch', success: false, error: e.message }); }
    if (slack_channel || process.env.SLACK_DEFAULT_CHANNEL) {
      try {
        const slack = await loadHandler('slack');
        await slack.execute('slack_send_alert', { channel: slack_channel, title: issueTitle, message: issueDetails, severity: 'critical' });
        results.steps.push({ step: 'slack_alert', success: true });
      } catch (e) { results.steps.push({ step: 'slack_alert', success: false, error: e.message }); }
    }
    if (linear_team_id) {
      try {
        const linear = await loadHandler('linear');
        const created = await linear.execute('linear_create_issue', { title: issueTitle, description: issueDetails, team_id: linear_team_id, priority: 1 });
        results.steps.push({ step: 'linear_issue', success: true, identifier: created.issue?.identifier });
        results.linear_issue = created.issue?.identifier;
      } catch (e) { results.steps.push({ step: 'linear_issue', success: false, error: e.message }); }
    }
    return results;
  }

  // ── STANDUP SUMMARY ──────────────────────────────────────────────────────
  // My Linear issues + recent Sentry errors + last Vercel deploy in one call
  if (tool === 'compound_standup_summary') {
    const { linear_team_id, sentry_project, vercel_project_id } = args;
    const summary = { generated_at: new Date().toISOString() };
    if (linear_team_id) {
      try {
        const linear = await loadHandler('linear');
        summary.my_issues = await linear.execute('linear_my_work_today', {});
      } catch (e) { summary.linear_error = e.message; }
    }
    if (sentry_project) {
      try {
        const sentry = await loadHandler('sentry');
        const issues = await sentry.execute('sentry_list_issues', { project_slug: sentry_project, limit: 5, query: 'is:unresolved', sort: 'date' });
        summary.recent_errors = issues.map ? issues.map(i => ({ id: i.id, title: i.title, count: i.count, lastSeen: i.lastSeen })) : [];
      } catch (e) { summary.sentry_error = e.message; }
    }
    if (vercel_project_id) {
      try {
        const vercel = await loadHandler('vercel');
        const deploys = await vercel.execute('vercel_list_deployments', { projectId: vercel_project_id, limit: 3 });
        summary.recent_deploys = deploys.deployments?.map(d => ({ state: d.state, created: d.createdAt, url: d.url }));
      } catch (e) { summary.vercel_error = e.message; }
    }
    return summary;
  }

  // ── BUG REPORT ────────────────────────────────────────────────────────────
  // Fetch Sentry error context → create linked Linear issue → notify Slack
  if (tool === 'compound_bug_report_from_sentry') {
    const { sentry_issue_id, linear_team_id, slack_channel, assignee_id } = args;
    if (!sentry_issue_id || !linear_team_id) throw new Error('sentry_issue_id and linear_team_id are required');
    const results = { steps: [] };
    let issueTitle = `Bug: Sentry ${sentry_issue_id}`;
    let issueDesc = `Sentry issue ID: ${sentry_issue_id}`;
    try {
      const sentry = await loadHandler('sentry');
      const [issue, latestEvent] = await Promise.all([
        sentry.execute('sentry_get_issue', { issue_id: sentry_issue_id }),
        sentry.execute('sentry_get_latest_event', { issue_id: sentry_issue_id }).catch(() => null)
      ]);
      issueTitle = `Bug: ${issue.title}`;
      issueDesc = `**Source:** Sentry ${issue.permalink || ''}
**Level:** ${issue.level} | **Count:** ${issue.count}
**First seen:** ${issue.firstSeen}
**Last seen:** ${issue.lastSeen}`;
      if (latestEvent?.culprit) issueDesc += `\n**Culprit:** ${latestEvent.culprit}`;
      results.steps.push({ step: 'sentry_fetch', success: true });
    } catch (e) { results.steps.push({ step: 'sentry_fetch', success: false, error: e.message }); }
    const linear = await loadHandler('linear');
    const created = await linear.execute('linear_create_issue', { title: issueTitle, description: issueDesc, team_id: linear_team_id, priority: 2, assignee_id });
    results.steps.push({ step: 'linear_issue', success: !!created.success, identifier: created.issue?.identifier });
    results.linear_issue = { identifier: created.issue?.identifier, url: created.issue?.url };
    if (slack_channel || process.env.SLACK_DEFAULT_CHANNEL) {
      try {
        const slack = await loadHandler('slack');
        await slack.execute('slack_send_alert', { channel: slack_channel, title: issueTitle, message: `Linear issue created: ${created.issue?.identifier}\n${issueDesc.slice(0, 200)}`, severity: 'warning', action_url: created.issue?.url, action_text: 'View in Linear' });
        results.steps.push({ step: 'slack_notify', success: true });
      } catch (e) { results.steps.push({ step: 'slack_notify', success: false, error: e.message }); }
    }
    return results;
  }

  // ── DEPLOY ANNOUNCEMENT ───────────────────────────────────────────────────
  // Deploy to Vercel + Sentry release + Slack announcement in one call
  if (tool === 'compound_deploy_and_announce') {
    const { version, project_path, vercel_project_id, sentry_project, slack_channel, app_name, environment = 'production', changes } = args;
    if (!version || !app_name) throw new Error('version and app_name are required');
    const results = { steps: [] };
    // Reuse existing deploy_and_release
    const deployResult = await execute('compound_deploy_and_release', { version, project_path, vercel_project_id, sentry_project, environment, git_push: !!project_path });
    results.deploy = deployResult;
    // Announce on Slack
    if (slack_channel || process.env.SLACK_DEFAULT_CHANNEL) {
      try {
        const slack = await loadHandler('slack');
        const deployUrl = deployResult.deployment?.url;
        await slack.execute('slack_announce_deployment', { channel: slack_channel, app_name, version, environment, status: deployResult.all_succeeded ? 'success' : 'failed', changes, url: deployUrl });
        results.steps.push({ step: 'slack_announcement', success: true });
      } catch (e) { results.steps.push({ step: 'slack_announcement', success: false, error: e.message }); }
    }
    return results;
  }

  // ── LINEAR + SLACK SPRINT KICKOFF ─────────────────────────────────────────
  // Post sprint contents to Slack when a new cycle starts
  if (tool === 'compound_sprint_kickoff_announcement') {
    const { linear_team_id, slack_channel } = args;
    if (!linear_team_id) throw new Error('linear_team_id is required');
    const linear = await loadHandler('linear');
    const cycle = await linear.execute('linear_get_active_cycle', { team_id: linear_team_id });
    if (!cycle) throw new Error('No active cycle found for this team');
    const issueData = await linear.execute('linear_list_issues', { team_id: linear_team_id, first: 50 });
    const inCycle = (issueData.issues || []).filter(i => i.cycle?.id === cycle.id);
    const text = [
      `🏃 *Sprint ${cycle.number} is live* — ${cycle.name || ''}`,
      `*Dates:* ${new Date(cycle.startsAt).toLocaleDateString()} → ${new Date(cycle.endsAt).toLocaleDateString()}`,
      `*Issues in sprint:* ${inCycle.length}`,
      inCycle.filter(i => i.priority === 1).length ? `*🚨 Urgent:* ${inCycle.filter(i => i.priority === 1).map(i => i.identifier).join(', ')}` : ''
    ].filter(Boolean).join('\n');
    if (slack_channel || process.env.SLACK_DEFAULT_CHANNEL) {
      const slack = await loadHandler('slack');
      const msg = await slack.execute('slack_send_message', { channel: slack_channel, text });
      return { cycle, message_sent: true, ts: msg.ts };
    }
    return { cycle, message_sent: false, preview: text };
  }


  // ── FULL FEATURE DEPLOY ───────────────────────────────────────────────────
  // Merge GitHub PR + run Neon migration + deploy to Vercel production
  if (tool === 'compound_full_feature_deploy') {
    const { github_owner, github_repo, pr_number, neon_project_id, migration_sql, vercel_project_id, version, sentry_project } = args;
    if (!github_owner || !github_repo) throw new Error('github_owner and github_repo are required');
    const results = { steps: [] };
    if (pr_number) {
      try {
        const gh = await loadHandler('github');
        const merge = await gh.execute('github_merge_pull_request', { owner: github_owner, repo: github_repo, pull_number: pr_number, merge_method: 'squash' });
        results.steps.push({ step: 'pr_merge', success: true, sha: merge.sha, message: merge.message });
        results.merged_sha = merge.sha;
      } catch (e) { results.steps.push({ step: 'pr_merge', success: false, error: e.message }); }
    }
    if (neon_project_id && migration_sql) {
      try {
        const migration = await execute('compound_neon_safe_migration', { neon_project_id, migration_sql });
        results.steps.push({ step: 'neon_migration', success: migration.migration_success, status: migration.status });
        results.migration = migration;
      } catch (e) { results.steps.push({ step: 'neon_migration', success: false, error: e.message }); }
    }
    if (vercel_project_id && version) {
      try {
        const deploy = await execute('compound_deploy_and_release', { version, vercel_project_id, sentry_project, environment: 'production', git_push: false });
        results.steps.push({ step: 'vercel_deploy', success: deploy.all_succeeded, state: deploy.deployment?.state });
        results.deployment = deploy.deployment;
      } catch (e) { results.steps.push({ step: 'vercel_deploy', success: false, error: e.message }); }
    }
    return { ...results, all_succeeded: results.steps.every(s => s.success) };
  }

  // ── HOTFIX DEPLOY ──────────────────────────────────────────────────────────
  // Git commit + push + Vercel deploy + Slack alert in one call
  if (tool === 'compound_hotfix_deploy') {
    const { project_path, commit_message, vercel_project_id, version, slack_channel, app_name, sentry_project } = args;
    if (!project_path || !commit_message) throw new Error('project_path and commit_message are required');
    const results = { steps: [] };
    const gitResult = await execute('compound_git_commit_push', { project_path, message: commit_message });
    results.steps.push({ step: 'git', success: gitResult.all_succeeded, detail: gitResult.steps });
    results.git = gitResult;
    if (vercel_project_id && version) {
      await new Promise(r => setTimeout(r, 8000)); // Wait for Vercel webhook
      try {
        const vercel = await loadHandler('vercel');
        const d = await vercel.execute('vercel_list_deployments', { projectId: vercel_project_id, limit: 1 });
        const latest = d.deployments?.[0];
        results.steps.push({ step: 'vercel_check', success: !!latest, state: latest?.state, url: latest?.url ? `https://${latest.url}` : null });
        results.deployment = latest;
      } catch (e) { results.steps.push({ step: 'vercel_check', success: false, error: e.message }); }
    }
    if (sentry_project && version) {
      try {
        const sentry = await loadHandler('sentry');
        await sentry.execute('sentry_deploy_release', { version, environment: 'production', project_slug: sentry_project });
        results.steps.push({ step: 'sentry_release', success: true });
      } catch (e) { results.steps.push({ step: 'sentry_release', success: false, error: e.message }); }
    }
    if (slack_channel || process.env.SLACK_DEFAULT_CHANNEL) {
      try {
        const slack = await loadHandler('slack');
        const deployUrl = results.deployment?.url ? `https://${results.deployment.url}` : null;
        await slack.execute('slack_send_alert', {
          channel: slack_channel, severity: 'warning',
          title: `🔥 Hotfix deployed${app_name ? ` — ${app_name}` : ''}${version ? ` v${version}` : ''}`,
          message: `${commit_message}${deployUrl ? `
${deployUrl}` : ''}`
        });
        results.steps.push({ step: 'slack_alert', success: true });
      } catch (e) { results.steps.push({ step: 'slack_alert', success: false, error: e.message }); }
    }
    return { ...results, all_succeeded: results.steps.every(s => s.success) };
  }

  // ── STAGING REFRESH ────────────────────────────────────────────────────────
  // Reset staging Neon branch to main data + re-deploy staging Vercel project
  if (tool === 'compound_staging_refresh') {
    const { neon_project_id, vercel_project_id, staging_branch_name = 'staging', slack_channel } = args;
    if (!neon_project_id) throw new Error('neon_project_id is required');
    const results = { steps: [] };
    const neon = await loadHandler('neon');
    try {
      const branches = await neon.execute('neon_list_branches', { project_id: neon_project_id });
      const existing = (branches.branches || branches).find(b => b.name === staging_branch_name);
      if (existing) {
        await neon.execute('neon_delete_branch', { project_id: neon_project_id, branch_id: existing.id });
        results.steps.push({ step: 'neon_delete_old_staging', success: true });
      }
      const newBranch = await neon.execute('neon_create_branch', { project_id: neon_project_id, branch_name: staging_branch_name });
      results.neon_branch_id = newBranch.branch?.id;
      results.steps.push({ step: 'neon_create_staging_branch', success: true, branch_id: newBranch.branch?.id });
    } catch (e) { results.steps.push({ step: 'neon_staging_branch', success: false, error: e.message }); }
    if (vercel_project_id) {
      try {
        const vercel = await loadHandler('vercel');
        const deploy = await vercel.execute('vercel_create_deployment', { projectId: vercel_project_id, target: 'preview', gitBranch: staging_branch_name });
        results.steps.push({ step: 'vercel_staging_deploy', success: true, url: deploy.url });
        results.staging_url = deploy.url;
      } catch (e) { results.steps.push({ step: 'vercel_staging_deploy', success: false, error: e.message }); }
    }
    if (slack_channel || process.env.SLACK_DEFAULT_CHANNEL) {
      try {
        const slack = await loadHandler('slack');
        await slack.execute('slack_send_message', { channel: slack_channel, text: `🔄 Staging refreshed${results.staging_url ? ` — ${results.staging_url}` : ''}` });
        results.steps.push({ step: 'slack_notify', success: true });
      } catch (e) { results.steps.push({ step: 'slack_notify', success: false, error: e.message }); }
    }
    return { ...results, all_succeeded: results.steps.every(s => s.success) };
  }

  // ── PROVISION NEW PROJECT ─────────────────────────────────────────────────
  // GitHub repo + Vercel project + Neon database + wire env vars in one call
  if (tool === 'compound_provision_new_project') {
    const { project_name, github_org, vercel_team_id, neon_org_id, private_repo = true, framework } = args;
    if (!project_name) throw new Error('project_name is required');
    const results = { project_name, steps: [] };
    let neonConnString = null;
    try {
      const gh = await loadHandler('github');
      const repo = await gh.execute('github_create_repo', { name: project_name, private: private_repo, org: github_org, auto_init: true });
      results.github_repo = repo.html_url;
      results.steps.push({ step: 'github_repo', success: true, url: repo.html_url });
    } catch (e) { results.steps.push({ step: 'github_repo', success: false, error: e.message }); }
    try {
      const neon = await loadHandler('neon');
      const neonProject = await neon.execute('neon_create_project', { name: project_name, region_id: 'aws-us-east-2', org_id: neon_org_id });
      results.neon_project_id = neonProject.project?.id;
      const connInfo = await neon.execute('neon_get_connection_string', { project_id: neonProject.project?.id, database: 'neondb' });
      neonConnString = connInfo.connection_string;
      results.neon_connection_string = neonConnString;
      results.steps.push({ step: 'neon_project', success: true, id: neonProject.project?.id });
    } catch (e) { results.steps.push({ step: 'neon_project', success: false, error: e.message }); }
    try {
      const vercel = await loadHandler('vercel');
      const project = await vercel.execute('vercel_create_project', { name: project_name, teamId: vercel_team_id, framework: framework || 'nextjs' });
      results.vercel_project_id = project.id;
      results.steps.push({ step: 'vercel_project', success: true, id: project.id });
      if (neonConnString) {
        await vercel.execute('vercel_add_env_variable', { projectId: project.id, key: 'DATABASE_URL', value: neonConnString, target: ['production', 'preview', 'development'] });
        results.steps.push({ step: 'vercel_env_wired', success: true });
      }
    } catch (e) { results.steps.push({ step: 'vercel_project', success: false, error: e.message }); }
    return { ...results, all_succeeded: results.steps.every(s => s.success) };
  }

  // ── TENANT PROVISION ──────────────────────────────────────────────────────
  // Stripe customer + DB tenant schema + Clerk org + welcome email in one call
  if (tool === 'compound_provision_tenant') {
    const { tenant_name, admin_email, price_id, neon_project_id, from_email, app_name = 'the app' } = args;
    if (!tenant_name || !admin_email) throw new Error('tenant_name and admin_email are required');
    const results = { tenant: tenant_name, steps: [] };
    try {
      const stripe = await loadHandler('stripe');
      const customer = await stripe.execute('stripe_create_customer', { email: admin_email, name: tenant_name });
      results.stripe_customer_id = customer.id;
      results.steps.push({ step: 'stripe_customer', success: true, id: customer.id });
      if (price_id) {
        const sub = await stripe.execute('stripe_create_subscription', { customer_id: customer.id, price_id });
        results.stripe_subscription_id = sub.id;
        results.steps.push({ step: 'stripe_subscription', success: true, status: sub.status });
      }
    } catch (e) { results.steps.push({ step: 'stripe', success: false, error: e.message }); }
    try {
      const clerk = await loadHandler('clerk');
      const org = await clerk.execute('clerk_create_organization', { name: tenant_name });
      results.clerk_org_id = org.id;
      results.steps.push({ step: 'clerk_org', success: true, id: org.id });
    } catch (e) { results.steps.push({ step: 'clerk_org', success: false, error: e.message }); }
    if (neon_project_id) {
      try {
        const neon = await loadHandler('neon');
        const schema = `tenant_${tenant_name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        await neon.execute('neon_run_sql', { project_id: neon_project_id, sql: `CREATE SCHEMA IF NOT EXISTS ${schema}` });
        results.db_schema = schema;
        results.steps.push({ step: 'db_schema', success: true, schema });
      } catch (e) { results.steps.push({ step: 'db_schema', success: false, error: e.message }); }
    }
    if (from_email) {
      try {
        const resend = await loadHandler('resend');
        await resend.execute('resend_send_email', { from: from_email, to: admin_email, subject: `Welcome to ${app_name} — your account is ready`, html: `<p>Welcome ${tenant_name}! Your ${app_name} account has been created. Sign in to get started.</p>` });
        results.steps.push({ step: 'welcome_email', success: true });
      } catch (e) { results.steps.push({ step: 'welcome_email', success: false, error: e.message }); }
    }
    return { ...results, all_succeeded: results.steps.every(s => s.success) };
  }

  // ── TENANT UPGRADE ────────────────────────────────────────────────────────
  // Stripe plan upgrade + send confirmation email in one call
  if (tool === 'compound_tenant_upgrade') {
    const { stripe_subscription_id, new_price_id, admin_email, from_email, app_name = 'the app', plan_name } = args;
    if (!stripe_subscription_id || !new_price_id) throw new Error('stripe_subscription_id and new_price_id are required');
    const results = { steps: [] };
    try {
      const stripe = await loadHandler('stripe');
      const sub = await stripe.execute('stripe_update_subscription', { subscription_id: stripe_subscription_id, price_id: new_price_id });
      results.subscription = { id: sub.id, status: sub.status };
      results.steps.push({ step: 'stripe_upgrade', success: true, status: sub.status });
    } catch (e) { results.steps.push({ step: 'stripe_upgrade', success: false, error: e.message }); }
    if (from_email && admin_email) {
      try {
        const resend = await loadHandler('resend');
        await resend.execute('resend_send_email', { from: from_email, to: admin_email, subject: `Your ${app_name} plan has been upgraded`, html: `<p>Your account has been upgraded${plan_name ? ` to ${plan_name}` : ''}. Your new features are available immediately.</p>` });
        results.steps.push({ step: 'upgrade_email', success: true });
      } catch (e) { results.steps.push({ step: 'upgrade_email', success: false, error: e.message }); }
    }
    return { ...results, all_succeeded: results.steps.every(s => s.success) };
  }

  // ── WEEKLY ENGINEERING REPORT ─────────────────────────────────────────────
  // GitHub commits + Vercel deploys + Neon query stats + Stripe MRR in one report
  if (tool === 'compound_weekly_engineering_report') {
    const { github_owner, github_repo, vercel_project_id, neon_project_id, slack_channel } = args;
    const report = { week: new Date().toISOString().slice(0, 10), sections: {} };
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    if (github_owner && github_repo) {
      try {
        const gh = await loadHandler('github');
        const [commits, prs] = await Promise.all([
          gh.execute('github_list_commits', { owner: github_owner, repo: github_repo, since, per_page: 50 }).catch(() => []),
          gh.execute('github_list_pull_requests', { owner: github_owner, repo: github_repo, state: 'closed', per_page: 20 }).catch(() => [])
        ]);
        const mergedPRs = (Array.isArray(prs) ? prs : prs.pull_requests || []).filter(pr => pr.merged_at && new Date(pr.merged_at) > new Date(since));
        report.sections.github = { commits: Array.isArray(commits) ? commits.length : (commits.commits?.length || 0), merged_prs: mergedPRs.length };
      } catch (e) { report.sections.github = { error: e.message }; }
    }
    if (vercel_project_id) {
      try {
        const vercel = await loadHandler('vercel');
        const d = await vercel.execute('vercel_list_deployments', { projectId: vercel_project_id, limit: 20 });
        const recent = (d.deployments || []).filter(x => x.createdAt && new Date(x.createdAt) > new Date(since));
        report.sections.vercel = { deployments_this_week: recent.length, latest_state: d.deployments?.[0]?.state };
      } catch (e) { report.sections.vercel = { error: e.message }; }
    }
    if (neon_project_id) {
      try {
        const neon = await loadHandler('neon');
        const branches = await neon.execute('neon_list_branches', { project_id: neon_project_id });
        report.sections.neon = { branches: (branches.branches || branches).length };
      } catch (e) { report.sections.neon = { error: e.message }; }
    }
    try {
      const stripe = await loadHandler('stripe');
      const revenue = await stripe.execute('stripe_revenue_summary', {});
      report.sections.stripe = { mrr: revenue.mrr_usd, arr: revenue.arr_usd, active_subs: revenue.active_subscriptions };
    } catch (e) { report.sections.stripe = { error: e.message }; }
    if (slack_channel || process.env.SLACK_DEFAULT_CHANNEL) {
      try {
        const slack = await loadHandler('slack');
        const lines = [`📊 *Weekly Engineering Report — ${report.week}*`];
        if (report.sections.github?.commits !== undefined) lines.push(`• GitHub: ${report.sections.github.commits} commits, ${report.sections.github.merged_prs} PRs merged`);
        if (report.sections.vercel?.deployments_this_week !== undefined) lines.push(`• Vercel: ${report.sections.vercel.deployments_this_week} deployments (latest: ${report.sections.vercel.latest_state})`);
        if (report.sections.stripe?.mrr !== undefined) lines.push(`• Stripe: MRR $${report.sections.stripe.mrr?.toLocaleString() || 'N/A'}`);
        await slack.execute('slack_send_message', { channel: slack_channel, text: lines.join('\n') });
        report.slack_sent = true;
      } catch (e) { report.slack_error = e.message; }
    }
    return report;
  }

  // ── COST AUDIT ────────────────────────────────────────────────────────────
  // Fetch spending data from Neon, Vercel, OpenAI, and Stripe in one report
  if (tool === 'compound_cost_audit') {
    const costs = { generated_at: new Date().toISOString(), services: {} };
    const tryFetch = async (name, fn) => {
      try { costs.services[name] = await fn(); }
      catch (e) { costs.services[name] = { error: e.message }; }
    };
    await Promise.all([
      tryFetch('neon', async () => {
        const h = await loadHandler('neon');
        const consumption = await h.execute('neon_get_consumption_history_per_account', {}).catch(() => null);
        return consumption || { note: 'Consumption history requires Neon API access' };
      }),
      tryFetch('openai', async () => {
        const h = await loadHandler('openai');
        const usage = await h.execute('openai_get_usage', {}).catch(() => null);
        return usage || { note: 'Requires OPENAI_ADMIN_KEY' };
      }),
      tryFetch('anthropic', async () => {
        const h = await loadHandler('anthropic');
        const usage = await h.execute('anthropic_get_usage', {}).catch(() => null);
        return usage || { note: 'Requires ANTHROPIC_ADMIN_KEY' };
      }),
      tryFetch('stripe_balance', async () => {
        const h = await loadHandler('stripe');
        return await h.execute('stripe_get_balance', {});
      }),
    ]);
    return costs;
  }

  // ── DISPATCH JOB (YardSync) ───────────────────────────────────────────────
  // Create DB job record + send driver SMS + send customer confirmation email
  if (tool === 'compound_dispatch_job') {
    const { neon_project_id, job_data, driver_phone, driver_message, customer_email, customer_subject, customer_html, from_email } = args;
    if (!driver_phone && !customer_email) throw new Error('At least one of driver_phone or customer_email is required');
    const results = { steps: [] };
    if (neon_project_id && job_data) {
      try {
        const neon = await loadHandler('neon');
        const cols = Object.keys(job_data).join(', ');
        const vals = Object.values(job_data).map(v => typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v).join(', ');
        const insert = await neon.execute('neon_run_sql', { project_id: neon_project_id, sql: `INSERT INTO jobs (${cols}) VALUES (${vals}) RETURNING id` });
        results.job_id = insert.rows?.[0]?.id;
        results.steps.push({ step: 'db_insert', success: true, job_id: results.job_id });
      } catch (e) { results.steps.push({ step: 'db_insert', success: false, error: e.message }); }
    }
    if (driver_phone && driver_message) {
      try {
        const twilio = await loadHandler('twilio');
        await twilio.execute('twilio_send_sms', { to: driver_phone, body: driver_message });
        results.steps.push({ step: 'driver_sms', success: true });
      } catch (e) { results.steps.push({ step: 'driver_sms', success: false, error: e.message }); }
    }
    if (customer_email && from_email) {
      try {
        const resend = await loadHandler('resend');
        await resend.execute('resend_send_email', { from: from_email, to: customer_email, subject: customer_subject || 'Your service appointment is confirmed', html: customer_html || '<p>Your appointment has been confirmed.</p>' });
        results.steps.push({ step: 'customer_email', success: true });
      } catch (e) { results.steps.push({ step: 'customer_email', success: false, error: e.message }); }
    }
    return { ...results, all_succeeded: results.steps.every(s => s.success) };
  }

  // ── COMPLETE JOB (YardSync) ───────────────────────────────────────────────
  // Update DB job status + notify customer + create Stripe invoice
  if (tool === 'compound_complete_job') {
    const { neon_project_id, job_id, completion_data, customer_email, from_email, app_name, stripe_customer_id, amount_cents, invoice_description } = args;
    if (!job_id) throw new Error('job_id is required');
    const results = { job_id, steps: [] };
    if (neon_project_id) {
      try {
        const neon = await loadHandler('neon');
        const sets = Object.entries({ ...completion_data, status: 'completed', completed_at: 'NOW()' })
          .map(([k, v]) => `${k} = ${v === 'NOW()' ? v : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v}`).join(', ');
        await neon.execute('neon_run_sql', { project_id: neon_project_id, sql: `UPDATE jobs SET ${sets} WHERE id = ${job_id}` });
        results.steps.push({ step: 'db_update', success: true });
      } catch (e) { results.steps.push({ step: 'db_update', success: false, error: e.message }); }
    }
    if (customer_email && from_email) {
      try {
        const resend = await loadHandler('resend');
        await resend.execute('resend_send_email', { from: from_email, to: customer_email, subject: `Your service is complete${app_name ? ` — ${app_name}` : ''}`, html: `<p>Your service has been completed. Thank you for your business!</p>` });
        results.steps.push({ step: 'completion_email', success: true });
      } catch (e) { results.steps.push({ step: 'completion_email', success: false, error: e.message }); }
    }
    if (stripe_customer_id && amount_cents) {
      try {
        const stripe = await loadHandler('stripe');
        const invoice = await stripe.execute('stripe_create_invoice', { customer_id: stripe_customer_id, auto_advance: true, collection_method: 'send_invoice', days_until_due: 30 });
        await stripe.execute('stripe_create_invoice_item', { customer_id: stripe_customer_id, amount: amount_cents, description: invoice_description || `Job #${job_id}`, invoice_id: invoice.id });
        const finalized = await stripe.execute('stripe_finalize_invoice', { invoice_id: invoice.id });
        results.invoice_id = finalized.id;
        results.invoice_url = finalized.hosted_invoice_url;
        results.steps.push({ step: 'stripe_invoice', success: true, invoice_id: finalized.id });
      } catch (e) { results.steps.push({ step: 'stripe_invoice', success: false, error: e.message }); }
    }
    return { ...results, all_succeeded: results.steps.every(s => s.success) };
  }

  // ── DRIVER ONBOARD (YardSync) ─────────────────────────────────────────────
  // Create Clerk account + send welcome SMS + seed initial route data in Neon
  if (tool === 'compound_driver_onboard') {
    const { email, phone, first_name, last_name, neon_project_id, driver_data, from_number } = args;
    if (!email) throw new Error('email is required');
    const results = { email, steps: [] };
    let clerkUserId = null;
    try {
      const clerk = await loadHandler('clerk');
      const user = await clerk.execute('clerk_create_user', { email_address: email, first_name, last_name, phone_number: phone });
      clerkUserId = user.id;
      results.clerk_user_id = user.id;
      results.steps.push({ step: 'clerk_user', success: true, id: user.id });
    } catch (e) { results.steps.push({ step: 'clerk_user', success: false, error: e.message }); }
    if (phone && from_number) {
      try {
        const twilio = await loadHandler('twilio');
        await twilio.execute('twilio_send_sms', { to: phone, body: `Welcome ${first_name || ''}! Your driver account is ready. Download the app to get started.` });
        results.steps.push({ step: 'welcome_sms', success: true });
      } catch (e) { results.steps.push({ step: 'welcome_sms', success: false, error: e.message }); }
    }
    if (neon_project_id && clerkUserId) {
      try {
        const neon = await loadHandler('neon');
        const driverRecord = { clerk_user_id: clerkUserId, email, first_name: first_name || '', last_name: last_name || '', phone: phone || '', status: 'active', ...driver_data };
        const cols = Object.keys(driverRecord).join(', ');
        const vals = Object.values(driverRecord).map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
        const insert = await neon.execute('neon_run_sql', { project_id: neon_project_id, sql: `INSERT INTO drivers (${cols}) VALUES (${vals}) RETURNING id` });
        results.driver_id = insert.rows?.[0]?.id;
        results.steps.push({ step: 'db_driver_record', success: true, driver_id: results.driver_id });
      } catch (e) { results.steps.push({ step: 'db_driver_record', success: false, error: e.message }); }
    }
    return { ...results, all_succeeded: results.steps.every(s => s.success) };
  }

  // ── RESEARCH AND SUMMARIZE ────────────────────────────────────────────────
  // Web search + AI summarization in one call (Tavily → Claude/OpenAI)
  if (tool === 'compound_research_and_summarize') {
    const { query, max_results = 5, model = 'claude-3-5-haiku-20241022', use_gemini = false, search_depth = 'advanced' } = args;
    if (!query) throw new Error('query is required');
    const search = await loadHandler('search');
    const searchResults = await search.execute('tavily_search', { query, max_results, search_depth, include_answer: true });
    const context = (searchResults.results || []).map((r, i) => `[${i+1}] ${r.title}
URL: ${r.url}
${r.content?.slice(0, 500)}`).join('\n\n');
    const prompt = `Based on these search results, provide a comprehensive answer to: "${query}"\n\nSources:\n${context}`;
    let summary = searchResults.answer || '';
    if (use_gemini) {
      try {
        const gemini = await loadHandler('gemini');
        const res = await gemini.execute('gemini_standard_query', { prompt, model: 'gemini-2.5-flash' });
        summary = res.text;
      } catch (e) { summary = searchResults.answer || `Search found ${searchResults.results?.length || 0} results.`; }
    } else {
      try {
        const anthropic = await loadHandler('anthropic');
        const res = await anthropic.execute('anthropic_message', { model, prompt, max_tokens: 1000 });
        summary = res.text;
      } catch (e) { summary = searchResults.answer || `Search found ${searchResults.results?.length || 0} results.`; }
    }
    return {
      query,
      summary,
      sources: (searchResults.results || []).map(r => ({ title: r.title, url: r.url })),
      result_count: searchResults.results?.length || 0
    };
  }



  // ── DEPLOY WITH AUTO-ROLLBACK ─────────────────────────────────────────────
  // Deploy to Vercel and automatically roll back if the deployment fails
  if (tool === 'compound_deploy_with_auto_rollback') {
    const { vercel_project_id, version, sentry_project, slack_channel, app_name, rollback_on_states = ['ERROR', 'CANCELED'] } = args;
    if (!vercel_project_id) throw new Error('vercel_project_id is required');
    const results = { steps: [] };

    // Wait for Vercel deployment to settle
    await new Promise(r => setTimeout(r, 8000));
    const vercel = await loadHandler('vercel');
    let latest;
    try {
      const d = await vercel.execute('vercel_list_deployments', { projectId: vercel_project_id, limit: 2 });
      latest = d.deployments?.[0];
      results.deployment = { id: latest?.uid, state: latest?.state, url: latest?.url ? `https://${latest.url}` : null };
      results.steps.push({ step: 'deployment_check', success: true, state: latest?.state });
    } catch (e) {
      results.steps.push({ step: 'deployment_check', success: false, error: e.message });
      return results;
    }

    const deployFailed = rollback_on_states.includes(latest?.state?.toUpperCase());

    if (deployFailed) {
      // Find previous successful deployment and promote it
      try {
        const d = await vercel.execute('vercel_list_deployments', { projectId: vercel_project_id, limit: 10 });
        const previousGood = d.deployments?.find(dep => dep.state === 'READY' && dep.uid !== latest?.uid);
        if (previousGood) {
          await vercel.execute('vercel_promote_deployment', { deploymentId: previousGood.uid, projectId: vercel_project_id });
          results.rolled_back_to = previousGood.uid;
          results.steps.push({ step: 'rollback', success: true, promoted_deployment: previousGood.uid });
        } else {
          results.steps.push({ step: 'rollback', success: false, reason: 'No previous good deployment found' });
        }
      } catch (e) {
        results.steps.push({ step: 'rollback', success: false, error: e.message });
      }

      if (slack_channel || process.env.SLACK_DEFAULT_CHANNEL) {
        try {
          const slack = await loadHandler('slack');
          await slack.execute('slack_send_alert', {
            channel: slack_channel, severity: 'critical',
            title: `🚨 Deploy failed${app_name ? ` — ${app_name}` : ''}${version ? ` v${version}` : ''} — rolled back`,
            message: `Deployment state: ${latest?.state}
${results.rolled_back_to ? `Rolled back to: ${results.rolled_back_to}` : 'No rollback target found'}`
          });
          results.steps.push({ step: 'slack_alert', success: true });
        } catch (e) { results.steps.push({ step: 'slack_alert', success: false, error: e.message }); }
      }
    } else if (slack_channel || process.env.SLACK_DEFAULT_CHANNEL) {
      try {
        const slack = await loadHandler('slack');
        await slack.execute('slack_send_alert', {
          channel: slack_channel, severity: 'info',
          title: `✅ Deploy successful${app_name ? ` — ${app_name}` : ''}${version ? ` v${version}` : ''}`,
          message: results.deployment?.url || ''
        });
        results.steps.push({ step: 'slack_alert', success: true });
      } catch (e) { results.steps.push({ step: 'slack_alert', success: false, error: e.message }); }
    }

    return { ...results, deploy_failed: deployFailed, auto_rolled_back: deployFailed && !!results.rolled_back_to };
  }

  // ── DATABASE HEALTH REPORT ────────────────────────────────────────────────
  // Neon branch overview + slow queries + table sizes + active connections in one call
  if (tool === 'compound_database_health_report') {
    const { neon_project_id, include_slow_queries = true, include_table_sizes = true } = args;
    if (!neon_project_id) throw new Error('neon_project_id is required');
    const neon = await loadHandler('neon');
    const report = { project_id: neon_project_id, sections: {}, generated_at: new Date().toISOString() };

    const trySection = async (name, fn) => {
      try { report.sections[name] = await fn(); }
      catch (e) { report.sections[name] = { error: e.message }; }
    };

    await Promise.all([
      trySection('branches', () => neon.execute('neon_list_branches', { project_id: neon_project_id })),
      trySection('active_connections', () => neon.execute('neon_run_sql', { project_id: neon_project_id, sql: "SELECT count(*) as count FROM pg_stat_activity WHERE state != 'idle'" })),
      include_slow_queries ? trySection('slow_queries', () => neon.execute('neon_run_sql', { project_id: neon_project_id, sql: "SELECT query, calls, mean_exec_time::numeric(10,2) as avg_ms, total_exec_time::numeric(10,2) as total_ms FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10" })) : Promise.resolve(),
      include_table_sizes ? trySection('table_sizes', () => neon.execute('neon_run_sql', { project_id: neon_project_id, sql: "SELECT relname as table_name, pg_size_pretty(pg_total_relation_size(relid)) as total_size, pg_total_relation_size(relid) as bytes FROM pg_catalog.pg_statio_user_tables ORDER BY bytes DESC LIMIT 15" })) : Promise.resolve(),
    ]);

    return report;
  }

  // ── PIPELINE STATUS ───────────────────────────────────────────────────────
  // GitHub Actions + Vercel + Sentry error count in one CI/CD status snapshot
  if (tool === 'compound_pipeline_status') {
    const { github_owner, github_repo, vercel_project_id, sentry_project, branch = 'main' } = args;
    const status = { branch, checked_at: new Date().toISOString() };

    await Promise.all([
      github_owner && github_repo ? (async () => {
        try {
          const gh = await loadHandler('github');
          const runs = await gh.execute('github_list_workflow_runs', { owner: github_owner, repo: github_repo, branch, per_page: 5 });
          const latest = (runs.workflow_runs || runs)[0];
          status.github_actions = { status: latest?.status, conclusion: latest?.conclusion, name: latest?.name, updated_at: latest?.updated_at };
        } catch (e) { status.github_actions = { error: e.message }; }
      })() : Promise.resolve(),

      vercel_project_id ? (async () => {
        try {
          const vercel = await loadHandler('vercel');
          const d = await vercel.execute('vercel_list_deployments', { projectId: vercel_project_id, limit: 1 });
          const latest = d.deployments?.[0];
          status.vercel = { state: latest?.state, url: latest?.url ? `https://${latest.url}` : null, created_at: latest?.createdAt };
        } catch (e) { status.vercel = { error: e.message }; }
      })() : Promise.resolve(),

      sentry_project ? (async () => {
        try {
          const sentry = await loadHandler('sentry');
          const issues = await sentry.execute('sentry_list_issues', { project_slug: sentry_project, limit: 3, query: 'is:unresolved', sort: 'date' });
          status.sentry = { unresolved_count: Array.isArray(issues) ? issues.length : 0, recent: Array.isArray(issues) ? issues.slice(0,3).map(i => ({ title: i.title, count: i.count })) : [] };
        } catch (e) { status.sentry = { error: e.message }; }
      })() : Promise.resolve(),
    ]);

    const allGreen = (
      (!status.github_actions || status.github_actions.conclusion === 'success') &&
      (!status.vercel || status.vercel.state === 'READY') &&
      (!status.sentry || status.sentry.unresolved_count === 0)
    );
    return { ...status, all_green: allGreen };
  }

  // ── ALERT TRIAGE ──────────────────────────────────────────────────────────
  // Fetch top Sentry issues + map to Linear tickets + summarize with AI in one call
  if (tool === 'compound_alert_triage') {
    const { sentry_project, linear_team_id, limit = 10, auto_create_issues = false } = args;
    if (!sentry_project) throw new Error('sentry_project is required');
    const results = { triaged: [], created_issues: [] };

    const sentry = await loadHandler('sentry');
    const issues = await sentry.execute('sentry_list_issues', { project_slug: sentry_project, limit, query: 'is:unresolved', sort: 'users' });
    results.triaged = Array.isArray(issues) ? issues.map(i => ({
      id: i.id, title: i.title, count: i.count, users_affected: i.userCount,
      level: i.level, first_seen: i.firstSeen, last_seen: i.lastSeen
    })) : [];

    if (auto_create_issues && linear_team_id && results.triaged.length) {
      const linear = await loadHandler('linear');
      const topIssues = results.triaged.slice(0, 3); // Only auto-create for top 3
      for (const issue of topIssues) {
        try {
          const created = await linear.execute('linear_create_issue', {
            title: `Bug: ${issue.title}`,
            description: `**Sentry ID:** ${issue.id}
**Users affected:** ${issue.users_affected}
**Occurrences:** ${issue.count}
**First seen:** ${issue.first_seen}`,
            team_id: linear_team_id,
            priority: issue.level === 'fatal' ? 1 : 2
          });
          results.created_issues.push({ sentry_id: issue.id, linear_id: created.issue?.identifier });
        } catch (e) { results.created_issues.push({ sentry_id: issue.id, error: e.message }); }
      }
    }

    return {
      ...results,
      total_unresolved: results.triaged.length,
      total_users_affected: results.triaged.reduce((s, i) => s + (i.users_affected || 0), 0),
      linear_issues_created: results.created_issues.filter(i => i.linear_id).length
    };
  }

  // ── COMPETITOR RESEARCH ───────────────────────────────────────────────────
  // Search + AI synthesis for competitive intelligence in one call
  if (tool === 'compound_competitor_research') {
    const { company, competitors, aspects = ['pricing', 'features', 'reviews', 'recent news'], max_results = 5 } = args;
    if (!company) throw new Error('company is required');
    const search = await loadHandler('search');
    const targets = competitors?.length ? competitors : [company];
    const allResults = {};

    for (const target of targets) {
      allResults[target] = {};
      for (const aspect of aspects.slice(0, 3)) { // Limit to 3 aspects to avoid rate limiting
        try {
          const data = await search.execute('tavily_search', {
            query: `${target} ${aspect} 2024 2025`,
            max_results,
            search_depth: 'basic',
            include_answer: true
          });
          allResults[target][aspect] = {
            answer: data.answer,
            sources: (data.results || []).slice(0, 3).map(r => ({ title: r.title, url: r.url }))
          };
        } catch (e) { allResults[target][aspect] = { error: e.message }; }
      }
    }

    return {
      subject: company,
      competitors_researched: targets,
      aspects_covered: aspects.slice(0, 3),
      research: allResults,
      generated_at: new Date().toISOString()
    };
  }


    throw new Error(`Unknown compound tool: ${tool}`);
}

export default { execute };
