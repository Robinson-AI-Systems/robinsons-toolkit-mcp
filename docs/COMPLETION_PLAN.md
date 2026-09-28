# Robinson's Toolkit completion plan

Owner: engineering agent responsible for v3 recovery.
Established: 2026-09-27, from recovery branch commit `66d8067`.
Status: execution plan; the original request is not yet fulfilled.

## Objective and boundaries

Finish the original universal developer-capability platform: one reusable Core,
thin CLI/MCP interfaces, lean discovery, real provider implementations, controlled
outputs, isolated credentials, enforceable policy and truthful transactions.
Preserve Fat Server, Lean Client and existing working names. Do not add agent
orchestration, conversational memory, or business-specific behavior to Core.

Current evidence, rather than a manually maintained completion percentage:
- [Requirement-by-requirement status](REQUIREMENTS_STATUS.md)
- [Generated catalog and counts](../reports/catalog/README.md)
- [Latest measured verification](../reports/verification/latest.json)
- [Historical recovery baseline](../reports/recovery/BASELINE.md)
- [Unresolved orphan review](ORPHAN_REVIEW.md)
- [API migration records](migrations/provider-changes.json)

The existing Core, CLI, broker MCP, lazy loading, availability, result store,
profiles, lexical discovery and rollback service are foundations to extend. Do not
restart them as independent implementations. Security and provider correctness are
the critical path; UI/setup polish comes after them.

## Execution sequence

Each stage is a series of small verified commits, not one rewrite. A stage closes
only when its exit evidence exists. A documented gap is still open work.

| Order | Work package | Exit gate |
| --- | --- | --- |
| 1 | Security boundary and execution policy | Scoped provider credentials and an honestly isolated command backend pass adversarial tests |
| 2 | Canonical capability contracts | Every active capability has reviewed implementation, requirements, risk and compatibility metadata |
| 3 | Provider repair and duplicate disposition | Strict integrity passes with no unresolved structural defects; preserved tools have supported contracts |
| 4 | Complete result/error containment | All public paths obey output limits and preserve explicit errors, warnings and retrievable data |
| 5 | Transaction coverage and recovery | Every mutation produces a truthful outcome record; supported compensation is tested |
| 6 | Hybrid discovery at scale | Cached semantic plus lexical retrieval improves evaluated intents without increasing initial schema exposure |
| 7 | Account profiles and project packs | Secure credential references select accounts; universal Core runs independently of project packs |
| 8 | Agent and HTTP compatibility | Supported client/transport matrix is tested; remote authorization and tenant isolation are verified |
| 9 | Release acceptance | Required gates pass, limitations are explicit, and a reviewable release is prepared |

Stages 2 and 3 iterate together: review a provider's contracts, repair the provider,
then regenerate evidence. Read-only provider repairs may proceed while stage 1 is
underway. Newly restored mutations must meet the applicable policy, credential and
receipt gates before activation. Result and transaction requirements apply to new
repairs immediately, rather than waiting for stages 4 and 5 to finish globally.

### 1. Security boundary and execution policy

1. Inventory credential reads, subprocess creation, filesystem writes and dynamic
   workflow dispatch. Distinguish trusted provider code from commands supplied by
   an agent. Record the actual threat model, including workspace files and SDK
   environment autodiscovery.
2. Build a scoped provider execution boundary. Start with a small process/worker
   harness and choose the production mechanism only after it preserves real
   handler behavior. A provider receives only its selected credential/configuration
   scope; it cannot inherit unrelated Toolkit credentials through the environment.
   Handle credential rotation and concurrent profiles without global environment
   mutation. A worker's environment isolation is not an OS filesystem sandbox.
3. Keep compound child calls inside Core admission, validation, transaction and
   output conventions across that boundary. Propagate workspace and transaction
   context explicitly; do not bypass policy through direct child imports.
