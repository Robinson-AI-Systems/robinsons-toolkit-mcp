# Robinson's Toolkit engineering rules

Build a universal, deterministic capability layer for coding agents. Preserve
Fat Server, Lean Client. Do not introduce conversational memory or autonomous
agent orchestration. Business-specific workflows belong in optional packs.

Work on `v3/recovery-core`, never directly on main. Do not overwrite baseline
tags. The recovery snapshot under reports/recovery is historical evidence:
generate current measurements into a different directory.

Core owns behavior; CLI/MCP adapters own presentation. Discovery and schema
lookup must not import handlers or probe external providers. Missing secrets,
optional packages, and unhealthy providers must affect only dependent tools.
AVAILABLE means local prerequisites are present; it is not proof of successful
provider authorization or API correctness.

No fabricated provider responses or tool results. Keep mocks exclusively in
tests. Verify official provider documentation before changing API behavior.
Retain working names; record intentional deprecations and compatibility paths.

After handler changes, regenerate capability metadata with
`node scripts/generate-capabilities.mjs`. This static dependency analysis is
conservative and requires human review for optional/dynamic workflow branches.

Before checkpoint commits: npm test; npm run audit:integrity; current inventory
and duplicate analysis; no-secret MCP boot; diff/secret review. Strict integrity
currently reports inherited orphan metadata and unreachable expansion code; do not
suppress them or describe the system as production-ready. Report newly resolved
and remaining failures separately. Live provider tests without real authorized
credentials must be marked not run, never simulated as successful live tests.

Do not expose provider credentials in subprocesses, logs, errors, receipts or
results. Environment redaction is defense-in-depth, not credential isolation.
Raw host command execution is not a security sandbox. Do not claim otherwise.

When encountering an upstream deprecation, implement and test a supported
replacement in the current repair when feasible. Record affected names, official
sources, compatibility changes and test evidence in docs/migrations/provider-changes.json.
If there is no equivalent or a concrete blocker, record that blocker and an
explicit next action; do not silently substitute different behavior. A documentation
note alone does not close a migration. Keep blocked broken capabilities unavailable.
