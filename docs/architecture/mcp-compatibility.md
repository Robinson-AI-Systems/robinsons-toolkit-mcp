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
