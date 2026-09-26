# Capability availability and lazy loading

Core loads registry and generated dependency metadata, never handler modules,
for discovery/schema/doctor. Execute rejects unknown and unavailable names
before importing anything. Namespaces import on demand via file URLs; imports
are cached, concurrent imports share a promise, and import failures are isolated.

Availability states include AVAILABLE, MISSING_CREDENTIALS,
MISSING_CONFIGURATION, AUTHORIZATION_REQUIRED, UNREACHABLE, DISABLED and
DEPRECATED. Environment credentials and configuration requirements are distinct.
Optional package resolution uses metadata only. Provider 401/403 failures block
the affected namespace/requirement group temporarily; unrelated groups continue.
Health cache lifetime is one Core instance (one CLI invocation or MCP process).
No startup connectivity probes occur. AVAILABLE explicitly reports authorization
and reachability as NOT_PROBED.

`node scripts/generate-capabilities.mjs` creates per-tool requirements from
reviewed namespace rules plus existing handler dispatch bodies. `--check` fails
when the generated file drifts. Credentials for Upstash management, Redis,
Vector, Kafka and QStash are separate. Search subproviders are separate. N8N
requires N8N_API_KEY because that is what the current handler actually consumes.
Admin APIs require their admin key rather than presuming an ordinary API key
has administrative privileges.

Static child dependencies are deliberately conservative: all literal child
calls must be configured, including optional paths. Dynamic workflow branches,
argument-provided credential overrides, local executable/browser installation
checks and complete upstream authorization semantics need further review.
No claim is made that each inherited endpoint works. Existing provider wrappers
still read process.env; per-handler credential isolation is not implemented by
this checkpoint. Central redaction removes configured secret values from normal
Core results/errors/receipts, but is not a substitute for the security phase.

Default MCP tools/list now exposes only search_toolkit, list_namespaces,
get_tool_schema and execute_tool. Former pinned capability names remain callable
through the same Core, but are not advertised. Search is schema-free and supports
include_unavailable. Full schemas include current availability. Lexical retrieval
remains in place pending the hybrid discovery phase.
