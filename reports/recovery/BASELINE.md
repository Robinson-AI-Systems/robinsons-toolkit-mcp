# Recovery baseline (generated measurements)

Source: `6c590f9c7895ea3bf2ce9e5d37bf300f5bd03cff`. Branch: `v3/recovery-core`. Local baseline tag: `v2-recovered`.

This records inherited failures, not production readiness. Main and all existing provider code were left unchanged at Checkpoint 0.

| Measurement | Observed |
| --- | ---: |
| Registry entries | 3049 |
| Unique registry names | 3049 |
| Handler dispatch occurrences | 3067 |
| Unique handler dispatch names | 3058 |
| Registry namespaces | 31 |
| Exact duplicate registry names | 0 |
| Registry names without matching handler branch text | 0 |
| Handler names missing registry metadata | 9 |
| Repeated dispatch names | 9 |
| MCP advertised tools | 14 |
| MCP serialized tools-array bytes (UTF-8) | 9044 |
| Direct capability schemas advertised (including local/compound) | 10 |
| Differently named duplicate/overlap candidates | 440 |
| Identical-body candidates | 10 |

Handler count is a static dispatch-name count, **not** a count of verified working capabilities. Gemini cannot parse; its dispatch names use an explicitly flagged textual fallback. Other handlers use an AST. The same dispatch name can occur in multiple shadowed branches.

## Runtime verification

- Zero-optional-secret stdio initialize: PASS, negotiated 2024-11-05.
- Local directory listing through MCP: PASS.
- Explicit Stripe request without key reports an error: PASS.
- Handler module imports: 30/31 passed; Gemini failed.
- Missing-key discovery isolation: FAIL. Search tools appear without credentials because registry namespace `search` has no matching gate. Compound workflows requiring providers also remain discoverable.
- Optional-package presence is not checked: Playwright and postgres imports are deferred inside handlers but these packages are not declared in package.json.
- Provider integration tests: **not run — credentials unavailable**.
- Legacy audit reports mismatches but exits 0. New `npm run audit:integrity` correctly exits 1 for inherited violations.
- Three analyzer regression tests pass (aliases, fabricated results, primitive/workflow non-merging).

## Confirmed implementation failures

- handlers/anthropic.js:82: fabricated-tool-result — confirmed-false-tool-result.
- handlers/gemini.js:685: syntax-error — confirmed-broken-module.

Anthropic supplies fabricated success-like tool-result content without executing requested tools. Browser route interception is legitimate functionality, not a placeholder. Gemini has multiple malformed multiline single-quoted strings; the report lists the first parse failure.

## Missing registry metadata

- `cf_get_api_token`
- `cf_list_ai_finetune_assets`
- `sentry_get_project_data_scrubbing`
- `sentry_list_org_rules`
- `slack_convert_channel_to_private`
- `slack_list_apps`
- `slack_set_user_active`
- `supabase_get_edge_function_body`
- `supabase_get_postgres_logs`

## Repeated handler dispatches

- `anthropic_get_usage`: handlers/anthropic.js:123, handlers/anthropic.js:582
- `anthropic_list_workspaces`: handlers/anthropic.js:380, handlers/anthropic.js:537
- `anthropic_get_workspace`: handlers/anthropic.js:381, handlers/anthropic.js:542
- `anthropic_list_workspace_members`: handlers/anthropic.js:385, handlers/anthropic.js:548
- `anthropic_list_api_keys`: handlers/anthropic.js:399, handlers/anthropic.js:561
- `openai_get_usage`: handlers/openai.js:237, handlers/openai.js:629
- `openai_list_projects`: handlers/openai.js:402, handlers/openai.js:617
- `openai_create_project`: handlers/openai.js:404, handlers/openai.js:623
- `openai_list_org_users`: handlers/openai.js:411, handlers/openai.js:599

Earlier commit e12a149 removed duplicate registry definitions, but left these repeated handler branches. Later branches may be unreachable. Do not choose an endpoint merely by which branch is newer; verify upstream documentation before repair.

## High-confidence duplicate candidates (not yet merged)

