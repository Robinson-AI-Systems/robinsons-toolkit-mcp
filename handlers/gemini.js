/**
 * Gemini Handler — 27 tools
 * Native Google Gemini API client built on fetch (no SDK dependency).
 * Covers: text generation, multi-turn chat, function calling, structured JSON
 * output, code execution, grounded search, multimodal file analysis, image
 * generation, image editing, spatial reasoning, text-to-speech, embeddings,
 * context caching, file management, token counting, batching, long-running
 * deep-research operations, and model discovery.
 */

import { readFileSync, writeFileSync } from 'fs';

const BASE = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-2.5-flash';

function apiKey() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY not set in .env');
  return k;
}

function explain(status, data) {
  const raw = data?.error?.message || (typeof data === 'string' ? data : JSON.stringify(data || {}).slice(0, 400));
  if (status === 401 || status === 403) {
    return `Gemini ${status}: ${raw} — verify GEMINI_API_KEY is valid, the Generative Language API is enabled, and (for cachedContents/batches) billing is activated on your Google Cloud project.`;
  }
  if (status === 429) {
    return `Gemini 429: ${raw} — rate or quota limit hit. Back off and retry, or check your project's quota in AI Studio.`;
  }
  if (status === 404) {
    return `Gemini 404: ${raw} — model name or resource path not found (use gemini_list_models to enumerate available models).`;
  }
  if (status >= 500) {
    return `Gemini ${status}: upstream server error — ${raw}. Safe to retry with backoff.`;
  }
  return `Gemini ${status}: ${raw}`;
}

async function gem(method, path, body, opts = {}) {
  const url = `${BASE}${path}`;
  const headers = { 'x-goog-api-key': apiKey(), ...(opts.headers || {}) };
  if (body != null && !opts.raw) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : (opts.raw ? body : JSON.stringify(body))
    });
  } catch (e) {
    throw new Error(`Gemini network error (${method} ${path}): ${e.message}`);
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(explain(res.status, data));
  return data;
}

