# Current repair backlog

Generate with `npm run repair:generate`; check freshness and newly introduced
integrity defects with `npm run repair:check`. CI runs the latter before the
unchanged strict integrity gate. A green regression check does not mean integrity
passes or that any provider is certified.

`backlog.json` groups structural defects by module and root cause, with affected
names, stable evidence IDs, next actions and closure requirements. Its namespace files under `capabilities/` form a capability
matrix distinguishes unreachable/missing dispatch from structurally resolved code.
Contract and live verification remain conservatively unreviewed/not run: tests
elsewhere in the repository are not automatically attributed to thousands of tools.

`integrity-baseline.json` is the initial inherited debt snapshot. Its initializer
uses exclusive file creation and refuses to overwrite it. IDs ignore line shifts,
but include defect identity/evidence and multiplicity. Do not expand this baseline
to accept regressions. Resolved defects remain visible as resolved against it;
strict integrity must still pass before release. This ratchet covers known static
audit rules, not every security defect or provider API contract.

Duplicate candidates remain in the existing duplicate audit; candidate similarity
is not evidence sufficient for deleting or enabling a tool. Unscanned behavior,
credential isolation, policy, API correctness and live authorization require the
additional gates in docs/COMPLETION_PLAN.md.