4. Extend the sandbox interface with an actual isolated backend, starting with
   Docker where available. Use an unprivileged user, restricted mounts, dropped
   capabilities, resource limits and explicit network policy. Never mount host
   credential stores or the Docker socket into command workloads. Review workspace
   secret files before granting mounts; filtering environment variables alone is
   insufficient. Do not silently fall back to host execution when isolation was
   requested. Report unavailable backends through doctor/availability.
5. Retain restricted-host only as an explicitly described trusted-host mode.
   Harden path, archive and symlink handling; eliminate shell interpolation of
   structured arguments. Address check/use races with handle-based operations or
   a genuinely confined filesystem, not additional string-prefix checks.
6. Enforce reviewed risk policy in Core, including destructive, financial,
   communication and security-sensitive operations. Apply it to CLI, MCP and every
   compound child. No adapter-specific bypass or silent approval is acceptable.

Exit evidence: unrelated credentials absent in provider and command environments;
concurrent account scopes cannot cross; command workloads cannot read protected
host credentials; traversal/archive/symlink escapes fail; denied operations never
dispatch; provider failure cannot terminate unrelated requests. Unsupported OS or
backend coverage remains explicit, not described as tested.

### 2. Canonical capability contracts

1. Reconcile registry definitions and generated metadata into one authoritative
   contract and generated runtime index. Keep generation deterministic and startup
   free of provider imports/network probes.
2. Review each capability's canonical name, aliases, provider/implementation target,
   input/output contract, credential/configuration requirements, authorization
   scopes, side effects, idempotency, risk and reversibility. Name-based inference
   can propose metadata but cannot certify it. Unknown risk remains unreviewed.
3. Model conditional requirements: optional workflow steps, argument-supplied
   project references, service-specific credentials and optional native packages.
   Discovery prerequisites and execution-time authorization are distinct states.
4. Add provider deadlines and health isolation. Automatically retry only operations
   with reviewed retry semantics; a timeout after a mutation is an uncertain
   outcome, not permission to repeat it.
5. Maintain separate evidence labels for structural resolution, contract tests and
   live sandbox verification. AVAILABLE must not imply successful authorization or
   live certification. Do not advertise known-broken implementations.

Exit evidence: generated metadata is fresh; every active contract resolves; all
risk/requirement classifications are reviewed; invalid arguments fail before I/O;
zero/partial credential matrices and unhealthy-provider isolation pass.

### 3. Provider repair and duplicate disposition

1. Generate a machine-readable repair backlog from the current inventory, grouped
   by namespace and root cause: unreachable control flow, orphan definitions,
   unknown helpers, unsupported endpoints, wrong credentials, schema mismatch,
   fabricated success, swallowed failures and unsafe execution. Each item needs
   affected names, evidence, disposition, next action and closure tests.
2. Prioritize shared defects and high-impact namespaces. Begin with remaining
   orphans and the local/compound boundary; then GitHub, Neon/Postgres, Supabase,
   Vercel and Cloudflare; then financial/communications providers and the remaining
   namespaces. A newly discovered critical security defect takes precedence.
3. Review the official API contract before changing a wrapper. Never move an entire
   unreachable expansion block ahead of a throw and assume it is working. Repair
   and test coherent operation families; preserve unrelated working handlers.
4. Give every preserved capability a verified disposition: repaired, supported and
   retained, canonicalized through a working alias, or conclusively obsolete with
   a documented migration. If no equivalent exists, describe that precisely.
   Unresolved engineering defects keep full acceptance open. Do not archive code
   or rename audit findings merely to obtain a green build.
5. Review duplicate candidates using endpoint/method, schema, required parameters,
   credential/risk scope, output and implementation evidence. Separate true aliases
   from specializations and workflow composition. Record the decision and evidence
   for every candidate group; automate strong evidence, not semantic guesswork.
6. Add meaningful contract tests for repaired families and negative/error paths.
   Use live sandbox credentials when available; never run destructive production
   operations for connectivity testing. Missing credentials produce explicit
   not-run records, never fabricated successful integration results.