- local_make_directory ↔ local_create_directory: Identical implementation AST; Identical ordered call expressions; Input schemas differ; Description token Jaccard 0.412.
- local_find_files ↔ local_search_files: Identical implementation AST; Identical ordered call expressions; Input schemas differ; Description token Jaccard 0.400.
- local_update_env_var ↔ local_set_env: Identical implementation AST; Identical ordered call expressions; Input schemas differ; Description token Jaccard 0.400.
- neon_get_project_consumption ↔ neon_get_cost_breakdown: Identical implementation AST; Identical ordered call expressions; Identical input schema; Description token Jaccard 0.529.
- neon_get_connection_string ↔ neon_get_connection_uri: Identical implementation AST; Identical ordered call expressions; Input schemas differ; Description token Jaccard 0.500.
- neon_set_endpoint_pooling ↔ neon_update_connection_pooler_config: Identical implementation AST; Identical ordered call expressions; Identical input schema; Description token Jaccard 0.688.
- neon_reset_role_password ↔ neon_rotate_credentials: Identical implementation AST; Identical ordered call expressions; Identical input schema; Description token Jaccard 0.467.
- neon_setup_rad_database ↔ neon_create_project_for_rad: Identical implementation AST; Identical ordered call expressions; Input schemas differ; Description token Jaccard 0.600.
- qdrant_health_check ↔ qdrant_get_version: Identical implementation AST; Identical ordered call expressions; Identical input schema; Description token Jaccard 0.222.
- upstash_redis_save ↔ upstash_redis_bgsave: Identical implementation AST; Identical ordered call expressions; Identical input schema; Description token Jaccard 0.667.

Identical code does not automatically prove intended semantic equivalence (for example Redis SAVE/BGSAVE). Shared-branch aliases can still have different schemas. Full candidate evidence is in duplicate-candidates.json. No names were removed. This initial analyzer covers AST fingerprints, ordered call expressions and lexical description similarity; embeddings, full data-flow equivalence, output contracts and superset classification remain future work.

## Namespace inventory

| Namespace | Entries |
| --- | ---: |
| anthropic | 64 |
| clerk | 102 |
| cloudflare | 187 |
| compound | 46 |
| context7 | 45 |
| fly | 116 |
| gemini | 31 |
| github | 311 |
| google | 158 |
| linear | 64 |
| local | 87 |
| mapbox | 51 |
| moonshot | 17 |
| n8n | 79 |
| neon | 204 |
| ollama | 16 |
| openai | 133 |
| playwright | 47 |
| postgres | 111 |
| qdrant | 71 |
| resend | 52 |
| sam | 21 |
| search | 30 |
| sentry | 104 |
| slack | 69 |
| stripe | 202 |
| supabase | 127 |
| twilio | 115 |
| upstash | 197 |
| vercel | 181 |
| voyage | 11 |

## Architecture recovered from source and history

Implemented: lean discovery broker with extra pinned schemas; lexical search; registry JSON; provider handlers; limited inverse-map ledger; synchronous local/cloud workflows. Partially implemented: availability (namespace inconsistencies, unconditional pinning, no execution gate); result minimization (per-handler truncation/buffers); rollback (only inverse-map operations, compound child calls bypass central receipts).

Planned but absent: true lazy handler loading, shared CLI/core boundary, local semantic index, sandbox backend, isolated credentials, result store, profiles, project packs, shared workflow transaction IDs.

Security blockers: local/compound shell calls inherit process.env; local write containment uses string-prefix checks and does not resolve symlinks; stack traces and ledger args are not centrally redacted; local environment/file tools can expose secrets; compound handlers call providers directly. Registry equality is not a security or correctness certification.

README and CLAUDE report 2,537; EXPANSION_INDEX reports 3,103. Executable inventory reports 3049. Historical verification documents describe previous environments; they do not prove current startup, auth, rollback or provider API correctness. README and CLAUDE also contain literal escaped newlines. The design documents' Fat Server, Lean Client and anti-agent-OS boundaries remain the target. Their code snippets are explicitly illustrative and were not copied as implementations.

## Reproduction and checkpoint status

Run `npm ci --ignore-scripts`, `npm test`, `npm run audit:integrity` and `node scripts/baseline.mjs /tmp/rt-current-audit`. The committed report is the immutable recovery snapshot; use a different output directory for later audits. Run `node scripts/render-baseline.mjs` to regenerate this Markdown from the snapshot.

Baseline measurement is complete; **inherited integrity fails** and must remain visible. Checkpoint 1 can extract core behind compatibility tests without pretending these provider defects passed. GitHub branch creation returned 403 Resource not accessible by integration. The repository was cloned successfully, and work can be committed locally pending organization installation/write access.
