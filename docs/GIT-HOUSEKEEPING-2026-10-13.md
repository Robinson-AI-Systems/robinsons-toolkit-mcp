# Tracked universal Toolkit recovery — October 13, 2026

Owner requested full Git housekeeping. v3/recovery-core is substantial unique implementation and is intentionally preserved as an open draft PR, reconciled with current main's checked hosting/release and historical-archive infrastructure. It must not be treated as an abandoned branch or silently merged through a failed gate.

## Verified state

- Local npm ci succeeded; all **106 npm test cases passed** on recovery plus current-main infrastructure.
- npm run audit:integrity failed honestly: **484 unreachable-dispatch findings** and four handler implementations without registry contracts (`cf_list_ai_finetune_assets`, `sentry_list_org_rules`, `slack_list_apps`, `supabase_get_edge_function_body`). No duplicate registry names, repeated dispatch names or registered names without handlers were reported.
- The strict integrity workflow remains unchanged. These are inherited implementation defects, not grounds to suppress a test or certify production capability.
- No provider credential, provider mutation, production release, billing/spend activation or deployment was involved.

## Disposition of other old branches

`phase-3-reversible-state` is an older transaction prototype with placeholder inverses such as TBD and invented restore-from-main behavior. Current recovery uses the newer Core transaction/receipt implementation, tested for reverse-order compensation and uncertain-outcome refusal. Preserve the prototype's exact history in the non-production archive; do not replay its unsafe inverse map.

`copilot/vscode-mpdhw2pi-81uh` includes older presentation/error handling and a Gemini embedding-default proposal. The current recovery Core has replaced the older MCP adapter and sanitizes provider errors. The model-default proposal remains a provider migration question: verify current official supported embedding model/compatibility and test the handler before implementing it; do not merge its obsolete index or shrink the current Gemini catalog. The exact source history is retained in the archive and remains inspectable.

The two merged infrastructure branches are archived as settled PR history. Archives must never be merged into main. Recovery source remains v3/recovery-core with one deliberate draft and explicit blockers.

## Next executable work

Read AGENTS.md, docs/COMPLETION_PLAN.md, docs/ORPHAN_REVIEW.md and generated repair evidence. Resolve the structural/provider recovery requirements in approved, tested units without exposing unsupported operations. Re-run exact-head unit, metadata/catalog/repair checks and strict integrity; merge only once every required gate passes and unresolved reviews are handled. Real-provider and deployed acceptance remain separate. No credential values may appear in code, reports, logs or PRs.