Exit evidence: zero registry/handler mismatches, duplicate canonical names,
shadowed/unreachable executable dispatches or production stubs; no known-broken
active tools; reviewed duplicate dispositions; source-linked migration map;
strict integrity green without weakening the existing rules.

### 4. Complete result/error containment

Audit CLI, both MCP adapters, workflows, provider errors and process stdout/stderr.
Remove silent pre-broker truncation; preserve full retrievable results or explicit
storage/size failures. Add streaming/bounded ingestion, expiration/cleanup and
quota handling. Define a lossless, secret-safe path for binary/multipart results
before exposing affected tools. Redact before logs, ledger summaries and public
storage; explain when security redaction changes the returned material.

Exit evidence: large Unicode, arrays, logs, stderr and binary fixtures never flood
model context; pagination terminates correctly; disk-full/quota/corruption errors
are explicit; no configured/generated secret appears in inspected public outputs;
failed result storage after a mutation preserves the uncertain/completed outcome.

### 5. Transaction coverage and recovery

Move compensation declarations into canonical contracts, with adapters to existing
inverse definitions during migration. Record intent and outcome for every mutation,
including operations without inverses and failed/uncertain dispatches. Give every
compound child its own receipt under a common transaction ID. Capture before-images
only where safe and necessary; secret compensation inputs require protected
references rather than public ledger plaintext.

Implement reverse-order compensation, policy checks, durable attempt records,
concurrency/replay protection and manual reconciliation for ambiguous outcomes.
Distinguish reverted, compensated, irreversible/unsupported and failed rollback.
Do not treat an available delete operation as a safe inverse of an update.

Exit evidence: crash/timeout/partial-workflow/replay tests pass; covered inverses
have provider-contract evidence; dry runs explain every operation; irreversible
or uncertain work never reports complete rollback success.

### 6. Hybrid discovery at scale

Keep current BM25 and availability filtering. Add versioned, cached embeddings
behind an optional adapter, with incremental invalidation on capability changes.
Choose an affordable local/default approach after measuring quality and installation
cost; hosted inference must be explicitly configured. With no embedding model,
retain working lexical search and report the retrieval mode honestly.

Combine lexical/semantic evidence, tags, reviewed workflow suitability and measured
execution outcomes. Policy and availability are hard constraints, not scores that
can be outweighed. Build an intent evaluation set covering ambiguous provider names,
near duplicates, specialized tools and primitive/workflow distinctions.

Exit evidence: evaluated retrieval improvement, bounded top results, no embedding
rebuild per CLI invocation, and measured cold/warm behavior at 10,000+ capabilities.
Initial MCP exposure remains the broker surface, independent of catalog size; retain
an explicit schema-byte budget and fail regressions that expose provider schemas.

### 7. Account profiles and project packs

Extend profiles with nonsecret provider/project defaults and credential references.
Support environment references plus practical OS credential storage behind the
resolver. Never store raw credentials in ordinary profile files. Exercise account
switching, revoked references, absent keychain support and production-environment
restrictions. Keep command credentials separate from control-plane credentials.

Extract product-specific workflows/defaults into optional packs with declared
requirements, versioning and collision checks. Preserve existing working entry
points through compatibility routing or a recorded migration. Pack absence must
not disable universal capabilities; no implicit business-specific defaults in Core.

Exit evidence: two account profiles cannot cross credentials/workspaces; missing
references degrade locally; universal startup/discovery/CLI work with no packs;
pack workflows still use Core policy, results and transactions.

### 8. Agent and HTTP compatibility

Keep the current small broker mode and tested stdio adapters. Recheck official MCP
and SDK contracts before further changes; retain needed compatibility rather than
forcing upgrades. Create reproducible setup helpers and a versioned compatibility
matrix for Claude, Cursor, Codex, Gemini and Continue. Distinguish real-application
checks from SDK-level protocol tests.

