# MCP compatibility decision — recovery extraction

Checked 2026-09-26. The installed lockfile resolves the monolithic
`@modelcontextprotocol/sdk` to 1.29.0. The npm registry reports the split
`@modelcontextprotocol/server` latest as 2.1.0. Do not infer protocol behavior
from the package major alone.

The official v2 migration guide explains that direct Server/McpServer instances
retain the legacy protocol by default. Modern stdio uses `serveStdio` with a
connection-pinned factory; HTTP uses `createMcpHandler`. Modern negotiation and
legacy compatibility must be tested deliberately.

For Checkpoint 1, retain the locked SDK and existing stdio wire format. Core has
no SDK dependency or transport import. No claim is made that Claude, Cursor,
Codex, Gemini, or Continue was exercised; the recorded runtime test is a raw
JSON-RPC client with a legacy initialize handshake. This is sufficient for
extraction parity, not a client certification matrix.

Before changing transports: test legacy and modern negotiation, tools listing
and execution, reconnects, cancellation, auth failures, and bounded results.
Do not start an unauthenticated remote listener as part of this extraction.
Keep the universal small broker mode even when optional deferred discovery is
introduced. Remote HTTP and modern protocol support remain pending.

Sources:
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- npm registry: `npm view @modelcontextprotocol/server version dist-tags --json`

## Optional v2 adapter — implemented increment

`rt serve --modern` (or `node index.js --modern`) uses the pinned optional
`@modelcontextprotocol/server@2.1.0` dependency and requires Node.js 20+.
`serveStdio(factory)` accepts both the legacy initialize exchange and the modern
2026-07-28 opening. The default remains the v1 adapter for existing installations.
Core and the seven broker definitions are shared; no provider schemas are exposed.
The v2 client is a development-only protocol test dependency.

`createAuthenticatedHttpAdapter({core, authorize})` in
`src/adapters/mcp/modern.js` provides a fetch-shaped Streamable HTTP adapter.
It opens no listener. The embedding host must verify bearer tokens, scopes,
Origin, TLS and any required MCP OAuth discovery; the adapter rejects every
request unless the supplied callback returns exactly true. Callback errors
return a generic 503. One adapter grants access to one configured Core/profile;
do not share it between principals that require different credentials/workspaces.
This is an authenticated hosting seam, not a complete OAuth deployment product.

Offline tests exercise v2-client legacy and pinned-modern stdio connections,
seven-tool listing, real local execution, missing credentials, large result
containment and reading. In-process Streamable HTTP tests exercise modern
negotiation/listing/calls plus rejected and failed authorization. No network
listener or live provider account is used. Actual Claude/Cursor/Codex/Gemini/
Continue applications, HTTP reverse proxies and reconnect/cancellation of
in-flight provider mutations remain uncertified. Cancellation is not a promise
that an already dispatched provider operation was undone.

Official SDK upgrade and protocol migration documents were rechecked before
this increment. Optional package installation failure does not break legacy MCP
or CLI startup; requesting modern mode without that dependency is an explicit
configuration error, not a silent downgrade.
