# Scoped provider process execution

The shared Core accepts an opt-in `providerExecution` configuration. It is an
incremental migration mechanism for reviewed stateless operations, not a claim
that all providers have been isolated. Unselected capabilities retain their
existing lazy loader. There is no new advertised capability or CLI default switch.

```js
const core = await createToolkit({
  credentials: accountCredentialResolver,
  providerExecution: {
    scopes: { local_list_directory: [] },
    timeoutMs: 30000,
    maxMessageBytes: 8 * 1024 * 1024,
    maxLogBytes: 65536
  }
});
```

Scope keys must be existing canonical capability names. Values are explicitly
reviewed environment variable names resolved from that Core's credential resolver;
no raw secrets belong in this configuration. Empty scope passes no provider
credentials. Only a small operating-system environment allowlist is inherited.
Parent Node flags, NODE_OPTIONS, HOME and dynamic-loader injection variables are
not passed. Configuration rejects unsafe environment names. Each invocation gets
a fresh process, so credential rotation does not reuse a module's captured token.

The worker imports only its selected handler. Discovery/schema requests create no
worker or handler import. Compound child requests return through the originating
Core dispatcher: availability, argument validation, profile policy, depth limits,
transaction IDs and result conventions still apply. Child credentials belong to
the child's selected scope; do not grant a workflow every child's credentials.
Before rollout, review a workflow's direct environment reads and optional defaults.

Deadlines, crashes and oversized results report explicit errors and possible
completion where appropriate. A deadline does not undo remote mutations or cancel
already dispatched Core child operations. These may finish and record receipts
after the parent reports uncertainty; do not automatically retry. A worker cannot
report success with unresolved child operations. Request/response transport limits
fail explicitly rather than truncating data. Streaming results are still future work.

Raw provider stdout/stderr never reaches the MCP stream, public logs or storage.
Unexpected diagnostics cause a specific error describing discarded bytes; overflow
terminates the worker. This deliberately fails closed for noisy integrations until
their diagnostic behavior is reviewed. Normal handler return values still flow
through Core redaction and the result store. Provider HTTP status remains available
to Core's namespace health tracking.

This separates process environments and crash lifetimes. It does **not** isolate
host filesystem access, network access, OS identity, or arbitrary subprocess trees.
Trusted provider code can still read files permitted to the host account. Do not
use this as an untrusted-code sandbox. A separate confined command backend remains
a release requirement. Stateful browser/database sessions need a reviewed lifecycle
before using one-process-per-invocation execution; do not enable them blindly.

Verification covers actual local filesystem reads and the actual compound health
handler; remote child/provider responses in tests are fixtures, not live service
certification. Concurrent account scopes, rotation, policy denial, preserved HTTP
health status, process exit, deadlines and output failures have regression tests.

Implementation contract reviewed against the official Node child-process API:
https://nodejs.org/api/child_process.html#child_processforkmodulepath-args-options
(`env`, `execArgv`, IPC and lifecycle events). Runtime/OS coverage is limited to the
versions actually exercised by the test matrix.