Finish remote authentication, scope enforcement, Origin/TLS requirements, identity
and credential isolation, session/resource limits and reconnect/cancellation tests.
Cancellation must not claim to undo dispatched mutations. SDK/HTTP adapters reuse
Core. Native deferred discovery, if supported, remains optional and must not enlarge
the universal broker surface. Do not expose an unauthenticated public listener.

Exit evidence: supported agent smoke scenarios complete search/schema/execute and
large-result retrieval; legacy/modern negotiation passes; unauthorized and cross-
identity HTTP calls fail; setup docs match actual tested versions and limitations.

### 9. Release acceptance

Run a clean-install, supported-runtime/OS matrix; document the actual platform
coverage. Generate manifests, counts, duplicate dispositions, verification labels,
MCP exposure and migration notes from authoritative data. Check installation,
upgrade and compatibility aliases from an existing v2-style configuration.

Required release evidence:
- All engineering gates above are closed, including strict integrity.
- No placeholders, false success paths or known-broken advertised capabilities.
- Zero-secret and partial-configuration startup work through CLI and MCP.
- Credential, filesystem, process, policy and public-output security tests pass.
- Transaction and output-containment failures remain truthful.
- Live provider results are attached where authorized; absent credentials remain
  explicit provider-certification blockers. Never claim every provider is live-
  certified based on offline tests or registry equality.
- Remaining limitations are concrete and cannot contradict the original quality
  bar. A scoped release candidate is not full completion of the original request.

Prepare a reviewable release PR, migration guide and release notes. Main remains
untouched until a merge is authorized. Public package/deployment actions require
their own existing authorization; finish the reviewable work before that decision.

## Immediate next three engineering commits

1. Generate the repair backlog and capability evidence matrix from existing audits.
   Add regression checks that detect new integrity/security defects while preserving
   the strict failing gate for inherited defects. Do not suppress its exit code.
2. Implement and test the scoped provider-execution harness with a real read handler
   and a compound child path; cover concurrent credential scopes, crashes, timeouts,
   lazy imports and secret-free error propagation before broad rollout.
3. Implement the isolated command backend and Core policy admission, then migrate
   high-risk local/compound operations with adversarial filesystem/process tests.

If harness investigation identifies an incompatibility, resolve it with evidence
and record the design decision. Do not substitute an environment-redaction wrapper
for actual credential/process isolation and call the task complete.

## Operating loop and continuity

At each session start, inspect branch/remote HEAD, working tree, this plan, current
requirements status, migration records and generated reports. Preserve user changes
and resume the first incomplete dependency. Do not repeat recovery or create a new
plan when the next engineering action is already known.

For each repair/checkpoint:
1. Identify the failure and supported intended behavior; confirm external contracts.
2. Add focused regression coverage and implement the smallest coherent repair.
3. Regenerate metadata/catalog and run the relevant suite, strict audit, duplicate
   analysis, no-secret boot and diff/secret review required by AGENTS.md.
4. Record pass/fail/not-run separately. During recovery, known inherited strict
   failures may remain, but no new unexplained failures may be introduced. Strict
   green remains a release gate; recovery commits are not production certification.
5. Commit with a conventional message. Publish without force-updating main; verify
   remote/local tree equality and preserve the original main HEAD.
6. Update the repair ledger and requirement evidence. Report what changed, tests,
   files, commit SHA, resolved blockers and remaining blockers succinctly.

Progress is measured by closed acceptance gates and evidence-backed capability
coverage, not commit count, test count alone, tool totals or subjective percentages.
After the first representative provider batches, use observed repair throughput and
root-cause distribution to estimate remaining effort. Do not promise a completion
date before that evidence exists.

Continue ordinary engineering autonomously. Owner input is needed only for a real
scope/business decision, unavailable external authorization/test credentials, or
an unauthorized merge/release/deployment. Never request secrets in chat or commit
them to unblock a test. Do all other useful work while external validation waits.
