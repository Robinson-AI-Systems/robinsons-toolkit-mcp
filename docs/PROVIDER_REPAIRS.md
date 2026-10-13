# Confirmed provider repairs

The Gemini module contained four malformed single-quoted newline literals.
These are now escaped correctly; all provider modules parse and import.
No Gemini endpoint, model selection, or request format changed.

`anthropic_message_with_tools` now makes one real Messages request and returns
pending tool calls, response content, usage, and a continuation messages array.
The calling agent executes client tools and supplies actual results through
`anthropic_message`. The historical `max_turns` parameter is retained but emits
a deprecation warning: automatic turns with fabricated results were invalid.
No autonomous agent loop was added.

Validation: module imports plus an intercepted HTTP contract test (test code
only) verifying exactly one request and no invented tool results. Live provider
tests were not run — credentials unavailable. Remaining orphan metadata and
shadowed dispatch branches still fail strict integrity checks.

Official contracts checked:
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
- https://ai.google.dev/api/generate-content

## Shadowed dispatch cleanup

Nine later Anthropic/OpenAI dispatch branches repeated earlier exact tool names.
Each earlier branch ends in an unconditional return, making the later branch
unreachable. Removed only these dead branches; all first-reachable implementation
AST fingerprints and all unique names were compared before/after and preserved.
The machine-readable proof is reports/integrity/shadowed-dispatch-repair.json.
Registry count remains 3,049. This is not a provider API correctness certification.

Official references reviewed on 2026-09-26:
- https://platform.claude.com/docs/en/manage-claude/admin-api
- https://platform.claude.com/docs/en/manage-claude/usage-cost-api
- https://developers.openai.com/api/reference/typescript/resources/admin/subresources/organization/subresources/projects

Follow-up: the retained legacy get_usage branches use older /usage routes, unlike
current documented organization usage-report routes. Repair their parameter and
credential contracts separately; removing dead code does not repair those calls.
Live provider tests: not run — credentials unavailable.

## Orphan resolution: Cloudflare token details and retired Slack presence

- `cf_get_api_token`: registered the existing GET /user/tokens/{token_id}
  implementation after checking the official Cloudflare Token Details reference.
  Requires CLOUDFLARE_API_TOKEN and the upstream API Tokens Read or Write permission.
  Token IDs are validated before dispatch. Cloudflare's shared HTTP wrapper now
  rejects non-2xx responses even when the response omits an errors array, and also
  rejects an explicit success:false. Tests cover missing credentials, request
  contracts, malformed IDs and HTTP 403. These are mocked contract tests, not live
  provider verification.
- `slack_set_user_active`: removed an unregistered orphan calling users.setActive.
  Slack explicitly documents this method as deprecated, nonfunctional and doing
  no operation. No registered capability was removed. There is no equivalent
  replacement for forcing a user active; users.setPresence has different semantics
  and is not silently substituted.

References checked 2026-09-26:
- https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/get/
- https://docs.slack.dev/reference/methods/users.setActive/

Remaining orphan review findings:
- slack_list_apps calls apps.connections.open (a Socket Mode connection, not an
  app list); do not register this misleading implementation as a list capability.
- slack_convert_channel_to_private calls conversations.convert; official admin
  conversion uses admin.conversations.convertToPrivate and requires a separate
  authorization review before exposure.
- Other remaining orphans: cf_list_ai_finetune_assets,
  sentry_get_project_data_scrubbing, sentry_list_org_rules,
  supabase_get_edge_function_body, supabase_get_postgres_logs.

The Cloudflare token-details execution test initially failed because expansion
branches were located after an unconditional unknown-tool throw. The verified
branch was moved before that throw; other expansion branches were not activated.
The same pattern occurs across 18 namespaces. See the generated reachability
report and RECOVERY_STATUS.md. Registry presence is not evidence of reachability.

## Restored Cloudflare reads

Moved only reviewed cf_get_email_routing, cf_list_api_tokens and
cf_verify_api_token branches before the premature unknown-tool throw. Their
existing names remain. Email routing validates the zone identifier before HTTP.
Token listing now accepts documented page/per_page/direction/include_expired
parameters and returns the provider envelope, including result_info, rather than
silently stripping pagination. This changes only previously unreachable behavior.
The shared helper's envelope option is opt-in; existing callers keep their output.

Contract tests exercise all three through Core, including lazy loading, missing
credentials, input rejection, empty pages, response preservation and authorization
failure isolation. HTTP is mocked inside tests only. Live provider tests: not run
— credentials unavailable. Official references checked 2026-09-26:
- https://developers.cloudflare.com/api/resources/email_routing/methods/get/
- https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/list/
- https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/verify/

cf_get_all_zone_settings remains disabled. Its bulk endpoint is deprecated in
https://developers.cloudflare.com/api/resources/zones/subresources/settings/methods/list/;
a replacement must preserve the requested meaning without pretending to enumerate
all settings using an incomplete hardcoded list.
