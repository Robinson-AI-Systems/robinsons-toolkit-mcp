# Recovery status

## Checkpoint 0

Committed snapshot: [generated baseline](../reports/recovery/BASELINE.md).
Original main: `6c590f9c7895ea3bf2ce9e5d37bf300f5bd03cff`.
Local preservation tag: `v2-recovered` (never overwrite).

The baseline measured inherited failures; it did not certify the toolkit as
production-ready. Strict CI remains red until those failures are repaired.

## Checkpoint 1 — shared core extraction

Registry loading, handler loading, discovery, legacy availability checks,
argument validation, execution and ledger routing now live in `src/core`.
`index.js` handles MCP presentation and delegates execution to Core. MCP
surface definitions moved intact to `src/adapters/mcp/surface.js`.

No registry entries, provider implementations, schemas or advertised schema
bytes changed. Eight automated tests pass, including no-secret stdio startup,
actual local execution, validation before dispatch, special namespace routing,
and receipt behavior. Current inventory and duplicate analysis match baseline.

This is deliberately an extraction checkpoint. Eager handler loading and the
legacy availability bugs are not yet fixed. Missing secret configuration must
not be confused with a validated provider connection. The inherited Gemini
syntax failure, fabricated Anthropic tool results, orphan handler names,
repeated dispatches and security defects remain tracked by strict integrity CI.

Next: repair/quarantine inherited invalid implementations; make capability
availability explicit and handler loading lazy; then implement CLI/result
storage over the same core. Review [MCP compatibility](architecture/mcp-compatibility.md)
before adapting protocol/transport behavior.

## Checkpoint 2 — availability and lazy loading

Provider import and fabricated-result defects repaired in a separate commit.
Formal per-capability requirements, isolated lazy imports, provider health states,
zero-secret discovery gating and a four-tool MCP broker surface are implemented.
See CAPABILITY_AVAILABILITY.md for deliberately conservative dependency limits.
Fourteen tests pass. The strict orphan/repeated-dispatch gate remains red.

## Repository publishing

Organization GitHub App authorization was corrected. Checkpoints 0 and 1 were
published as 60403b5 and 3a65c08. GitHub Git Data API commits may have different
commit SHAs from local commits; compare tree SHAs to verify identical contents.
Main remains unchanged.