// Two-phase resumable upload to the Files API
async function uploadFile(buffer, mimeType, displayName = 'upload') {
  const startRes = await fetch(`${BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey(),
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buffer.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: displayName } })
  });
  if (!startRes.ok) {
    const t = await startRes.text();
    throw new Error(explain(startRes.status, t));
  }
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini Files API did not return an upload URL');
  const finishRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(buffer.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: buffer
  });
  const finalText = await finishRes.text();
  let final;
  try { final = JSON.parse(finalText); } catch { final = finalText; }
  if (!finishRes.ok) throw new Error(explain(finishRes.status, final));
  return final.file || final;
}

function bufferFromArgs(args) {
  if (args.file_base64) return Buffer.from(args.file_base64, 'base64');
  if (args.file_path) return readFileSync(args.file_path);
  throw new Error('Provide either file_base64 (base64 string) or file_path (local path)');
}

async function execute(tool, args) {

  // ── 1. STANDARD QUERY ─────────────────────────────────────────────────────
  if (tool === 'gemini_standard_query') {
    const { prompt, model = DEFAULT_MODEL, system_instruction, temperature, max_tokens } = args;
    if (!prompt) throw new Error('prompt is required');
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
    if (system_instruction) body.systemInstruction = { parts: [{ text: system_instruction }] };
    const gc = {};
    if (temperature !== undefined) gc.temperature = temperature;
    if (max_tokens !== undefined) gc.maxOutputTokens = max_tokens;
    if (Object.keys(gc).length) body.generationConfig = gc;
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    return {
      text: data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n'),
      finish_reason: data.candidates?.[0]?.finishReason,
      usage: data.usageMetadata,
      model
    };
  }

  // ── 2. STRUCTURED EXTRACTOR (JSON-schema constrained) ─────────────────────
  if (tool === 'gemini_structured_extractor') {
    const { prompt, json_schema, model = DEFAULT_MODEL, system_instruction } = args;
    if (!prompt || !json_schema) throw new Error('prompt and json_schema are required');
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: json_schema
      }
    };
    if (system_instruction) body.systemInstruction = { parts: [{ text: system_instruction }] };
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* leave raw for caller */ }
    return { json: parsed, raw, usage: data.usageMetadata, model };
  }

  // ── 3. CODE EXECUTION ENGINE ──────────────────────────────────────────────
  if (tool === 'gemini_code_execution_engine') {
    const { prompt, model = DEFAULT_MODEL } = args;
    if (!prompt) throw new Error('prompt is required');
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ codeExecution: {} }]
    };
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    const parts = data.candidates?.[0]?.content?.parts || [];
    return {
      text: parts.map(p => p.text).filter(Boolean).join('\n'),
      executable_code: parts.filter(p => p.executableCode).map(p => p.executableCode),
      execution_result: parts.filter(p => p.codeExecutionResult).map(p => p.codeExecutionResult),
      usage: data.usageMetadata,
      model
    };
  }

  // ── 4. GROUNDED QUERY (Google Search retrieval) ───────────────────────────
  if (tool === 'gemini_grounded_query') {
    const { prompt, model = DEFAULT_MODEL } = args;
    if (!prompt) throw new Error('prompt is required');
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }]
    };
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    const cand = data.candidates?.[0];
    return {
      text: cand?.content?.parts?.map(p => p.text).filter(Boolean).join('\n'),
      grounding_metadata: cand?.groundingMetadata,
      citations: (cand?.groundingMetadata?.groundingChunks || []).map(c => c.web).filter(Boolean),
      usage: data.usageMetadata,
      model
    };
  }

  // ── 5. ANALYZE MEDIA (multimodal via Files API) ───────────────────────────
  if (tool === 'gemini_analyze_media') {
    const { prompt, mime_type, model = DEFAULT_MODEL, display_name } = args;
    if (!prompt || !mime_type) throw new Error('prompt and mime_type are required');
    const buf = bufferFromArgs(args);
    const file = await uploadFile(buf, mime_type, display_name || 'media');
    const body = {
      contents: [{ role: 'user', parts: [
        { fileData: { fileUri: file.uri, mimeType: mime_type } },
        { text: prompt }
      ]}]
    };
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    return {
      text: data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n'),
      file_uri: file.uri,
      file_name: file.name,
      usage: data.usageMetadata,
      model
    };
  }

  // ── 6. GENERATE IMAGE (Imagen / Gemini image models) ──────────────────────
  if (tool === 'gemini_generate_image') {
    const { prompt, output_path, model = 'imagen-3.0-generate-002', number_of_images = 1, aspect_ratio = '1:1' } = args;
    if (!prompt || !output_path) throw new Error('prompt and output_path are required');
    const body = {
      instances: [{ prompt }],
      parameters: { sampleCount: number_of_images, aspectRatio: aspect_ratio }
    };
    const data = await gem('POST', `/v1beta/models/${model}:predict`, body);
    const preds = data.predictions || [];
    const saved = [];
    preds.forEach((p, i) => {
      const b64 = p.bytesBase64Encoded || p.image?.bytesBase64Encoded;
      if (!b64) return;
      const path = preds.length === 1 ? output_path : output_path.replace(/(\.[^.]+)?$/, `_${i + 1}$1`);
      writeFileSync(path, Buffer.from(b64, 'base64'));
      saved.push(path);
    });
    return { saved, count: saved.length, model };
  }

  // ── 7. SPATIAL ANALYSIS (bounding boxes 0-1000 normalized) ────────────────
  if (tool === 'gemini_spatial_analysis') {
    const { prompt, mime_type = 'image/png', model = 'gemini-2.5-pro', target_objects } = args;
    const buf = bufferFromArgs(args);
    const ask = prompt || `Detect ${target_objects || 'all prominent objects'} and return a JSON array of {label, box_2d:[ymin,xmin,ymax,xmax]} where box_2d coordinates are normalized to the 0-1000 range.`;
    const body = {
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType: mime_type, data: buf.toString('base64') } },
        { text: ask }
      ]}],
      generationConfig: { responseMimeType: 'application/json' }
    };
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    let detections = null;
    try { detections = JSON.parse(raw); } catch { /* leave raw for caller */ }
    return { detections, raw, usage: data.usageMetadata, model };
  }

  // ── 8. TEXT TO SPEECH (native Gemini TTS) ─────────────────────────────────
  if (tool === 'gemini_text_to_speech') {
    const { text, output_path, voice = 'Kore', model = 'gemini-2.5-flash-preview-tts' } = args;
    if (!text || !output_path) throw new Error('text and output_path are required');
    const body = {
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
      }
    };
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!part) throw new Error('No audio data returned by TTS endpoint');
    writeFileSync(output_path, Buffer.from(part.inlineData.data, 'base64'));
    return { saved: output_path, mime_type: part.inlineData.mimeType, voice, model };
  }

  // ── 9. EMBEDDINGS ─────────────────────────────────────────────────────────
  if (tool === 'gemini_generate_embeddings') {
    const { text, model = 'text-embedding-004', task_type } = args;
    if (text === undefined || text === null) throw new Error('text is required (string or array of strings)');
    if (Array.isArray(text)) {
      const requests = text.map(t => ({
        model: `models/${model}`,
        content: { parts: [{ text: t }] },
        ...(task_type ? { taskType: task_type } : {})
      }));
      const data = await gem('POST', `/v1beta/models/${model}:batchEmbedContents`, { requests });
      return { embeddings: (data.embeddings || []).map(e => e.values), count: data.embeddings?.length || 0, model };
    }
    const body = { content: { parts: [{ text }] } };
    if (task_type) body.taskType = task_type;
    const data = await gem('POST', `/v1beta/models/${model}:embedContent`, body);
    return { embedding: data.embedding?.values, dimensions: data.embedding?.values?.length, model };
  }

  // ── 10. CACHE DOCUMENT (Context Caching) ──────────────────────────────────
  if (tool === 'gemini_cache_document') {
    const { contents, model = 'gemini-2.5-flash', system_instruction, ttl_seconds = 3600, display_name } = args;
    if (!contents) throw new Error('contents is required');
    const body = {
      model: `models/${model}`,
      contents,
      ttl: `${ttl_seconds}s`
    };
    if (system_instruction) body.systemInstruction = { parts: [{ text: system_instruction }] };
    if (display_name) body.displayName = display_name;
    try {
      const data = await gem('POST', '/v1beta/cachedContents', body);
      return { cache_name: data.name, model: data.model, expire_time: data.expireTime, usage: data.usageMetadata };
    } catch (e) {
      if (/\b403\b/.test(e.message)) {
        return {
          ok: false,
          error: 'cached_contents_requires_billing',
          detail: e.message,
          hint: 'The cachedContents endpoint requires a paid-tier Google Cloud project. Enable billing and retry.'
        };
      }
      throw e;
    }
  }

  // ── 11. BATCH PROCESSOR (client-side fan-out with concurrency) ────────────
  if (tool === 'gemini_batch_processor') {
    const { prompts, model = DEFAULT_MODEL, concurrency = 4, system_instruction } = args;
    if (!Array.isArray(prompts) || !prompts.length) throw new Error('prompts must be a non-empty array');
    const results = new Array(prompts.length);
    let next = 0;
    async function worker() {
      while (true) {
        const i = next++;
        if (i >= prompts.length) return;
        const body = { contents: [{ role: 'user', parts: [{ text: prompts[i] }] }] };
        if (system_instruction) body.systemInstruction = { parts: [{ text: system_instruction }] };
        try {
          const d = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
          results[i] = {
            ok: true,
            text: d.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n'),
            usage: d.usageMetadata
          };
        } catch (e) {
          results[i] = { ok: false, error: e.message };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, prompts.length) }, worker));
    return {
      results,
      total: results.length,
      succeeded: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length
    };
  }

  // ── 12. DEEP RESEARCH START (long-running batchGenerateContent) ───────────
  if (tool === 'gemini_deep_research_start') {
    const { requests, model = DEFAULT_MODEL, display_name } = args;
    if (!Array.isArray(requests) || !requests.length) throw new Error('requests array is required');
    const body = {
      batch: {
        displayName: display_name || `batch_${Date.now()}`,
        inputConfig: {
          requests: {
            requests: requests.map((r, i) => ({
              metadata: { key: String(i) },
              request: r.request || {
                contents: r.contents || [{ role: 'user', parts: [{ text: r.prompt }] }]
              }
            }))
          }
        }
      }
    };
    const data = await gem('POST', `/v1beta/models/${model}:batchGenerateContent`, body);
    return { operation_name: data.name, metadata: data.metadata, done: data.done || false };
  }

  // ── 13. DEEP RESEARCH STATUS (poll long-running operation) ────────────────
  if (tool === 'gemini_deep_research_status') {
    const { operation_name } = args;
    if (!operation_name) throw new Error('operation_name is required');
    const stem = operation_name.replace(/^\/?v1beta\//, '');
    const data = await gem('GET', `/v1beta/${stem}`);
    return {
      operation_name: data.name,
      done: !!data.done,
      metadata: data.metadata,
      response: data.response,
      error: data.error
    };
  }

  // ── 14. CANCEL BATCH JOB (cancel-or-delete long-running operation) ────────
  if (tool === 'gemini_cancel_batch_job') {
    const { operation_name } = args;
    if (!operation_name) throw new Error('operation_name is required');
    const stem = operation_name.replace(/^\/?v1beta\//, '');
    try {
      const data = await gem('POST', `/v1beta/${stem}:cancel`, {});
      return { cancelled: true, operation_name, response: data };
    } catch (cancelErr) {
      try {
        const data = await gem('DELETE', `/v1beta/${stem}`);
        return { deleted: true, operation_name, response: data };
      } catch (deleteErr) {
        return {
          ok: false,
          error: `Cancel failed: ${cancelErr.message}. Delete also failed: ${deleteErr.message}`
        };
      }
    }
  }

  // ── 15. LIST MODELS (enumerate available models + context limits) ─────────
  if (tool === 'gemini_list_models') {
    const { page_size = 50, page_token } = args;
    const qs = new URLSearchParams({ pageSize: String(page_size) });
    if (page_token) qs.set('pageToken', page_token);
    const data = await gem('GET', `/v1beta/models?${qs.toString()}`);
    return {
      models: (data.models || []).map(m => ({
        name: m.name,
        display_name: m.displayName,
        version: m.version,
        input_token_limit: m.inputTokenLimit,
        output_token_limit: m.outputTokenLimit,
        supported_methods: m.supportedGenerationMethods
      })),
      count: data.models?.length || 0,
      next_page_token: data.nextPageToken
    };
  }

  // ── 16. MULTI-TURN CHAT ────────────────────────────────────────────────────
  // Send a conversation history and get the next assistant turn
  if (tool === 'gemini_chat') {
    const { messages, model = DEFAULT_MODEL, system_instruction, temperature, max_tokens } = args;
    if (!Array.isArray(messages) || !messages.length) throw new Error('messages array is required (each: {role: "user"|"model", text: string})');
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : (m.role || 'user'),
      parts: [{ text: m.text || m.content || '' }]
    }));
    const body = { contents };
    if (system_instruction) body.systemInstruction = { parts: [{ text: system_instruction }] };
    const gc = {};
    if (temperature !== undefined) gc.temperature = temperature;
    if (max_tokens !== undefined) gc.maxOutputTokens = max_tokens;
    if (Object.keys(gc).length) body.generationConfig = gc;
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    const reply = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n');
    return {
      reply,
      finish_reason: data.candidates?.[0]?.finishReason,
      usage: data.usageMetadata,
      model,
      // Return updated history so caller can append and continue the conversation
      updated_messages: [...messages, { role: 'model', text: reply }]
    };
  }

  // ── 17. FUNCTION CALLING ───────────────────────────────────────────────────
  // Call Gemini with tool definitions; returns either a text reply or tool call request
  if (tool === 'gemini_function_call') {
    const { prompt, tools: toolDefs, model = DEFAULT_MODEL, system_instruction, tool_choice } = args;
    if (!prompt || !toolDefs?.length) throw new Error('prompt and tools array are required');
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ functionDeclarations: toolDefs }]
    };
    if (system_instruction) body.systemInstruction = { parts: [{ text: system_instruction }] };
    if (tool_choice) body.toolConfig = { functionCallingConfig: { mode: tool_choice } };
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    const cand = data.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const textParts = parts.filter(p => p.text).map(p => p.text);
    const fnCalls = parts.filter(p => p.functionCall).map(p => ({
      name: p.functionCall.name,
      args: p.functionCall.args
    }));
    return {
      text: textParts.join('\n') || null,
      function_calls: fnCalls,
      has_tool_call: fnCalls.length > 0,
      finish_reason: cand?.finishReason,
      usage: data.usageMetadata,
      model
    };
  }

  // ── 18. COUNT TOKENS ───────────────────────────────────────────────────────
  // Count tokens before sending to avoid exceeding context limits
  if (tool === 'gemini_count_tokens') {
    const { text, model = DEFAULT_MODEL, contents } = args;
    if (!text && !contents) throw new Error('text or contents is required');
    const body = {
      contents: contents || [{ role: 'user', parts: [{ text }] }]
    };
    const data = await gem('POST', `/v1beta/models/${model}:countTokens`, body);
    return {
      total_tokens: data.totalTokens,
      model,
      context_limit: null, // caller can compare against gemini_list_models
      within_limit: data.totalTokens < 1000000 // 1M token default assumption
    };
  }

  // ── 19. ANALYZE IMAGE FROM URL ─────────────────────────────────────────────
  // Analyze an image at a public URL without uploading to Files API
  if (tool === 'gemini_analyze_image_url') {
    const { prompt, image_url, mime_type = 'image/jpeg', model = DEFAULT_MODEL } = args;
    if (!prompt || !image_url) throw new Error('prompt and image_url are required');
    const body = {
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType: mime_type, data: await fetch(image_url).then(r => r.arrayBuffer()).then(b => Buffer.from(b).toString('base64')) } },
        { text: prompt }
      ]}]
    };
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    return {
      text: data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n'),
      finish_reason: data.candidates?.[0]?.finishReason,
      usage: data.usageMetadata,
      model
    };
  }

  // ── 20. EDIT IMAGE (Imagen inpainting/editing) ─────────────────────────────
  // Edit an existing image using a text prompt (Imagen 3 edit mode)
  if (tool === 'gemini_edit_image') {
    const { prompt, output_path, mask_base64, model = 'imagen-3.0-capability-001' } = args;
    if (!prompt || !output_path) throw new Error('prompt and output_path are required');
    const imageBase64 = args.file_base64 || (args.file_path ? readFileSync(args.file_path).toString('base64') : null);
    if (!imageBase64) throw new Error('file_base64 or file_path is required for the source image');
    const instance = { prompt, image: { bytesBase64Encoded: imageBase64 } };
    if (mask_base64) instance.mask = { image: { bytesBase64Encoded: mask_base64 } };
    const data = await gem('POST', `/v1beta/models/${model}:predict`, {
      instances: [instance],
      parameters: { sampleCount: 1 }
    });
    const pred = data.predictions?.[0];
    const b64 = pred?.bytesBase64Encoded || pred?.image?.bytesBase64Encoded;
    if (!b64) throw new Error('No edited image returned');
    writeFileSync(output_path, Buffer.from(b64, 'base64'));
    return { saved: output_path, model };
  }

  // ── 21. LIST FILES (Files API) ─────────────────────────────────────────────
  // List files previously uploaded to the Gemini Files API
  if (tool === 'gemini_list_files') {
    const { page_size = 20, page_token } = args;
    const qs = new URLSearchParams({ pageSize: String(page_size) });
    if (page_token) qs.set('pageToken', page_token);
    const data = await gem('GET', `/v1beta/files?${qs.toString()}`);
    return {
      files: (data.files || []).map(f => ({
        name: f.name,
        display_name: f.displayName,
        mime_type: f.mimeType,
        size_bytes: f.sizeBytes,
        state: f.state,
        uri: f.uri,
        create_time: f.createTime,
        expiration_time: f.expirationTime
      })),
      count: data.files?.length || 0,
      next_page_token: data.nextPageToken
    };
  }

  // ── 22. GET FILE (Files API) ───────────────────────────────────────────────
  if (tool === 'gemini_get_file') {
    const { file_name } = args;
    if (!file_name) throw new Error('file_name is required (e.g. "files/abc123")');
    const name = file_name.startsWith('files/') ? file_name : `files/${file_name}`;
    const data = await gem('GET', `/v1beta/${name}`);
    return {
      name: data.name,
      display_name: data.displayName,
      mime_type: data.mimeType,
      size_bytes: data.sizeBytes,
      state: data.state,
      uri: data.uri,
      create_time: data.createTime,
      expiration_time: data.expirationTime
    };
  }

  // ── 23. DELETE FILE (Files API) ───────────────────────────────────────────
  if (tool === 'gemini_delete_file') {
    const { file_name } = args;
    if (!file_name) throw new Error('file_name is required (e.g. "files/abc123")');
    const name = file_name.startsWith('files/') ? file_name : `files/${file_name}`;
    await gem('DELETE', `/v1beta/${name}`);
    return { deleted: true, file_name };
  }

  // ── 24. LIST CACHED CONTENTS ───────────────────────────────────────────────
  if (tool === 'gemini_list_cached_contents') {
    const { page_size = 20, page_token } = args;
    const qs = new URLSearchParams({ pageSize: String(page_size) });
    if (page_token) qs.set('pageToken', page_token);
    const data = await gem('GET', `/v1beta/cachedContents?${qs.toString()}`);
    return {
      cached_contents: (data.cachedContents || []).map(c => ({
        name: c.name,
        display_name: c.displayName,
        model: c.model,
        create_time: c.createTime,
        expire_time: c.expireTime,
        usage: c.usageMetadata
      })),
      count: data.cachedContents?.length || 0,
      next_page_token: data.nextPageToken
    };
  }

  // ── 25. DELETE CACHED CONTENT ─────────────────────────────────────────────
  if (tool === 'gemini_delete_cached_content') {
    const { cache_name } = args;
    if (!cache_name) throw new Error('cache_name is required (e.g. "cachedContents/abc123")');
    const name = cache_name.startsWith('cachedContents/') ? cache_name : `cachedContents/${cache_name}`;
    await gem('DELETE', `/v1beta/${name}`);
    return { deleted: true, cache_name };
  }

  // ── 26. QUERY WITH CACHE ───────────────────────────────────────────────────
  // Use a cached context (from gemini_cache_document) as prefix for a new query
  if (tool === 'gemini_query_with_cache') {
    const { prompt, cache_name, model = DEFAULT_MODEL, temperature, max_tokens } = args;
    if (!prompt || !cache_name) throw new Error('prompt and cache_name are required');
    const cachedContentName = cache_name.startsWith('cachedContents/') ? cache_name : `cachedContents/${cache_name}`;
    const body = {
      cachedContent: cachedContentName,
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    };
    const gc = {};
    if (temperature !== undefined) gc.temperature = temperature;
    if (max_tokens !== undefined) gc.maxOutputTokens = max_tokens;
    if (Object.keys(gc).length) body.generationConfig = gc;
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    return {
      text: data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n'),
      finish_reason: data.candidates?.[0]?.finishReason,
      usage: data.usageMetadata,
      cache_name,
      model
    };
  }

  // ── 27. THINKING QUERY (extended reasoning / gemini-2.5-pro) ──────────────
  // Use Gemini's thinking capability for complex multi-step reasoning tasks
  if (tool === 'gemini_thinking_query') {
    const { prompt, model = 'gemini-2.5-pro', system_instruction, thinking_budget, max_tokens = 16000 } = args;
    if (!prompt) throw new Error('prompt is required');
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: max_tokens,
        ...(thinking_budget !== undefined ? { thinkingConfig: { thinkingBudget: thinking_budget } } : {})
      }
    };
    if (system_instruction) body.systemInstruction = { parts: [{ text: system_instruction }] };
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    const parts = data.candidates?.[0]?.content?.parts || [];
    const thoughtParts = parts.filter(p => p.thought);
    const textParts = parts.filter(p => p.text && !p.thought);
    return {
      text: textParts.map(p => p.text).filter(Boolean).join('\n'),
      thinking: thoughtParts.map(p => p.text).filter(Boolean).join('\n') || null,
      finish_reason: data.candidates?.[0]?.finishReason,
      usage: data.usageMetadata,
      model
    };
  }


  // ── 28. VIDEO TRANSCRIPTION (via Files API) ───────────────────────────────
  // Transcribe or analyze a video file using Gemini's multimodal capabilities
  if (tool === 'gemini_transcribe_video') {
    const { prompt, mime_type = 'video/mp4', model = DEFAULT_MODEL, display_name } = args;
    if (!mime_type) throw new Error('mime_type is required (e.g. video/mp4, video/webm)');
    const buf = bufferFromArgs(args);
    const file = await uploadFile(buf, mime_type, display_name || 'video');
    // Poll until file is ACTIVE (video processing can take time)
    let fileState = file;
    let attempts = 0;
    while (fileState.state === 'PROCESSING' && attempts < 20) {
      await new Promise(r => setTimeout(r, 3000));
      fileState = await gem('GET', `/v1beta/${file.name}`);
      attempts++;
    }
    if (fileState.state !== 'ACTIVE') throw new Error(`File processing timed out or failed: ${fileState.state}`);
    const body = {
      contents: [{ role: 'user', parts: [
        { fileData: { fileUri: fileState.uri, mimeType: mime_type } },
        { text: prompt || 'Transcribe this video. Format as a transcript with timestamps.' }
      ]}]
    };
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    return {
      transcript: data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n'),
      file_uri: fileState.uri,
      file_name: file.name,
      usage: data.usageMetadata,
      model
    };
  }

  // ── 29. MULTI-SPEAKER TTS ─────────────────────────────────────────────────
  // Generate speech with multiple speakers/voices in one audio output
  if (tool === 'gemini_multi_speaker_tts') {
    const { turns, output_path, model = 'gemini-2.5-flash-preview-tts' } = args;
    if (!turns?.length || !output_path) throw new Error('turns array and output_path are required');
    // turns: [{speaker: 'Speaker1', text: '...'}, ...]
    const text = turns.map(t => `${t.speaker}: ${t.text}`).join('\n');
    const body = {
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [...new Set(turns.map(t => t.speaker))].map((speaker, i) => ({
              speaker,
              voiceConfig: { prebuiltVoiceConfig: { voiceName: turns.find(t => t.speaker === speaker)?.voice || ['Kore','Charon','Fenrir','Aoede'][i % 4] } }
            }))
          }
        }
      }
    };
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!part) throw new Error('No audio data returned');
    const { writeFileSync } = await import('fs');
    writeFileSync(output_path, Buffer.from(part.inlineData.data, 'base64'));
    return { saved: output_path, mime_type: part.inlineData.mimeType, speakers: [...new Set(turns.map(t => t.speaker))], model };
  }

  // ── 30. DOCUMENT OCR ──────────────────────────────────────────────────────
  // Extract text from a scanned document or PDF using Gemini vision
  if (tool === 'gemini_document_ocr') {
    const { mime_type = 'image/png', model = DEFAULT_MODEL, output_format = 'text', display_name } = args;
    const buf = bufferFromArgs(args);
    const isLarge = buf.length > 20 * 1024 * 1024; // 20MB threshold — use Files API
    let contentPart;
    let fileName = null;
    if (isLarge) {
      const file = await uploadFile(buf, mime_type, display_name || 'document');
      contentPart = { fileData: { fileUri: file.uri, mimeType: mime_type } };
      fileName = file.name;
    } else {
      contentPart = { inlineData: { mimeType: mime_type, data: buf.toString('base64') } };
    }
    const formatInstruction = output_format === 'markdown'
      ? 'Extract all text from this document and format it as clean Markdown, preserving headings and structure.'
      : output_format === 'json'
      ? 'Extract all text from this document and return a JSON object with fields: title, sections (array of {heading, content}), and raw_text.'
      : 'Extract all text from this document exactly as it appears, preserving line breaks and layout.';
    const body = {
      contents: [{ role: 'user', parts: [contentPart, { text: formatInstruction }] }],
      ...(output_format === 'json' ? { generationConfig: { responseMimeType: 'application/json' } } : {})
    };
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n');
    let parsed = null;
    if (output_format === 'json') { try { parsed = JSON.parse(raw); } catch {} }
    return { text: raw, parsed, output_format, file_name: fileName, usage: data.usageMetadata, model };
  }

  // ── 31. COMPARE DOCUMENTS ─────────────────────────────────────────────────
  // Upload two documents and ask Gemini to compare, diff, or analyze differences
  if (tool === 'gemini_compare_documents') {
    const { file_a_path, file_a_base64, file_b_path, file_b_base64, mime_type_a = 'application/pdf', mime_type_b = 'application/pdf', prompt, model = 'gemini-2.5-flash' } = args;
    const bufA = file_a_base64 ? Buffer.from(file_a_base64, 'base64') : (file_a_path ? (await import('fs')).readFileSync(file_a_path) : null);
    const bufB = file_b_base64 ? Buffer.from(file_b_base64, 'base64') : (file_b_path ? (await import('fs')).readFileSync(file_b_path) : null);
    if (!bufA || !bufB) throw new Error('Both documents are required (file_a_path/file_a_base64 and file_b_path/file_b_base64)');
    const [fileA, fileB] = await Promise.all([
      uploadFile(bufA, mime_type_a, 'document_a'),
      uploadFile(bufB, mime_type_b, 'document_b')
    ]);
    const body = {
      contents: [{ role: 'user', parts: [
        { fileData: { fileUri: fileA.uri, mimeType: mime_type_a } },
        { fileData: { fileUri: fileB.uri, mimeType: mime_type_b } },
        { text: prompt || 'Compare these two documents. Identify key differences, similarities, and any important changes between them.' }
      ]}]
    };
    const data = await gem('POST', `/v1beta/models/${model}:generateContent`, body);
    return {
      comparison: data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n'),
      file_a: fileA.name,
      file_b: fileB.name,
      usage: data.usageMetadata,
      model
    };
  }


    throw new Error(`Unknown gemini tool: ${tool}`);
}

export default { execute };
