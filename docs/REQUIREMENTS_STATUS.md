# Original-request fulfilment review

Reviewed against the original owner prompt on 2026-09-27. This checklist records
implemented behavior and remaining acceptance work. It is not a production-ready
claim. Current counts come from reports/catalog; earlier checkpoint notes remain
historical. Main is preserved; development is on v3/recovery-core.
Execution order and closure criteria: [completion plan](COMPLETION_PLAN.md).

| Requirement | Verified state | Remaining acceptance work |
| --- | --- | --- |
| Recovery baseline | Branch, original HEAD, audit inventory and historical reports committed | Baseline preservation tag remains local |
| Shared Core | Registry, validation, catalog aliases, discovery, execution, availability, results, profiles and rollback shared by adapters | Extend all future integrations through these boundaries |
| Credential gating and lazy loading | No-secret startup, per-capability requirements, package/binary checks, conservative child dependencies, lazy handler imports | Dynamic dependency and authorization-scope review; provider timeouts |
| CLI | Search, schema, exec, namespaces, doctor, auth status, audit, result read/search, profiles, transactions and serve | Account/credential profile selection and agent installation helpers |
| Lean MCP | Seven brokers; measured legacy and modern stdio, shared bounded results | Actual Claude/Cursor/Codex/Gemini/Continue application certification |
| Modern MCP / HTTP | Optional pinned v2 adapter supports legacy and 2026 stdio; fetch-shaped HTTP with mandatory host authorization | OAuth/discovery deployment, reverse-proxy testing, reconnect/cancellation coverage |
| Output control | Redacted bounded inline results, stored large results, paged read/search, quota errors | Streaming provider payloads and provider-specific pre-broker truncation review |
| No false implementations | Production AST scanner; unreachable branches disabled; selected real provider repairs | Remaining unreachable branches/orphan definitions and broader provider contract review |
| Duplicate intelligence | Canonical aliases; method/endpoint/schema/return fingerprints; explicit workflow-composition classification | Review remaining candidates; dynamic helper/SQL/GraphQL equivalence; semantic similarity |
| Discovery | Indexed weighted BM25, tags/aliases, availability, concise match/risk explanations; 10,000-entry test | Cached semantic vectors, execution-history reranking and reviewed workflow-layer metadata |
| Credential protection | Configured/generated secret redaction; local subprocess allowlist; credential-scoped pg_dump and scaffold Prisma; structured compound Git | Provider modules still read process.env; host filesystem credential access; keychain/reference resolution; log review |
| Sandbox / file boundaries | Symlink-aware guarded local writes, profile roots, checked/staged backup outputs | OS isolation, archive/shell boundaries, race-resistant filesystem operations |
| Policy and risk | Profile allow/deny policy, canonical alias admission, workflow children routed through Core | Comprehensive reviewed risk/reversibility metadata and risk-based enforcement |
| Profiles | Private profile files, persistent CLI selection, concurrent workspace context and capability admission | Service/account defaults, secure credential references and production environment controls |
| Transactions | Shared IDs for workflow children, durable private ledger, reverse-order compensation, explicit irreversible/uncertain outcomes, replay protection | Full operation receipt coverage, inverse API review, before-images, reconciliation automation |
| Project packs | Core remains provider-agnostic; intended boundary documented | Extract business-specific compound workflows into optional packs |
| Generated docs | Canonical/alias/namespace/risk/availability manifest, duplicate report, MCP exposure, freshness CI | Continue replacing historical human-maintained claims with generated links |
| Verification | Offline suite, no-secret CLI/MCP, real SDK clients, actual local filesystem/subprocess security tests | Strict integrity still fails; live provider sandbox tests, cross-platform and deployed clients |

## Outstanding work that prevents full fulfilment

The current strict audit still reports unreachable legacy dispatch branches and
orphan handlers. Disabling them prevents false discovery but does not repair them.
Most capability risk classifications are explicitly UNREVIEWED. Raw host commands
retain host-user permissions; environment filtering is not an OS sandbox. Compound
subprocesses and filesystem writes need further isolation. Provider modules still
have ambient process.env access. Transaction coverage is partial, and legacy
inverse definitions are not comprehensive provider-certified compensation plans.

Semantic retrieval, secure credential references/account profiles, optional project
packs, deployed MCP OAuth and agent setup helpers also remain unfinished. These
are engineering gaps, not blocked on owner permission. Live provider certification
is separately blocked by unavailable authorized test credentials. No destructive
production operations have been used as integration tests.

Do not weaken the strict gate or relabel these gaps as complete. Preserve working
names and record upstream replacements, compatibility changes and test evidence
in docs/migrations/provider-changes.json as repairs are made.
