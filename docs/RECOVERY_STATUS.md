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

## Checkpoints 3 and 4 — CLI and bounded results

The CLI commands in CLI.md execute over the shared Core. Large results are
stored, bounded reads/searches work across processes, and MCP advertises six
broker tools including result retrieval. Twenty-one tests pass, including CLI
exit codes, actual no-secret MCP execution, a 5,000-record Unicode round trip,
secret redaction, result traversal/symlink rejection and quota failures.

Remaining strict integrity issues are nine orphan handler definitions and nine
repeated dispatch names. Full sandboxing/credential isolation, profiles,
transaction semantics, deeper duplicate canonicalization, hybrid discovery and
modern MCP transport migration remain incomplete. Do not interpret these
checkpoints as full production readiness.

## Security increment — local execution

Local subprocesses now receive an allowlisted environment. Existing guarded local
file writes reject sibling-prefix escapes, symlink escapes and dangling symlinks;
file moves validate the source too. Twenty-four tests pass, including three new
security regressions using real subprocesses and filesystem operations.
Inventory remains 3,049 registry names, 31 namespaces, 440 duplicate candidates;
MCP remains six broker tools / 2,442 schema bytes with zero direct provider schemas.
Strict integrity still fails on the same nine orphan names and nine repeated
dispatch names. See SECURITY_STATUS.md for the substantial remaining security work.

## Integrity increment — shadowed dispatch cleanup

Removed nine unreachable Anthropic/OpenAI branches while preserving all reachable
per-tool AST fingerprints and registry names. Twenty-four tests pass. Strict
integrity now reports only the nine orphan names; it remains a failing gate.
Provider endpoint correctness still requires separate review, including legacy
usage routes. See PROVIDER_REPAIRS.md and the generated integrity repair report.

## Integrity increment — verified orphan recovery

Recovered cf_get_api_token into the registry, removed the obsolete unregistered
Slack users.setActive call, and fixed Cloudflare HTTP failure handling. All 3,049
original registry names remain; the catalog now has 3,050 names. Seven orphan
handlers remain under review. No live provider tests were run without credentials.

## Reachability correction — counts are not working capability counts

Execution testing exposed premature unconditional throws before expansion code.
The strengthened AST audit reports 495 unreachable dispatch branches across 18
namespaces, including 490 registered names. These 490 entries are preserved but
now DISABLED in generated capability metadata and excluded from normal discovery.
Dependent workflows may also become unavailable. This corrects prior structural
reports, which counted branch presence without proving reachability.

cf_get_api_token was moved before the premature Cloudflare throw and verified with
contract tests. Other expansion branches remain disabled until individually
reviewed and repaired. Strict integrity intentionally fails on unreachable
branches plus the seven remaining orphan names. Do not interpret 3,050 registry
entries as 3,050 working capabilities. The historical recovery report is unchanged.

Regenerate the current reachability report with:
`node scripts/report-reachability.mjs > reports/integrity/reachability.json`.
This scan detects direct unconditional return/throw, not all control-flow defects.

## Restored Cloudflare read capabilities

Three reviewed read capabilities are reachable again with credentials configured:
email-routing settings, user-token listing and current-token verification. Token
listing preserves pagination metadata. Thirty-two tests pass. Registered names
remain 3,050; directly unreachable registered names fall from 490 to 487. Strict
integrity still fails on remaining unreachable branches and seven orphan names.

## Restored local system readings

local_get_memory_usage and local_get_cpu_usage now use Node OS counters through
Core instead of unreachable Linux shell pipelines. Memory returns byte counters;
CPU returns measured aggregate busy/idle percentages over a bounded sampling
interval. Output identifies host/container scope limitations. Existing names are
preserved; their previously unreachable string outputs are replaced by structured
measurements. References: https://nodejs.org/api/os.html#oscpus and #osfreemem.
Real host and zero-credential CLI tests cover these readings. Directly unreachable
registered names fall to 485. Windows/macOS execution has not been tested here.

## Implemented zone-settings replacement

Supersedes the earlier deferred bulk-settings note: cf_get_zone_settings and the
compatibility name cf_get_all_zone_settings now read explicitly requested settings
through supported individual endpoints. setting_ids is required; the legacy name
warns and is excluded from discovery. See migrations/cloudflare-zone-settings.md
for the intentional input/output contract change. The migration tracker records
completed changes and concrete outstanding blockers. Thirty-eight tests pass;
directly unreachable registered names fall to 484. Full integrity still fails.

## Shared validation, canonical aliases and generated catalog

Complete registered JSON Schema validation now enforces nested constraints without
coercing caller arguments. Formal catalog resolution validates aliases and routes
legacy names to their canonical implementation. Forty-two tests pass, including
real local alias operations and all-schema compilation. Current reports under
reports/catalog distinguish canonical entries, aliases, namespaces, risk review,
zero-credential availability and MCP exposure. CI checks generated freshness.
See REQUIREMENTS_STATUS.md for the original-request acceptance review and ALIASES.md
for compatibility response details. Full integrity remains failing.
