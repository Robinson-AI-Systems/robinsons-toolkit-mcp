/**
 * Anthropic Handler — 62 tools
 * Full Claude API coverage: messages (streaming, vision, PDF, structured,
 * cached, extended thinking), token counting, batches, files, models,
 * organizations & workspaces (admin API), usage reports, Super Tools.
 */

const BASE = 'https://api.anthropic.com/v1';
const MAX_BYTES = 100 * 1024;

function headers(extra = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set in .env');
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
    ...extra
  };
}

function adminHeaders(extra = {}) {
  const key = process.env.ANTHROPIC_ADMIN_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_ADMIN_KEY (or ANTHROPIC_API_KEY) not set in .env');
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
    ...extra
  };
}

async function ant(method, path, body, opts = {}) {
  const useAdmin = opts.admin === true;
  const useBeta = opts.beta;
  const h = useAdmin ? adminHeaders() : headers();
  if (useBeta) h['anthropic-beta'] = useBeta;
  const res = await fetch(`${BASE}${path}`, {
    method, headers: h,
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
  return data;
}

async function execute(tool, args) {

  // ── MESSAGES (Core) ───────────────────────────────────────────────────────
  if (tool === 'anthropic_message') {
    const { model = 'claude-sonnet-4-6', messages, system, max_tokens = 1024, temperature, tools: aiTools, tool_choice } = args;
    if (!messages) throw new Error('messages array is required');
    const body = { model, messages, max_tokens };
    if (system) body.system = system;
    if (temperature !== undefined) body.temperature = temperature;
    if (aiTools) body.tools = aiTools;
    if (tool_choice) body.tool_choice = tool_choice;
    const data = await ant('POST', '/messages', body);
    return {
      content: data.content?.[0]?.text,
      content_blocks: data.content,
      model: data.model,
      stop_reason: data.stop_reason,
      usage: data.usage
    };
  }
  if (tool === 'anthropic_message_with_tools') {
    // Client tools belong to the calling agent. Return the real tool requests;
    // never manufacture a tool_result or execute arbitrary model-selected tools.
    const { model = 'claude-sonnet-4-6', system, user_message, tools: aiTools, max_tokens = 2048 } = args;
    if (!user_message || !aiTools) throw new Error('user_message and tools are required');
    const messages = [{ role: 'user', content: user_message }];
    const data = await ant('POST', '/messages', { model, messages, system, max_tokens, tools: aiTools });
    const pending_tool_calls = (data.content || []).filter(block => block.type === 'tool_use');
    return {
      turns: [{ turn: 0, content: data.content, stop_reason: data.stop_reason }],
      final_response: pending_tool_calls.length ? null : (data.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n'),
      pending_tool_calls,
      messages: [...messages, { role: 'assistant', content: data.content }],
      stop_reason: data.stop_reason,
      usage: data.usage,
      continuation: pending_tool_calls.length ? 'Execute the requested client tools, then call anthropic_message with this messages array plus a user message containing the actual tool_result blocks and the same tools definitions.' : null,
      warnings: args.max_turns !== undefined ? ['max_turns is deprecated: client tool execution is delegated to the calling agent.'] : []
    };
  }
  if (tool === 'anthropic_count_tokens') {
    const { model = 'claude-sonnet-4-6', messages, system } = args;
    const data = await ant('POST', '/messages/count_tokens', { model, messages: messages || [], system });
    return { input_tokens: data.input_tokens };
  }

  // ── MODELS ────────────────────────────────────────────────────────────────
  if (tool === 'anthropic_list_models') { return await ant('GET', '/models'); }
  if (tool === 'anthropic_get_model') { return await ant('GET', `/models/${args.model_id}`); }

  // ── BATCH API ─────────────────────────────────────────────────────────────
  if (tool === 'anthropic_create_batch') {
    const { requests } = args;
    // requests: array of { custom_id, params: { model, messages, max_tokens, ... } }
    if (!requests || !Array.isArray(requests)) throw new Error('requests array is required');
    return await ant('POST', '/messages/batches', { requests });
  }
  if (tool === 'anthropic_get_batch') { return await ant('GET', `/messages/batches/${args.batch_id}`); }
  if (tool === 'anthropic_list_batches') { return await ant('GET', `/messages/batches?limit=${args.limit || 20}`); }
  if (tool === 'anthropic_cancel_batch') { return await ant('POST', `/messages/batches/${args.batch_id}/cancel`, {}); }
  if (tool === 'anthropic_get_batch_results') {
    // Download results — returns JSONL
    const res = await fetch(`${BASE}/messages/batches/${args.batch_id}/results`, { headers: headers() });
    if (!res.ok) throw new Error(`Batch results fetch failed: ${res.status}`);
    const text = await res.text();
    const lines = text.trim().split('\n').filter(Boolean);
    return { results: lines.map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } }), count: lines.length };
  }

  // ── FILES (Documents) ─────────────────────────────────────────────────────
  if (tool === 'anthropic_list_files') { return await ant('GET', `/files?limit=${args.limit || 20}`); }
  if (tool === 'anthropic_get_file') { return await ant('GET', `/files/${args.file_id}`); }
  if (tool === 'anthropic_delete_file') { return await ant('DELETE', `/files/${args.file_id}`); }

  // ── USAGE & BILLING ───────────────────────────────────────────────────────
  if (tool === 'anthropic_get_usage') {
    return await ant('GET', `/usage?start_time=${args.start_time || ''}&end_time=${args.end_time || ''}`);
  }

  // ── HELPER: quick ask ─────────────────────────────────────────────────────
  if (tool === 'anthropic_quick_ask') {
    const { question, model = 'claude-haiku-4-5-20251001', system } = args;
    const data = await ant('POST', '/messages', {
      model, max_tokens: 512,
      system: system || 'Be concise and direct.',
      messages: [{ role: 'user', content: question }]
    });
    return data.content?.[0]?.text;
  }

  // ── MESSAGES (DEEPER) ─────────────────────────────────────────────────────
  if (tool === 'anthropic_message_from_url') {
    const { url, question, model = 'claude-sonnet-4-6', system, max_tokens = 2048 } = args;
    if (!url || !question) throw new Error('url and question are required');
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Failed to fetch URL: ${r.status}`);
    const text = (await r.text()).slice(0, 50000);
    const data = await ant('POST', '/messages', { model, max_tokens, system, messages: [{ role: 'user', content: `Source URL: ${url}\n\n${text}\n\n---\n\n${question}` }] });
    return { content: data.content?.[0]?.text, source_size: text.length, usage: data.usage };
  }
  if (tool === 'anthropic_score_text') {
    const { text, criteria, scale = '1-10', model = 'claude-sonnet-4-6' } = args;
    if (!text || !criteria) throw new Error('text and criteria are required');
    const schema = { type: 'object', properties: Object.fromEntries(criteria.map(c => [c, { type: 'object', properties: { score: { type: 'number' }, reason: { type: 'string' } } }])) };
    const data = await ant('POST', '/messages', {
      model, max_tokens: 2048,
      system: `Score the input on each criterion using a ${scale} scale. Respond ONLY with valid JSON matching: ${JSON.stringify(schema)}.`,
      messages: [{ role: 'user', content: text }]
    });
    const raw = (data.content?.[0]?.text || '').replace(/^```json\n?|\n?```$/g, '').trim();
    try { return { scores: JSON.parse(raw), usage: data.usage }; }
    catch { return { scores: null, raw, parse_error: true, usage: data.usage }; }
  }
  if (tool === 'anthropic_redact_pii') {
    const { text, model = 'claude-haiku-4-5-20251001', replacement = '[REDACTED]' } = args;
    if (!text) throw new Error('text is required');
    const data = await ant('POST', '/messages', {
      model, max_tokens: 4096,
      system: `Redact all personally identifiable information (names, emails, phone numbers, SSNs, credit cards, physical addresses, dates of birth) from the input. Replace each PII instance with "${replacement}". Preserve all non-PII text exactly.`,
      messages: [{ role: 'user', content: text }]
    });
    return { redacted: data.content?.[0]?.text, usage: data.usage };
  }
  if (tool === 'anthropic_vision_message') {
    const { model = 'claude-sonnet-4-6', images = [], question, system, max_tokens = 1024 } = args;
    if (!question || !images.length) throw new Error('question and images[] are required');
    const content = [
      ...images.map(img => {
        if (img.url) return { type: 'image', source: { type: 'url', url: img.url } };
        if (img.base64) return { type: 'image', source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.base64 } };
        throw new Error('each image needs either {url} or {base64, media_type}');
      }),
      { type: 'text', text: question }
    ];
    const data = await ant('POST', '/messages', { model, max_tokens, system, messages: [{ role: 'user', content }] });
    return { content: data.content?.[0]?.text, content_blocks: data.content, usage: data.usage };
  }
  if (tool === 'anthropic_pdf_message') {
    const { model = 'claude-sonnet-4-6', pdf_base64, file_id, question, system, max_tokens = 2048 } = args;
    if (!question || (!pdf_base64 && !file_id)) throw new Error('question + (pdf_base64 or file_id) required');
    const docBlock = file_id
      ? { type: 'document', source: { type: 'file', file_id } }
      : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf_base64 } };
    const data = await ant('POST', '/messages', {
      model, max_tokens, system,
      messages: [{ role: 'user', content: [docBlock, { type: 'text', text: question }] }]
    }, { beta: 'pdfs-2024-09-25,files-api-2025-04-14' });
    return { content: data.content?.[0]?.text, content_blocks: data.content, usage: data.usage };
  }
  if (tool === 'anthropic_message_with_caching') {
    const { model = 'claude-sonnet-4-6', system, large_context, question, max_tokens = 1024 } = args;
    if (!large_context || !question) throw new Error('large_context and question are required');
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: large_context, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: question }
      ]
    }];
    const data = await ant('POST', '/messages', { model, max_tokens, system, messages });
    return {
      content: data.content?.[0]?.text,
      usage: data.usage,
      cache_read_input_tokens: data.usage?.cache_read_input_tokens,
      cache_creation_input_tokens: data.usage?.cache_creation_input_tokens
    };
  }
  if (tool === 'anthropic_message_with_thinking') {
    const { model = 'claude-opus-4-7', messages, system, max_tokens = 8192, thinking_budget = 5000 } = args;
    if (!messages) throw new Error('messages array is required');
    const data = await ant('POST', '/messages', {
      model, max_tokens, system, messages,
      thinking: { type: 'enabled', budget_tokens: thinking_budget }
    });
    return {
      content: data.content?.find(b => b.type === 'text')?.text,
      thinking: data.content?.find(b => b.type === 'thinking')?.thinking,
      content_blocks: data.content,
      usage: data.usage
    };
  }
  if (tool === 'anthropic_message_stream') {
    const { model = 'claude-sonnet-4-6', messages, system, max_tokens = 1024 } = args;
    if (!messages) throw new Error('messages array is required');
    const res = await fetch(`${BASE}/messages`, {
      method: 'POST',
      headers: headers({ 'accept': 'text/event-stream' }),
      body: JSON.stringify({ model, messages, system, max_tokens, stream: true })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(`Anthropic ${res.status}: ${e.error?.message}`); }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', text = '', usage = null, stop_reason = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'content_block_delta' && ev.delta?.text) text += ev.delta.text;
          if (ev.type === 'message_delta') { if (ev.delta?.stop_reason) stop_reason = ev.delta.stop_reason; if (ev.usage) usage = { ...usage, ...ev.usage }; }
          if (ev.type === 'message_start' && ev.message?.usage) usage = ev.message.usage;
        } catch { /* skip */ }
      }
    }
    return { content: text, usage, stop_reason };
  }
  if (tool === 'anthropic_extract_json') {
    const { model = 'claude-sonnet-4-6', text, schema, max_tokens = 2048 } = args;
    if (!text || !schema) throw new Error('text and schema (JSON Schema) are required');
    const system = `You extract structured data. Respond with ONLY a valid JSON object that matches this schema exactly: ${JSON.stringify(schema)}. No prose, no markdown.`;
    const data = await ant('POST', '/messages', { model, max_tokens, system, messages: [{ role: 'user', content: text }] });
    const raw = data.content?.[0]?.text || '';
    try { return { parsed: JSON.parse(raw.replace(/^```json\n?|\n?```$/g, '').trim()), raw, usage: data.usage }; }
    catch { return { parsed: null, raw, parse_error: true, usage: data.usage }; }
  }
  if (tool === 'anthropic_classify') {
    const { text, labels, model = 'claude-haiku-4-5-20251001' } = args;
    if (!text || !Array.isArray(labels) || !labels.length) throw new Error('text and labels[] are required');
    const data = await ant('POST', '/messages', {
      model, max_tokens: 50,
      system: `Classify the user's input into exactly one of these labels: ${labels.join(', ')}. Respond with ONLY the label.`,
      messages: [{ role: 'user', content: text }]
    });
    const out = (data.content?.[0]?.text || '').trim();
    return { label: labels.find(l => out.toLowerCase().includes(l.toLowerCase())) || out, raw: out };
  }
  if (tool === 'anthropic_summarize') {
    const { text, max_sentences = 3, model = 'claude-haiku-4-5-20251001' } = args;
    if (!text) throw new Error('text is required');
    const data = await ant('POST', '/messages', {
      model, max_tokens: 1024,
      system: `Summarize the user's text in at most ${max_sentences} sentences. Be precise and informative.`,
      messages: [{ role: 'user', content: text }]
    });
    return { summary: data.content?.[0]?.text, usage: data.usage };
  }
  if (tool === 'anthropic_translate') {
    const { text, target_language, source_language = 'auto-detected', model = 'claude-sonnet-4-6' } = args;
    if (!text || !target_language) throw new Error('text and target_language are required');
    const data = await ant('POST', '/messages', {
      model, max_tokens: 4096,
      system: `Translate from ${source_language} to ${target_language}. Respond with ONLY the translation.`,
      messages: [{ role: 'user', content: text }]
    });
    return { translation: data.content?.[0]?.text, usage: data.usage };
  }
  if (tool === 'anthropic_extract_entities') {
    const { text, entity_types = ['person', 'organization', 'location', 'date', 'email', 'phone', 'url'], model = 'claude-sonnet-4-6' } = args;
    if (!text) throw new Error('text is required');
    const schema = { type: 'object', properties: Object.fromEntries(entity_types.map(t => [t, { type: 'array', items: { type: 'string' } }])) };
    const system = `Extract entities from the text. Respond ONLY with valid JSON matching this schema: ${JSON.stringify(schema)}.`;
    const data = await ant('POST', '/messages', { model, max_tokens: 2048, system, messages: [{ role: 'user', content: text }] });
    const raw = data.content?.[0]?.text || '';
    try { return { entities: JSON.parse(raw.replace(/^```json\n?|\n?```$/g, '').trim()), usage: data.usage }; }
    catch { return { entities: null, raw, parse_error: true, usage: data.usage }; }
  }

  // ── FILES (DEEPER) ────────────────────────────────────────────────────────
  if (tool === 'anthropic_upload_file') {
    const { filename, content_base64, mime_type = 'application/octet-stream' } = args;
    if (!filename || !content_base64) throw new Error('filename and content_base64 required');
    const buf = Buffer.from(content_base64, 'base64');
    const form = new FormData();
    form.append('file', new Blob([buf], { type: mime_type }), filename);
    const res = await fetch(`${BASE}/files`, {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'files-api-2025-04-14' },
      body: form
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${data.error?.message}`);
    return data;
  }
  if (tool === 'anthropic_get_file_content') {
    const res = await fetch(`${BASE}/files/${args.file_id}/content`, {
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'files-api-2025-04-14' }
    });
    if (!res.ok) { const e = await res.json(); throw new Error(`Anthropic ${res.status}: ${e.error?.message}`); }
    const buf = await res.arrayBuffer();
    return { file_id: args.file_id, size_bytes: buf.byteLength, content_base64: Buffer.from(buf).toString('base64').slice(0, MAX_BYTES) };
  }
  if (tool === 'anthropic_upload_file_from_url') {
    const { url, filename } = args;
    if (!url) throw new Error('url is required');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') || 'application/octet-stream';
    const name = filename || url.split('/').pop() || 'download';
    const form = new FormData();
    form.append('file', new Blob([buf], { type: mime }), name);
    const upload = await fetch(`${BASE}/files`, {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'files-api-2025-04-14' },
      body: form
    });
    const data = await upload.json();
    if (!upload.ok) throw new Error(`Anthropic ${upload.status}: ${data.error?.message}`);
    return data;
  }

  // ── BATCHES (DEEPER) ──────────────────────────────────────────────────────
  if (tool === 'anthropic_batch_simple') {
    const { prompts, model = 'claude-haiku-4-5-20251001', system, max_tokens = 1024 } = args;
    if (!Array.isArray(prompts) || !prompts.length) throw new Error('prompts[] required');
    const requests = prompts.map((p, i) => ({
      custom_id: `req-${i}`,
      params: {
        model, max_tokens, system,
        messages: [{ role: 'user', content: typeof p === 'string' ? p : p.content }]
      }
    }));
    return await ant('POST', '/messages/batches', { requests });
  }
  if (tool === 'anthropic_wait_for_batch') {
    const { batch_id, poll_interval_ms = 5000, max_wait_ms = 300000 } = args;
    const start = Date.now();
    while (Date.now() - start < max_wait_ms) {
      const status = await ant('GET', `/messages/batches/${batch_id}`);
      if (status.processing_status === 'ended') return status;
      await new Promise(r => setTimeout(r, poll_interval_ms));
    }
    throw new Error(`Batch ${batch_id} did not complete within ${max_wait_ms}ms`);
  }
  if (tool === 'anthropic_delete_batch') { return await ant('DELETE', `/messages/batches/${args.batch_id}`); }

  // ── ADMIN: ORGANIZATIONS & WORKSPACES ─────────────────────────────────────
  if (tool === 'anthropic_list_workspaces') { return await ant('GET', `/organizations/workspaces?limit=${args.limit||20}`, null, { admin: true }); }
  if (tool === 'anthropic_get_workspace') { return await ant('GET', `/organizations/workspaces/${args.workspace_id}`, null, { admin: true }); }
  if (tool === 'anthropic_create_workspace') { return await ant('POST', '/organizations/workspaces', { name: args.name }, { admin: true }); }
  if (tool === 'anthropic_update_workspace') { return await ant('POST', `/organizations/workspaces/${args.workspace_id}`, { name: args.name }, { admin: true }); }
  if (tool === 'anthropic_archive_workspace') { return await ant('POST', `/organizations/workspaces/${args.workspace_id}/archive`, {}, { admin: true }); }
  if (tool === 'anthropic_list_workspace_members') { return await ant('GET', `/organizations/workspaces/${args.workspace_id}/members?limit=${args.limit||20}`, null, { admin: true }); }
  if (tool === 'anthropic_get_workspace_member') { return await ant('GET', `/organizations/workspaces/${args.workspace_id}/members/${args.user_id}`, null, { admin: true }); }
  if (tool === 'anthropic_add_workspace_member') { return await ant('POST', `/organizations/workspaces/${args.workspace_id}/members`, { user_id: args.user_id, workspace_role: args.role || 'workspace_user' }, { admin: true }); }
  if (tool === 'anthropic_update_workspace_member') { return await ant('POST', `/organizations/workspaces/${args.workspace_id}/members/${args.user_id}`, { workspace_role: args.role }, { admin: true }); }
  if (tool === 'anthropic_remove_workspace_member') { return await ant('DELETE', `/organizations/workspaces/${args.workspace_id}/members/${args.user_id}`, null, { admin: true }); }
  if (tool === 'anthropic_list_org_users') { return await ant('GET', `/organizations/users?limit=${args.limit||20}`, null, { admin: true }); }
  if (tool === 'anthropic_get_org_user') { return await ant('GET', `/organizations/users/${args.user_id}`, null, { admin: true }); }
  if (tool === 'anthropic_update_org_user') { return await ant('POST', `/organizations/users/${args.user_id}`, { role: args.role }, { admin: true }); }
  if (tool === 'anthropic_remove_org_user') { return await ant('DELETE', `/organizations/users/${args.user_id}`, null, { admin: true }); }
  if (tool === 'anthropic_list_org_invites') { return await ant('GET', `/organizations/invites?limit=${args.limit||20}`, null, { admin: true }); }
  if (tool === 'anthropic_create_org_invite') { return await ant('POST', '/organizations/invites', { email: args.email, role: args.role || 'user' }, { admin: true }); }
  if (tool === 'anthropic_delete_org_invite') { return await ant('DELETE', `/organizations/invites/${args.invite_id}`, null, { admin: true }); }

  // ── ADMIN: API KEYS ───────────────────────────────────────────────────────
  if (tool === 'anthropic_list_api_keys') { return await ant('GET', `/organizations/api_keys?limit=${args.limit||20}${args.workspace_id?`&workspace_id=${args.workspace_id}`:''}`, null, { admin: true }); }
  if (tool === 'anthropic_get_api_key') { return await ant('GET', `/organizations/api_keys/${args.api_key_id}`, null, { admin: true }); }
  if (tool === 'anthropic_update_api_key') {
    const body = {};
    if (args.name !== undefined) body.name = args.name;
    if (args.status !== undefined) body.status = args.status;
    return await ant('POST', `/organizations/api_keys/${args.api_key_id}`, body, { admin: true });
  }

  // ── USAGE & COST REPORTS ──────────────────────────────────────────────────
  if (tool === 'anthropic_get_usage_report') {
    const params = new URLSearchParams();
    if (args.starting_at) params.set('starting_at', args.starting_at);
    if (args.ending_at) params.set('ending_at', args.ending_at);
    if (args.group_by) params.set('group_by[]', args.group_by);
    if (args.bucket_width) params.set('bucket_width', args.bucket_width);
    return await ant('GET', `/organizations/usage_report/messages?${params.toString()}`, null, { admin: true });
  }
  if (tool === 'anthropic_get_cost_report') {
    const params = new URLSearchParams();
    if (args.starting_at) params.set('starting_at', args.starting_at);
    if (args.ending_at) params.set('ending_at', args.ending_at);
    if (args.group_by) params.set('group_by[]', args.group_by);
    return await ant('GET', `/organizations/cost_report?${params.toString()}`, null, { admin: true });
  }

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║                         SUPER TOOLS                                  ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  // SUPER TOOL: anthropic_summarize_long_doc
  // Chunk + summarize each chunk + merge summaries with Claude
  if (tool === 'anthropic_summarize_long_doc') {
    const { text, chunk_size = 8000, target_length = '3 paragraphs', model = 'claude-sonnet-4-6' } = args;
    if (!text) throw new Error('text is required');
    const chunks = [];
    for (let i = 0; i < text.length; i += chunk_size) chunks.push(text.slice(i, i + chunk_size));
    const summaries = [];
    for (let i = 0; i < chunks.length; i++) {
      const data = await ant('POST', '/messages', {
        model: 'claude-haiku-4-5-20251001', max_tokens: 1024,
        system: 'Summarize this section in dense, informative bullet points.',
        messages: [{ role: 'user', content: chunks[i] }]
      });
      summaries.push(data.content?.[0]?.text || '');
    }
    const final = await ant('POST', '/messages', {
      model, max_tokens: 2048,
      system: `You are given section summaries of a long document. Produce a final summary of length: ${target_length}.`,
      messages: [{ role: 'user', content: summaries.map((s, i) => `## Section ${i+1}\n${s}`).join('\n\n') }]
    });
    return { chunks_processed: chunks.length, final_summary: final.content?.[0]?.text, usage: final.usage };
  }

  // SUPER TOOL: anthropic_compare_models
  // Run the same prompt against multiple models and return side-by-side
  if (tool === 'anthropic_compare_models') {
    const { question, models = ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'], system, max_tokens = 1024 } = args;
    if (!question) throw new Error('question is required');
    const results = await Promise.all(models.map(async m => {
      const start = Date.now();
      try {
        const data = await ant('POST', '/messages', { model: m, max_tokens, system, messages: [{ role: 'user', content: question }] });
        return { model: m, response: data.content?.[0]?.text, usage: data.usage, latency_ms: Date.now() - start };
      } catch (e) { return { model: m, error: e.message, latency_ms: Date.now() - start }; }
    }));
    return { results };
  }

  // SUPER TOOL: anthropic_batch_classify
  // Classify a list of texts via the batch API
  if (tool === 'anthropic_batch_classify') {
    const { items, labels, model = 'claude-haiku-4-5-20251001' } = args;
    if (!Array.isArray(items) || !Array.isArray(labels)) throw new Error('items[] and labels[] are required');
    const requests = items.map((text, i) => ({
      custom_id: `cls-${i}`,
      params: {
        model, max_tokens: 30,
        system: `Classify into exactly one label: ${labels.join(', ')}. Respond with ONLY the label.`,
        messages: [{ role: 'user', content: text }]
      }
    }));
    const batch = await ant('POST', '/messages/batches', { requests });
    return { batch_id: batch.id, status: batch.processing_status, request_counts: batch.request_counts };
  }

  // SUPER TOOL: anthropic_extract_structured
  // Extract with JSON schema + retry once on parse failure
  if (tool === 'anthropic_extract_structured') {
    const { text, schema, model = 'claude-sonnet-4-6', max_retries = 1 } = args;
    if (!text || !schema) throw new Error('text and schema are required');
    let lastError = null;
    for (let attempt = 0; attempt <= max_retries; attempt++) {
      const system = `Extract structured data matching this JSON Schema exactly: ${JSON.stringify(schema)}. ${attempt > 0 ? `Previous attempt failed: ${lastError}. ` : ''}Respond with ONLY valid JSON, no markdown fences.`;
      const data = await ant('POST', '/messages', { model, max_tokens: 4096, system, messages: [{ role: 'user', content: text }] });
      const raw = (data.content?.[0]?.text || '').replace(/^```json\n?|\n?```$/g, '').trim();
      try { return { parsed: JSON.parse(raw), attempts: attempt + 1, usage: data.usage }; }
      catch (e) { lastError = e.message; }
    }
    throw new Error(`Failed to extract valid JSON after ${max_retries + 1} attempts: ${lastError}`);
  }

  // SUPER TOOL: anthropic_chat_session
  // Stateful chat — pass back the returned history to continue
  if (tool === 'anthropic_chat_session') {
    const { user_message, history = [], system, model = 'claude-sonnet-4-6', max_tokens = 1024 } = args;
    if (!user_message) throw new Error('user_message is required');
    const messages = [...history, { role: 'user', content: user_message }];
    const data = await ant('POST', '/messages', { model, max_tokens, system, messages });
    const assistant = { role: 'assistant', content: data.content };
    return {
      response: data.content?.[0]?.text,
      history: [...messages, assistant],
      usage: data.usage,
      stop_reason: data.stop_reason
    };
  }

  // ── ADMIN API (requires ANTHROPIC_ADMIN_KEY) ───────────────────────────────────────
  async function anthAdmin(method, path, body) {
    const key = process.env.ANTHROPIC_ADMIN_KEY;
    if (!key) throw new Error('ANTHROPIC_ADMIN_KEY not set in .env — workspace admin API requires admin key');
    const res = await fetch(`https://api.anthropic.com/v1${path}`, {
      method,
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Anthropic Admin API ${res.status}: ${err.error?.message || res.statusText}`);
    }
    return await res.json();
  }

  if (tool === 'anthropic_list_workspaces') {
    const data = await anthAdmin('GET', '/workspaces');
    return data.data || data;
  }

  if (tool === 'anthropic_get_workspace') {
    const { workspace_id } = args;
    if (!workspace_id) throw new Error('workspace_id is required');
    return await anthAdmin('GET', `/workspaces/${workspace_id}`);
  }

  if (tool === 'anthropic_list_workspace_members') {
    const { workspace_id } = args;
    if (!workspace_id) throw new Error('workspace_id is required');
    const data = await anthAdmin('GET', `/workspaces/${workspace_id}/members`);
    return data.data || data;
  }

  if (tool === 'anthropic_invite_workspace_member') {
    const { workspace_id, email, role = 'developer' } = args;
    if (!workspace_id || !email) throw new Error('workspace_id and email are required');
    return await anthAdmin('POST', `/workspaces/${workspace_id}/invites`, { email, role });
  }

  if (tool === 'anthropic_list_api_keys') {
    const { workspace_id } = args;
    const path = workspace_id ? `/workspaces/${workspace_id}/api_keys` : '/api_keys';
    const data = await anthAdmin('GET', path);
    return data.data || data;
  }

  if (tool === 'anthropic_create_api_key') {
    const { name, workspace_id } = args;
    if (!name) throw new Error('name is required');
    const body = { name };
    if (workspace_id) body.workspace_id = workspace_id;
    return await anthAdmin('POST', '/api_keys', body);
  }

  if (tool === 'anthropic_disable_api_key') {
    const { key_id } = args;
    if (!key_id) throw new Error('key_id is required');
    return await anthAdmin('POST', `/api_keys/${key_id}/disable`);
  }

  if (tool === 'anthropic_get_usage') {
    const { start_month, end_month, workspace_id } = args;
    let path = '/usage';
    const params = new URLSearchParams();
    if (start_month) params.set('start_month', start_month);
    if (end_month) params.set('end_month', end_month);
    if (workspace_id) params.set('workspace_id', workspace_id);
    if (params.toString()) path += `?${params}`;
    return await anthAdmin('GET', path);
  }

  throw new Error(`Unknown Anthropic tool: ${tool}`);
}

export default { execute };
