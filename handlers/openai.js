/**
 * OpenAI Handler — 102 tools
 * Chat & Responses API, embeddings, images, audio (TTS/STT), assistants,
 * threads, runs, files, vector stores (deep), batches, evals, realtime,
 * fine-tuning, moderation, admin (projects/keys), and Super Tools.
 */

const BASE = 'https://api.openai.com/v1';
const MAX_BYTES = 100 * 1024;

function headers(contentType = 'application/json') {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set in .env');
  const h = { 'Authorization': `Bearer ${key}` };
  if (contentType) h['Content-Type'] = contentType;
  return h;
}

function adminHeaders() {
  const key = process.env.OPENAI_ADMIN_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_ADMIN_KEY (or OPENAI_API_KEY) not set in .env');
  return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function oai(method, path, body, opts = {}) {
  const h = opts.admin ? adminHeaders() : (opts.multipart ? { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` } : headers());
  if (opts.beta) h['OpenAI-Beta'] = opts.beta;
  const res = await fetch(`${BASE}${path}`, {
    method, headers: h,
    body: opts.multipart ? body : (body ? JSON.stringify(body) : undefined)
  });
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
  return data;
}

async function oaiBinary(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`OpenAI ${res.status}: ${e.error?.message || 'binary fetch failed'}`); }
  return await res.arrayBuffer();
}

async function execute(tool, args) {

  // ── CHAT COMPLETIONS ──────────────────────────────────────────────────────
  if (tool === 'openai_chat_completion') {
    const { model = 'gpt-4o', messages, temperature, max_tokens, system, response_format, tools: aiTools, tool_choice } = args;
    if (!messages && !system) throw new Error('messages array or system prompt is required');
    const msgs = messages || [];
    if (system && !msgs.find(m => m.role === 'system')) msgs.unshift({ role: 'system', content: system });
    const body = { model, messages: msgs };
    if (temperature !== undefined) body.temperature = temperature;
    if (max_tokens) body.max_tokens = max_tokens;
    if (response_format) body.response_format = response_format;
    if (aiTools) body.tools = aiTools; if (tool_choice) body.tool_choice = tool_choice;
    const data = await oai('POST', '/chat/completions', body);
    return { content: data.choices?.[0]?.message?.content, finish_reason: data.choices?.[0]?.finish_reason, usage: data.usage, model: data.model };
  }
  if (tool === 'openai_chat_completion_json') {
    const { model = 'gpt-4o', messages, system, temperature } = args;
    const msgs = messages || [];
    if (system) msgs.unshift({ role: 'system', content: system + '\n\nRespond with valid JSON only.' });
    const body = { model, messages: msgs, response_format: { type: 'json_object' } };
    if (temperature !== undefined) body.temperature = temperature;
    const data = await oai('POST', '/chat/completions', body);
    const content = data.choices?.[0]?.message?.content;
    try { return JSON.parse(content); } catch { return { raw: content }; }
  }
  if (tool === 'openai_list_models') { return await oai('GET', '/models'); }
  if (tool === 'openai_get_model') { return await oai('GET', `/models/${args.model_id}`); }
  if (tool === 'openai_delete_model') { return await oai('DELETE', `/models/${args.model_id}`); }

  // ── EMBEDDINGS ────────────────────────────────────────────────────────────
  if (tool === 'openai_create_embedding') {
    const { input, model = 'text-embedding-3-small', dimensions } = args;
    if (!input) throw new Error('input is required');
    const body = { input: Array.isArray(input) ? input : [input], model };
    if (dimensions) body.dimensions = dimensions;
    const data = await oai('POST', '/embeddings', body);
    return { embeddings: data.data?.map(d => d.embedding), model: data.model, usage: data.usage };
  }
  if (tool === 'openai_create_embeddings_batch') {
    const { texts, model = 'text-embedding-3-small' } = args;
    if (!texts || !Array.isArray(texts)) throw new Error('texts array is required');
    const data = await oai('POST', '/embeddings', { input: texts, model });
    return { embeddings: data.data?.map(d => d.embedding), count: data.data?.length, usage: data.usage };
  }

  // ── IMAGES ────────────────────────────────────────────────────────────────
  if (tool === 'openai_generate_image') {
    const { prompt, model = 'dall-e-3', size = '1024x1024', quality = 'standard', n = 1, style = 'vivid', response_format = 'url' } = args;
    if (!prompt) throw new Error('prompt is required');
    const data = await oai('POST', '/images/generations', { prompt, model, size, quality, n, style, response_format });
    return { images: data.data?.map(img => ({ url: img.url, revised_prompt: img.revised_prompt })) };
  }
  if (tool === 'openai_edit_image') {
    const { image_base64, mask_base64, prompt, model = 'dall-e-2', size = '1024x1024', n = 1, response_format = 'url' } = args;
    if (!image_base64 || !prompt) throw new Error('image_base64 and prompt are required');
    const form = new FormData();
    form.append('image', new Blob([Buffer.from(image_base64, 'base64')], { type: 'image/png' }), 'image.png');
    if (mask_base64) form.append('mask', new Blob([Buffer.from(mask_base64, 'base64')], { type: 'image/png' }), 'mask.png');
    form.append('prompt', prompt); form.append('model', model); form.append('size', size); form.append('n', String(n)); form.append('response_format', response_format);
    const data = await oai('POST', '/images/edits', form, { multipart: true });
    return { images: data.data?.map(img => ({ url: img.url, b64_json: img.b64_json ? '[base64 omitted]' : undefined })) };
  }
  if (tool === 'openai_create_image_variation') {
    const { image_base64, model = 'dall-e-2', size = '1024x1024', n = 1, response_format = 'url' } = args;
    if (!image_base64) throw new Error('image_base64 is required');
    const form = new FormData();
    form.append('image', new Blob([Buffer.from(image_base64, 'base64')], { type: 'image/png' }), 'image.png');
    form.append('model', model); form.append('size', size); form.append('n', String(n)); form.append('response_format', response_format);
    const data = await oai('POST', '/images/variations', form, { multipart: true });
    return { images: data.data?.map(img => ({ url: img.url })) };
  }

  // ── AUDIO ─────────────────────────────────────────────────────────────────
  if (tool === 'openai_text_to_speech') {
    const { input, voice = 'alloy', model = 'tts-1', speed = 1, output_file } = args;
    if (!input) throw new Error('input text is required');
    const res = await fetch(`${BASE}/audio/speech`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ model, input, voice, speed })
    });
    if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return { audio_base64: base64, format: 'mp3', size_bytes: buffer.byteLength, note: output_file ? `Save the audio_base64 to ${output_file} using local_write_file with base64 decoding` : 'Audio returned as base64. Use local_write_file to save.' };
  }
  if (tool === 'openai_transcribe_audio') {
    const { audio_base64, filename = 'audio.mp3', model = 'whisper-1', language, prompt, response_format = 'json', temperature } = args;
    if (!audio_base64) throw new Error('audio_base64 is required');
    const mime = filename.endsWith('.wav') ? 'audio/wav' : filename.endsWith('.m4a') ? 'audio/m4a' : 'audio/mpeg';
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(audio_base64, 'base64')], { type: mime }), filename);
    form.append('model', model); form.append('response_format', response_format);
    if (language) form.append('language', language);
    if (prompt) form.append('prompt', prompt);
    if (temperature !== undefined) form.append('temperature', String(temperature));
    if (response_format === 'text' || response_format === 'srt' || response_format === 'vtt') {
      const res = await fetch(`${BASE}/audio/transcriptions`, { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
      const text = await res.text();
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${text}`);
      return { text };
    }
    return await oai('POST', '/audio/transcriptions', form, { multipart: true });
  }
  if (tool === 'openai_translate_audio') {
    const { audio_base64, filename = 'audio.mp3', model = 'whisper-1', prompt, response_format = 'json', temperature } = args;
    if (!audio_base64) throw new Error('audio_base64 is required');
    const mime = filename.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(audio_base64, 'base64')], { type: mime }), filename);
    form.append('model', model); form.append('response_format', response_format);
    if (prompt) form.append('prompt', prompt);
    if (temperature !== undefined) form.append('temperature', String(temperature));
    return await oai('POST', '/audio/translations', form, { multipart: true });
  }

  // ── ASSISTANTS ────────────────────────────────────────────────────────────
  if (tool === 'openai_list_assistants') {
    return await oai('GET', `/assistants?limit=${args.limit || 20}`, null);
  }
  if (tool === 'openai_create_assistant') {
    const { name, instructions, model = 'gpt-4o', tools: aiTools, file_ids } = args;
    const body = { name, instructions, model };
    if (aiTools) body.tools = aiTools; if (file_ids) body.file_ids = file_ids;
    return await oai('POST', '/assistants', body);
  }
  if (tool === 'openai_get_assistant') { return await oai('GET', `/assistants/${args.assistant_id}`); }
  if (tool === 'openai_update_assistant') {
    const { assistant_id, ...updates } = args;
    return await oai('POST', `/assistants/${assistant_id}`, updates);
  }
  if (tool === 'openai_delete_assistant') { return await oai('DELETE', `/assistants/${args.assistant_id}`); }

  // ── THREADS ───────────────────────────────────────────────────────────────
  if (tool === 'openai_create_thread') { return await oai('POST', '/threads', {}); }
  if (tool === 'openai_get_thread') { return await oai('GET', `/threads/${args.thread_id}`); }
  if (tool === 'openai_delete_thread') { return await oai('DELETE', `/threads/${args.thread_id}`); }
  if (tool === 'openai_add_message_to_thread') {
    return await oai('POST', `/threads/${args.thread_id}/messages`, { role: args.role || 'user', content: args.content });
  }
  if (tool === 'openai_list_thread_messages') {
    return await oai('GET', `/threads/${args.thread_id}/messages?limit=${args.limit || 20}`);
  }
  if (tool === 'openai_create_run') {
    const { thread_id, assistant_id, instructions, model, tools: aiTools } = args;
    const body = { assistant_id };
    if (instructions) body.additional_instructions = instructions;
    if (model) body.model = model; if (aiTools) body.tools = aiTools;
    return await oai('POST', `/threads/${thread_id}/runs`, body);
  }
  if (tool === 'openai_get_run') { return await oai('GET', `/threads/${args.thread_id}/runs/${args.run_id}`); }
  if (tool === 'openai_list_runs') { return await oai('GET', `/threads/${args.thread_id}/runs?limit=${args.limit || 20}`); }
  if (tool === 'openai_cancel_run') { return await oai('POST', `/threads/${args.thread_id}/runs/${args.run_id}/cancel`, {}); }
  if (tool === 'openai_create_thread_and_run') {
    const { assistant_id, messages, instructions } = args;
    return await oai('POST', '/threads/runs', { assistant_id, thread: { messages: messages || [] }, additional_instructions: instructions });
  }

  // ── FILES ─────────────────────────────────────────────────────────────────
  if (tool === 'openai_list_files') {
    return await oai('GET', `/files?purpose=${args.purpose || ''}`, null);
  }
  if (tool === 'openai_get_file') { return await oai('GET', `/files/${args.file_id}`); }
  if (tool === 'openai_delete_file') { return await oai('DELETE', `/files/${args.file_id}`); }

  // ── VECTOR STORES ─────────────────────────────────────────────────────────
  if (tool === 'openai_list_vector_stores') {
    return await oai('GET', `/vector_stores?limit=${args.limit || 20}`);
  }
  if (tool === 'openai_create_vector_store') {
    return await oai('POST', '/vector_stores', { name: args.name, file_ids: args.file_ids || [], expires_after: args.expires_after });
  }
  if (tool === 'openai_get_vector_store') { return await oai('GET', `/vector_stores/${args.vector_store_id}`); }
  if (tool === 'openai_delete_vector_store') { return await oai('DELETE', `/vector_stores/${args.vector_store_id}`); }
  if (tool === 'openai_search_vector_store') {
    return await oai('POST', `/vector_stores/${args.vector_store_id}/search`, { query: args.query, max_num_results: args.max_results || 10 });
  }

  // ── FINE-TUNING ───────────────────────────────────────────────────────────
  if (tool === 'openai_list_fine_tuning_jobs') { return await oai('GET', `/fine_tuning/jobs?limit=${args.limit || 20}`); }
  if (tool === 'openai_get_fine_tuning_job') { return await oai('GET', `/fine_tuning/jobs/${args.job_id}`); }
  if (tool === 'openai_create_fine_tuning_job') {
    return await oai('POST', '/fine_tuning/jobs', { training_file: args.training_file_id, model: args.model || 'gpt-4o-mini', hyperparameters: args.hyperparameters });
  }
  if (tool === 'openai_cancel_fine_tuning_job') { return await oai('POST', `/fine_tuning/jobs/${args.job_id}/cancel`, {}); }

  // ── MODERATION ────────────────────────────────────────────────────────────
  if (tool === 'openai_moderate_content') {
    const data = await oai('POST', '/moderations', { input: args.input, model: args.model || 'omni-moderation-latest' });
    return { flagged: data.results?.[0]?.flagged, categories: data.results?.[0]?.categories, scores: data.results?.[0]?.category_scores };
  }

  // ── USAGE ─────────────────────────────────────────────────────────────────
  if (tool === 'openai_get_usage') {
    return await oai('GET', `/usage?date=${args.date || new Date().toISOString().split('T')[0]}`);
  }

  // ── RESPONSES API (modern primitive) ──────────────────────────────────────
  if (tool === 'openai_create_response') {
    const { model = 'gpt-4o', input, instructions, tools: aiTools, tool_choice, temperature, max_output_tokens, response_format, store, previous_response_id, parallel_tool_calls } = args;
    if (!input) throw new Error('input is required');
    const body = { model, input };
    if (instructions) body.instructions = instructions;
    if (aiTools) body.tools = aiTools;
    if (tool_choice) body.tool_choice = tool_choice;
    if (temperature !== undefined) body.temperature = temperature;
    if (max_output_tokens) body.max_output_tokens = max_output_tokens;
    if (response_format) body.response_format = response_format;
    if (store !== undefined) body.store = store;
    if (previous_response_id) body.previous_response_id = previous_response_id;
    if (parallel_tool_calls !== undefined) body.parallel_tool_calls = parallel_tool_calls;
    const data = await oai('POST', '/responses', body);
    return {
      id: data.id, model: data.model, status: data.status,
      output_text: data.output_text,
      output: data.output,
      usage: data.usage
    };
  }
  if (tool === 'openai_get_response') { return await oai('GET', `/responses/${args.response_id}`); }
  if (tool === 'openai_delete_response') { return await oai('DELETE', `/responses/${args.response_id}`); }
  if (tool === 'openai_cancel_response') { return await oai('POST', `/responses/${args.response_id}/cancel`, {}); }
  if (tool === 'openai_list_response_input_items') { return await oai('GET', `/responses/${args.response_id}/input_items?limit=${args.limit||20}`); }

  // ── REALTIME API ──────────────────────────────────────────────────────────
  if (tool === 'openai_create_realtime_session') {
    const { model = 'gpt-4o-realtime-preview', voice = 'alloy', instructions, modalities = ['text', 'audio'], input_audio_format = 'pcm16', output_audio_format = 'pcm16', turn_detection } = args;
    const body = { model, voice, modalities, input_audio_format, output_audio_format };
    if (instructions) body.instructions = instructions;
    if (turn_detection) body.turn_detection = turn_detection;
    return await oai('POST', '/realtime/sessions', body);
  }
  if (tool === 'openai_create_realtime_transcription_session') {
    return await oai('POST', '/realtime/transcription_sessions', {
      model: args.model || 'gpt-4o-transcribe',
      input_audio_format: args.input_audio_format || 'pcm16',
      input_audio_transcription: args.input_audio_transcription || { model: 'whisper-1' }
    });
  }

  // ── BATCH API ─────────────────────────────────────────────────────────────
  if (tool === 'openai_create_batch') {
    return await oai('POST', '/batches', {
      input_file_id: args.input_file_id,
      endpoint: args.endpoint || '/v1/chat/completions',
      completion_window: args.completion_window || '24h',
      metadata: args.metadata
    });
  }
  if (tool === 'openai_get_batch') { return await oai('GET', `/batches/${args.batch_id}`); }
  if (tool === 'openai_cancel_batch') { return await oai('POST', `/batches/${args.batch_id}/cancel`, {}); }
  if (tool === 'openai_list_batches') { return await oai('GET', `/batches?limit=${args.limit||20}`); }

  // ── FILES (DEEPER) ────────────────────────────────────────────────────────
  if (tool === 'openai_upload_file') {
    const { filename, content_base64, purpose = 'assistants' } = args;
    if (!filename || !content_base64) throw new Error('filename and content_base64 required');
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(content_base64, 'base64')]), filename);
    form.append('purpose', purpose);
    return await oai('POST', '/files', form, { multipart: true });
  }
  if (tool === 'openai_get_file_content') {
    const res = await fetch(`${BASE}/files/${args.file_id}/content`, { headers: headers() });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`OpenAI ${res.status}: ${e.error?.message}`); }
    const buf = await res.arrayBuffer();
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text') || ct.includes('json')) return { file_id: args.file_id, content: new TextDecoder().decode(buf).slice(0, MAX_BYTES) };
    return { file_id: args.file_id, size_bytes: buf.byteLength, content_base64: Buffer.from(buf).toString('base64').slice(0, MAX_BYTES) };
  }

  // ── VECTOR STORES (DEEPER) ────────────────────────────────────────────────
  if (tool === 'openai_update_vector_store') {
    const { vector_store_id, name, expires_after, metadata } = args;
    const body = {};
    if (name !== undefined) body.name = name;
    if (expires_after !== undefined) body.expires_after = expires_after;
    if (metadata !== undefined) body.metadata = metadata;
    return await oai('POST', `/vector_stores/${vector_store_id}`, body);
  }
  if (tool === 'openai_list_vector_store_files') {
    return await oai('GET', `/vector_stores/${args.vector_store_id}/files?limit=${args.limit||20}&filter=${args.filter||''}`);
  }
  if (tool === 'openai_add_file_to_vector_store') {
    return await oai('POST', `/vector_stores/${args.vector_store_id}/files`, { file_id: args.file_id });
  }
  if (tool === 'openai_get_vector_store_file') {
    return await oai('GET', `/vector_stores/${args.vector_store_id}/files/${args.file_id}`);
  }
  if (tool === 'openai_delete_vector_store_file') {
    return await oai('DELETE', `/vector_stores/${args.vector_store_id}/files/${args.file_id}`);
  }
  if (tool === 'openai_create_vector_store_file_batch') {
    return await oai('POST', `/vector_stores/${args.vector_store_id}/file_batches`, { file_ids: args.file_ids });
  }
  if (tool === 'openai_get_vector_store_file_batch') {
    return await oai('GET', `/vector_stores/${args.vector_store_id}/file_batches/${args.batch_id}`);
  }
  if (tool === 'openai_cancel_vector_store_file_batch') {
    return await oai('POST', `/vector_stores/${args.vector_store_id}/file_batches/${args.batch_id}/cancel`, {});
  }
  if (tool === 'openai_list_vector_store_file_batch_files') {
    return await oai('GET', `/vector_stores/${args.vector_store_id}/file_batches/${args.batch_id}/files?limit=${args.limit||20}`);
  }

  // ── FINE-TUNING (DEEPER) ──────────────────────────────────────────────────
  if (tool === 'openai_list_fine_tuning_events') {
    return await oai('GET', `/fine_tuning/jobs/${args.job_id}/events?limit=${args.limit||20}`);
  }
  if (tool === 'openai_list_fine_tuning_checkpoints') {
    return await oai('GET', `/fine_tuning/jobs/${args.job_id}/checkpoints?limit=${args.limit||10}`);
  }
  if (tool === 'openai_pause_fine_tuning_job') { return await oai('POST', `/fine_tuning/jobs/${args.job_id}/pause`, {}); }
  if (tool === 'openai_resume_fine_tuning_job') { return await oai('POST', `/fine_tuning/jobs/${args.job_id}/resume`, {}); }

  // ── ASSISTANTS / THREADS (DEEPER) ─────────────────────────────────────────
  if (tool === 'openai_get_thread_message') {
    return await oai('GET', `/threads/${args.thread_id}/messages/${args.message_id}`);
  }
  if (tool === 'openai_update_thread_message') {
    return await oai('POST', `/threads/${args.thread_id}/messages/${args.message_id}`, { metadata: args.metadata });
  }
  if (tool === 'openai_delete_thread_message') {
    return await oai('DELETE', `/threads/${args.thread_id}/messages/${args.message_id}`);
  }
  if (tool === 'openai_modify_thread') {
    return await oai('POST', `/threads/${args.thread_id}`, { metadata: args.metadata, tool_resources: args.tool_resources });
  }
  if (tool === 'openai_modify_run') {
    return await oai('POST', `/threads/${args.thread_id}/runs/${args.run_id}`, { metadata: args.metadata });
  }
  if (tool === 'openai_submit_tool_outputs') {
    return await oai('POST', `/threads/${args.thread_id}/runs/${args.run_id}/submit_tool_outputs`, { tool_outputs: args.tool_outputs });
  }
  if (tool === 'openai_list_run_steps') {
    return await oai('GET', `/threads/${args.thread_id}/runs/${args.run_id}/steps?limit=${args.limit||20}`);
  }
  if (tool === 'openai_get_run_step') {
    return await oai('GET', `/threads/${args.thread_id}/runs/${args.run_id}/steps/${args.step_id}`);
  }

  // ── EVALS ─────────────────────────────────────────────────────────────────
  if (tool === 'openai_create_eval') {
    return await oai('POST', '/evals', { name: args.name, data_source_config: args.data_source_config, testing_criteria: args.testing_criteria, metadata: args.metadata });
  }
  if (tool === 'openai_get_eval') { return await oai('GET', `/evals/${args.eval_id}`); }
  if (tool === 'openai_list_evals') { return await oai('GET', `/evals?limit=${args.limit||20}`); }
  if (tool === 'openai_delete_eval') { return await oai('DELETE', `/evals/${args.eval_id}`); }
  if (tool === 'openai_update_eval') { return await oai('POST', `/evals/${args.eval_id}`, { name: args.name, metadata: args.metadata }); }
  if (tool === 'openai_create_eval_run') {
    return await oai('POST', `/evals/${args.eval_id}/runs`, { name: args.name, data_source: args.data_source, metadata: args.metadata });
  }
  if (tool === 'openai_get_eval_run') { return await oai('GET', `/evals/${args.eval_id}/runs/${args.run_id}`); }
  if (tool === 'openai_list_eval_runs') { return await oai('GET', `/evals/${args.eval_id}/runs?limit=${args.limit||20}`); }
  if (tool === 'openai_cancel_eval_run') { return await oai('POST', `/evals/${args.eval_id}/runs/${args.run_id}/cancel`, {}); }
  if (tool === 'openai_list_eval_run_output_items') { return await oai('GET', `/evals/${args.eval_id}/runs/${args.run_id}/output_items?limit=${args.limit||20}`); }

  // ── ADMIN: ORGS, PROJECTS, KEYS ───────────────────────────────────────────
  if (tool === 'openai_list_projects') { return await oai('GET', `/organization/projects?limit=${args.limit||20}`, null, { admin: true }); }
  if (tool === 'openai_get_project') { return await oai('GET', `/organization/projects/${args.project_id}`, null, { admin: true }); }
  if (tool === 'openai_create_project') { return await oai('POST', '/organization/projects', { name: args.name }, { admin: true }); }
  if (tool === 'openai_update_project') { return await oai('POST', `/organization/projects/${args.project_id}`, { name: args.name }, { admin: true }); }
  if (tool === 'openai_archive_project') { return await oai('POST', `/organization/projects/${args.project_id}/archive`, {}, { admin: true }); }
  if (tool === 'openai_list_project_api_keys') { return await oai('GET', `/organization/projects/${args.project_id}/api_keys?limit=${args.limit||20}`, null, { admin: true }); }
  if (tool === 'openai_get_project_api_key') { return await oai('GET', `/organization/projects/${args.project_id}/api_keys/${args.key_id}`, null, { admin: true }); }
  if (tool === 'openai_delete_project_api_key') { return await oai('DELETE', `/organization/projects/${args.project_id}/api_keys/${args.key_id}`, null, { admin: true }); }
  if (tool === 'openai_list_project_users') { return await oai('GET', `/organization/projects/${args.project_id}/users?limit=${args.limit||20}`, null, { admin: true }); }
  if (tool === 'openai_list_org_users') { return await oai('GET', `/organization/users?limit=${args.limit||20}`, null, { admin: true }); }
  if (tool === 'openai_list_org_invites') { return await oai('GET', `/organization/invites?limit=${args.limit||20}`, null, { admin: true }); }
  if (tool === 'openai_create_org_invite') { return await oai('POST', '/organization/invites', { email: args.email, role: args.role || 'reader' }, { admin: true }); }
  if (tool === 'openai_delete_org_invite') { return await oai('DELETE', `/organization/invites/${args.invite_id}`, null, { admin: true }); }
  if (tool === 'openai_get_org_costs') {
    const params = new URLSearchParams();
    if (args.start_time) params.set('start_time', String(args.start_time));
    if (args.end_time) params.set('end_time', String(args.end_time));
    if (args.bucket_width) params.set('bucket_width', args.bucket_width);
    if (args.group_by) params.set('group_by[]', args.group_by);
    return await oai('GET', `/organization/costs?${params.toString()}`, null, { admin: true });
  }
  if (tool === 'openai_get_org_usage_completions') {
    const params = new URLSearchParams();
    if (args.start_time) params.set('start_time', String(args.start_time));
    if (args.end_time) params.set('end_time', String(args.end_time));
    if (args.bucket_width) params.set('bucket_width', args.bucket_width);
    return await oai('GET', `/organization/usage/completions?${params.toString()}`, null, { admin: true });
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────
  if (tool === 'openai_estimate_tokens') {
    // Rough token approximation: ~4 chars per token for English; uses splits for punctuation
    const { text } = args;
    if (!text) throw new Error('text required');
    const approx = Math.ceil(text.length / 4);
    const word_approx = text.trim().split(/\s+/).length;
    return { char_count: text.length, word_count: word_approx, approx_tokens: approx, note: 'Approximation only. Use tiktoken for exact counts.' };
  }
  if (tool === 'openai_list_voices') {
    return { voices: [
      { id: 'alloy', description: 'Neutral, balanced' },
      { id: 'ash', description: 'Warm, friendly' },
      { id: 'ballad', description: 'Soft, melodic' },
      { id: 'coral', description: 'Calm, professional' },
      { id: 'echo', description: 'Male, expressive' },
      { id: 'fable', description: 'British accent, narrative' },
      { id: 'nova', description: 'Female, energetic' },
      { id: 'onyx', description: 'Male, deep' },
      { id: 'sage', description: 'Wise, thoughtful' },
      { id: 'shimmer', description: 'Female, soft' },
      { id: 'verse', description: 'Versatile' }
    ]};
  }
  if (tool === 'openai_text_to_speech_save') {
    const { input, voice = 'alloy', model = 'tts-1', speed = 1, format = 'mp3' } = args;
    if (!input) throw new Error('input required');
    const res = await fetch(`${BASE}/audio/speech`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ model, input, voice, speed, response_format: format })
    });
    if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
    const buffer = await res.arrayBuffer();
    return { audio_base64: Buffer.from(buffer).toString('base64'), format, size_bytes: buffer.byteLength };
  }

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║                         SUPER TOOLS                                  ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  // SUPER TOOL: openai_rag_query
  // Embed query → search vector store → generate answer with context
  if (tool === 'openai_rag_query') {
    const { query, vector_store_id, model = 'gpt-4o', max_results = 5, embedding_model = 'text-embedding-3-small', system } = args;
    if (!query || !vector_store_id) throw new Error('query and vector_store_id required');
    const search = await oai('POST', `/vector_stores/${vector_store_id}/search`, { query, max_num_results: max_results });
    const context = (search.data || []).map((r, i) => `[Doc ${i+1}] ${r.content?.[0]?.text || JSON.stringify(r)}`).join('\n\n');
    const completion = await oai('POST', '/chat/completions', {
      model,
      messages: [
        { role: 'system', content: system || 'Answer the user using ONLY the provided context. Cite docs as [Doc N].' },
        { role: 'user', content: `CONTEXT:\n${context}\n\nQUESTION: ${query}` }
      ]
    });
    return {
      answer: completion.choices?.[0]?.message?.content,
      sources_count: search.data?.length || 0,
      sources: search.data?.map(r => ({ file_id: r.file_id, score: r.score })),
      usage: completion.usage
    };
  }

  // SUPER TOOL: openai_batch_embed_and_store
  // Generate embeddings + add to vector store in one call
  if (tool === 'openai_batch_embed_and_store') {
    const { texts, vector_store_id, embedding_model = 'text-embedding-3-small' } = args;
    if (!Array.isArray(texts) || !vector_store_id) throw new Error('texts[] and vector_store_id required');
    // Embeddings (returned but the vector store handles its own indexing via files)
    const emb = await oai('POST', '/embeddings', { input: texts, model: embedding_model });
    // Upload each text as a file and attach to vector store
    const file_ids = [];
    for (let i = 0; i < texts.length; i++) {
      const form = new FormData();
      form.append('file', new Blob([texts[i]], { type: 'text/plain' }), `doc-${i}.txt`);
      form.append('purpose', 'assistants');
      const f = await oai('POST', '/files', form, { multipart: true });
      file_ids.push(f.id);
    }
    const batch = await oai('POST', `/vector_stores/${vector_store_id}/file_batches`, { file_ids });
    return { embeddings_generated: emb.data?.length, files_uploaded: file_ids.length, batch_id: batch.id, batch_status: batch.status };
  }

  // SUPER TOOL: openai_assistant_thread_complete
  // Create thread + add user message + create run + poll until complete + return last assistant message
  if (tool === 'openai_assistant_thread_complete') {
    const { assistant_id, user_message, instructions, poll_interval_ms = 1500, max_wait_ms = 120000 } = args;
    if (!assistant_id || !user_message) throw new Error('assistant_id and user_message required');
    const thread = await oai('POST', '/threads', {});
    await oai('POST', `/threads/${thread.id}/messages`, { role: 'user', content: user_message });
    const run = await oai('POST', `/threads/${thread.id}/runs`, { assistant_id, additional_instructions: instructions });
    const start = Date.now();
    let final = run;
    while (Date.now() - start < max_wait_ms) {
      const status = await oai('GET', `/threads/${thread.id}/runs/${run.id}`);
      if (['completed', 'failed', 'cancelled', 'expired', 'requires_action'].includes(status.status)) { final = status; break; }
      await new Promise(r => setTimeout(r, poll_interval_ms));
    }
    const messages = await oai('GET', `/threads/${thread.id}/messages?limit=10`);
    const last_assistant = messages.data?.find(m => m.role === 'assistant');
    return {
      thread_id: thread.id, run_id: run.id, status: final.status,
      response: last_assistant?.content?.[0]?.text?.value,
      usage: final.usage,
      requires_action: final.status === 'requires_action' ? final.required_action : null
    };
  }

  // SUPER TOOL: openai_structured_extraction
  // Extract JSON matching a schema with retry on parse failure
  if (tool === 'openai_structured_extraction') {
    const { text, schema, model = 'gpt-4o', max_retries = 1 } = args;
    if (!text || !schema) throw new Error('text and schema required');
    let lastError = null;
    for (let attempt = 0; attempt <= max_retries; attempt++) {
      const system = `Extract structured data matching this JSON Schema EXACTLY: ${JSON.stringify(schema)}. ${attempt > 0 ? `Previous attempt failed: ${lastError}. ` : ''}Respond with ONLY valid JSON.`;
      const data = await oai('POST', '/chat/completions', {
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
        response_format: { type: 'json_object' }
      });
      const raw = data.choices?.[0]?.message?.content || '';
      try { return { parsed: JSON.parse(raw), attempts: attempt + 1, usage: data.usage }; }
      catch (e) { lastError = e.message; }
    }
    throw new Error(`Failed to extract valid JSON after ${max_retries + 1} attempts: ${lastError}`);
  }

  // SUPER TOOL: openai_fine_tune_pipeline
  // Upload training file + start fine-tuning job + return job info
  if (tool === 'openai_fine_tune_pipeline') {
    const { training_jsonl_base64, validation_jsonl_base64, filename = 'training.jsonl', model = 'gpt-4o-mini', hyperparameters, suffix } = args;
    if (!training_jsonl_base64) throw new Error('training_jsonl_base64 required');
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(training_jsonl_base64, 'base64')], { type: 'application/jsonl' }), filename);
    form.append('purpose', 'fine-tune');
    const trainingFile = await oai('POST', '/files', form, { multipart: true });
    let validation_file_id;
    if (validation_jsonl_base64) {
      const vform = new FormData();
      vform.append('file', new Blob([Buffer.from(validation_jsonl_base64, 'base64')], { type: 'application/jsonl' }), filename.replace('.jsonl', '-val.jsonl'));
      vform.append('purpose', 'fine-tune');
      const v = await oai('POST', '/files', vform, { multipart: true });
      validation_file_id = v.id;
    }
    const jobBody = { training_file: trainingFile.id, model };
    if (validation_file_id) jobBody.validation_file = validation_file_id;
    if (hyperparameters) jobBody.hyperparameters = hyperparameters;
    if (suffix) jobBody.suffix = suffix;
    const job = await oai('POST', '/fine_tuning/jobs', jobBody);
    return { training_file_id: trainingFile.id, validation_file_id, fine_tuning_job_id: job.id, status: job.status };
  }

  // ── ADMIN API (requires OPENAI_ADMIN_KEY) ──────────────────────────────────────────
  async function admin(method, path, body) {
    const key = process.env.OPENAI_ADMIN_KEY;
    if (!key) throw new Error('OPENAI_ADMIN_KEY not set in .env — org admin API requires admin key');
    const res = await fetch(`https://api.openai.com/v1${path}`, {
      method,
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`OpenAI Admin API ${res.status}: ${err.error?.message || res.statusText}`);
    }
    return await res.json();
  }

  if (tool === 'openai_invite_user') {
    const { email, role = 'reader' } = args;
    if (!email) throw new Error('email is required');
    return await admin('POST', '/organization/invites', { email, role });
  }

  if (tool === 'openai_remove_user') {
    const { user_id } = args;
    if (!user_id) throw new Error('user_id is required');
    return await admin('DELETE', `/organization/users/${user_id}`);
  }

  if (tool === 'openai_get_costs') {
    const { start_time, bucket_width = '1d', limit = 30 } = args;
    const params = new URLSearchParams({ bucket_width, limit });
    if (start_time) params.set('start_time', start_time);
    const data = await admin('GET', `/organization/costs?${params}`);
    return data;
  }

  if (tool === 'openai_list_api_keys') {
    const { limit = 20 } = args;
    const data = await admin('GET', `/organization/api_keys?limit=${limit}`);
    return data.data || data;
  }

  if (tool === 'openai_create_api_key') {
    const { name, project_id } = args;
    if (!name) throw new Error('name is required');
    const body = { name };
    if (project_id) body.project_id = project_id;
    return await admin('POST', '/organization/api_keys', body);
  }

  if (tool === 'openai_delete_api_key') {
    const { key_id } = args;
    if (!key_id) throw new Error('key_id is required');
    return await admin('DELETE', `/organization/api_keys/${key_id}`);
  }

  throw new Error(`Unknown OpenAI tool: ${tool}`);

  // ── ORG ADMIN: RATE LIMITS ────────────────────────────────────────────────
  if (tool === 'openai_list_project_rate_limits') {
    const { project_id, limit = 100 } = args;
    if (!project_id) throw new Error('project_id is required');
    return await oai('GET', `/organization/projects/${project_id}/rate_limits?limit=${limit}`, null, { admin: true });
  }
  if (tool === 'openai_update_project_rate_limit') {
    const { project_id, rate_limit_id, max_requests_per_1_minute, max_tokens_per_1_minute, max_images_per_1_minute, max_audio_megabytes_per_1_minute, max_requests_per_1_day, max_tokens_per_1_day } = args;
    if (!project_id || !rate_limit_id) throw new Error('project_id and rate_limit_id are required');
    const body = {};
    if (max_requests_per_1_minute !== undefined) body.max_requests_per_1_minute = max_requests_per_1_minute;
    if (max_tokens_per_1_minute !== undefined) body.max_tokens_per_1_minute = max_tokens_per_1_minute;
    if (max_images_per_1_minute !== undefined) body.max_images_per_1_minute = max_images_per_1_minute;
    if (max_audio_megabytes_per_1_minute !== undefined) body.max_audio_megabytes_per_1_minute = max_audio_megabytes_per_1_minute;
    if (max_requests_per_1_day !== undefined) body.max_requests_per_1_day = max_requests_per_1_day;
    if (max_tokens_per_1_day !== undefined) body.max_tokens_per_1_day = max_tokens_per_1_day;
    return await oai('POST', `/organization/projects/${project_id}/rate_limits/${rate_limit_id}`, body, { admin: true });
  }

  // ── ORG ADMIN: SERVICE ACCOUNTS ───────────────────────────────────────────
  if (tool === 'openai_list_project_service_accounts') {
    const { project_id, limit = 20 } = args;
    if (!project_id) throw new Error('project_id is required');
    return await oai('GET', `/organization/projects/${project_id}/service_accounts?limit=${limit}`, null, { admin: true });
  }
  if (tool === 'openai_create_project_service_account') {
    const { project_id, name } = args;
    if (!project_id || !name) throw new Error('project_id and name are required');
    return await oai('POST', `/organization/projects/${project_id}/service_accounts`, { name }, { admin: true });
  }
  if (tool === 'openai_delete_project_service_account') {
    const { project_id, service_account_id } = args;
    if (!project_id || !service_account_id) throw new Error('project_id and service_account_id are required');
    return await oai('DELETE', `/organization/projects/${project_id}/service_accounts/${service_account_id}`, null, { admin: true });
  }

  // ── ORG ADMIN: AUDIT LOGS ─────────────────────────────────────────────────
  if (tool === 'openai_list_audit_logs') {
    const { limit = 20, after, before, actor_id, event_type, project_id } = args;
    let path = `/organization/audit_logs?limit=${limit}`;
    if (after) path += `&after=${after}`;
    if (before) path += `&before=${before}`;
    if (actor_id) path += `&actor_ids[]=${actor_id}`;
    if (event_type) path += `&event_types[]=${event_type}`;
    if (project_id) path += `&project_ids[]=${project_id}`;
    return await oai('GET', path, null, { admin: true });
  }

  // ── USAGE & COST ANALYTICS ────────────────────────────────────────────────
  if (tool === 'openai_get_usage_completions') {
    const { start_time, end_time, bucket_width = '1d', group_by, project_id, model, limit = 7 } = args;
    if (!start_time) throw new Error('start_time (Unix timestamp) is required');
    let path = `/organization/usage/completions?start_time=${start_time}&bucket_width=${bucket_width}&limit=${limit}`;
    if (end_time) path += `&end_time=${end_time}`;
    if (project_id) path += `&project_ids[]=${project_id}`;
    if (model) path += `&models[]=${model}`;
    if (group_by) (Array.isArray(group_by) ? group_by : [group_by]).forEach(g => path += `&group_by[]=${g}`);
    return await oai('GET', path, null, { admin: true });
  }
  if (tool === 'openai_get_usage_embeddings') {
    const { start_time, end_time, bucket_width = '1d', limit = 7 } = args;
    if (!start_time) throw new Error('start_time is required');
    let path = `/organization/usage/embeddings?start_time=${start_time}&bucket_width=${bucket_width}&limit=${limit}`;
    if (end_time) path += `&end_time=${end_time}`;
    return await oai('GET', path, null, { admin: true });
  }
  if (tool === 'openai_get_usage_images') {
    const { start_time, end_time, bucket_width = '1d', limit = 7 } = args;
    if (!start_time) throw new Error('start_time is required');
    let path = `/organization/usage/images?start_time=${start_time}&bucket_width=${bucket_width}&limit=${limit}`;
    if (end_time) path += `&end_time=${end_time}`;
    return await oai('GET', path, null, { admin: true });
  }
  if (tool === 'openai_get_usage_audio_speeches') {
    const { start_time, end_time, bucket_width = '1d', limit = 7 } = args;
    if (!start_time) throw new Error('start_time is required');
    let path = `/organization/usage/audio_speeches?start_time=${start_time}&bucket_width=${bucket_width}&limit=${limit}`;
    if (end_time) path += `&end_time=${end_time}`;
    return await oai('GET', path, null, { admin: true });
  }
  if (tool === 'openai_get_usage_audio_transcriptions') {
    const { start_time, end_time, bucket_width = '1d', limit = 7 } = args;
    if (!start_time) throw new Error('start_time is required');
    let path = `/organization/usage/audio_transcriptions?start_time=${start_time}&bucket_width=${bucket_width}&limit=${limit}`;
    if (end_time) path += `&end_time=${end_time}`;
    return await oai('GET', path, null, { admin: true });
  }
  if (tool === 'openai_get_usage_moderations') {
    const { start_time, end_time, bucket_width = '1d', limit = 7 } = args;
    if (!start_time) throw new Error('start_time is required');
    let path = `/organization/usage/moderations?start_time=${start_time}&bucket_width=${bucket_width}&limit=${limit}`;
    if (end_time) path += `&end_time=${end_time}`;
    return await oai('GET', path, null, { admin: true });
  }
  if (tool === 'openai_get_usage_vector_stores') {
    const { start_time, end_time, bucket_width = '1d', limit = 7 } = args;
    if (!start_time) throw new Error('start_time is required');
    let path = `/organization/usage/vector_stores?start_time=${start_time}&bucket_width=${bucket_width}&limit=${limit}`;
    if (end_time) path += `&end_time=${end_time}`;
    return await oai('GET', path, null, { admin: true });
  }
  if (tool === 'openai_get_usage_code_interpreter') {
    const { start_time, end_time, bucket_width = '1d', limit = 7 } = args;
    if (!start_time) throw new Error('start_time is required');
    let path = `/organization/usage/code_interpreter_sessions?start_time=${start_time}&bucket_width=${bucket_width}&limit=${limit}`;
    if (end_time) path += `&end_time=${end_time}`;
    return await oai('GET', path, null, { admin: true });
  }

  // ── MODEL DEPRECATION & LIFECYCLE ─────────────────────────────────────────
  if (tool === 'openai_check_model_deprecation') {
    const { model } = args;
    if (!model) throw new Error('model is required');
    const models = await oai('GET', '/models', null);
    const found = (models.data || []).find(m => m.id === model);
    if (!found) return { model, status: 'not_found', message: `Model ${model} not found in available models` };
    // Models in deprecation typically have specific IDs - check naming convention
    const isLegacy = model.includes('instruct') || model.includes('0301') || model.includes('0314') || model.includes('0613') || /davinci|curie|babbage|ada/.test(model);
    const isCurrent = model.includes('gpt-4o') || model.includes('gpt-4-turbo') || model.includes('o1') || model.includes('o3');
    return {
      model,
      found: true,
      object: found.object,
      created: new Date(found.created * 1000).toISOString(),
      owned_by: found.owned_by,
      deprecation_risk: isLegacy ? 'high' : (isCurrent ? 'low' : 'medium'),
      recommendation: isLegacy ? `Consider migrating from ${model} to gpt-4o or gpt-4o-mini` : (isCurrent ? 'Current generation model — low deprecation risk' : 'Monitor OpenAI announcements for deprecation schedule')
    };
  }

  // ── FINE-TUNING ADVANCED ──────────────────────────────────────────────────
  if (tool === 'openai_list_fine_tuning_jobs_for_model') {
    const { base_model, limit = 20 } = args;
    const jobs = await oai('GET', `/fine_tuning/jobs?limit=${limit}`, null);
    if (!base_model) return jobs;
    return { ...jobs, data: (jobs.data || []).filter(j => j.model === base_model || j.fine_tuned_model?.startsWith(base_model)) };
  }

  // ── SUPER TOOL: Full org cost report ─────────────────────────────────────
  if (tool === 'openai_org_cost_report') {
    const now = Math.floor(Date.now() / 1000);
    const thirtyDaysAgo = now - (30 * 24 * 3600);
    const [costs, completionsUsage, projects] = await Promise.all([
      oai('GET', `/organization/costs?start_time=${thirtyDaysAgo}&bucket_width=1d&limit=30`, null, { admin: true }).catch(() => null),
      oai('GET', `/organization/usage/completions?start_time=${thirtyDaysAgo}&bucket_width=1d&group_by[]=model&limit=30`, null, { admin: true }).catch(() => null),
      oai('GET', '/organization/projects?limit=20', null, { admin: true }).catch(() => null)
    ]);
    const totalCost = costs?.data?.reduce((sum, b) => sum + (b.results?.[0]?.amount?.value || 0), 0) || 0;
    return {
      period: '30 days',
      start: new Date(thirtyDaysAgo * 1000).toISOString(),
      end: new Date(now * 1000).toISOString(),
      total_cost_usd: Math.round(totalCost * 100) / 100,
      daily_breakdown: costs?.data?.map(b => ({ date: b.start_time, cost_usd: b.results?.[0]?.amount?.value || 0 })) || [],
      projects_count: projects?.data?.length || 0,
      generated_at: new Date().toISOString()
    };
  }

  // ── SUPER TOOL: Model usage breakdown ─────────────────────────────────────
  if (tool === 'openai_model_usage_breakdown') {
    const now = Math.floor(Date.now() / 1000);
    const start_time = args.start_time || (now - 7 * 24 * 3600);
    const [completions, embeddings, images, tts] = await Promise.all([
      oai('GET', `/organization/usage/completions?start_time=${start_time}&bucket_width=1d&group_by[]=model&limit=7`, null, { admin: true }).catch(() => null),
      oai('GET', `/organization/usage/embeddings?start_time=${start_time}&bucket_width=1d&group_by[]=model&limit=7`, null, { admin: true }).catch(() => null),
      oai('GET', `/organization/usage/images?start_time=${start_time}&bucket_width=1d&group_by[]=model&limit=7`, null, { admin: true }).catch(() => null),
      oai('GET', `/organization/usage/audio_speeches?start_time=${start_time}&bucket_width=1d&group_by[]=model&limit=7`, null, { admin: true }).catch(() => null)
    ]);
    const summarize = (data, label) => {
      const modelMap = {};
      for (const bucket of (data?.data || [])) {
        for (const r of (bucket.results || [])) {
          const m = r.model || 'unknown';
          if (!modelMap[m]) modelMap[m] = { requests: 0, input_tokens: 0, output_tokens: 0 };
          modelMap[m].requests += r.num_model_requests || 0;
          modelMap[m].input_tokens += r.input_tokens || 0;
          modelMap[m].output_tokens += r.output_tokens || 0;
        }
      }
      return modelMap;
    };
    return {
      period_days: 7,
      completions_by_model: summarize(completions),
      embeddings_by_model: summarize(embeddings),
      images_by_model: summarize(images),
      tts_by_model: summarize(tts),
      generated_at: new Date().toISOString()
    };
  }

  throw new Error(`Unknown OpenAI tool: ${tool}`);
}

export default { execute };
