# Orphan implementation review

Reviewed 2026-09-27 against current official documentation. These names originated
as handler branches without registry entries; this is not a list of currently
available tools. The generated catalog remains authoritative for exposure.

| Name | Evidence and disposition | Next action |
| --- | --- | --- |
| supabase_get_postgres_logs | Repaired and registered with unified logs endpoint, management-token gating and tests | Live sandbox validation when authorized credentials exist |
| supabase_get_edge_function_body | Documented GET body route exists; legacy branch is unreachable, duplicates `/v1`, and its helper assumes JSON | Verify binary/multipart response contract, then restore a bounded lossless result path |
| slack_convert_channel_to_private | Legacy `conversations.convert` is wrong; documented `admin.conversations.convertToPrivate` requires an Enterprise org user token with admin.conversations:write | Recover behind independent admin-token gating and record security-sensitive mutation metadata |
| slack_list_apps | Legacy branch calls apps.connections.open, which creates a Socket Mode URL, not an app inventory | Replace only if a supported inventory API with the same scope is verified; otherwise retire this unregistered false implementation and record the gap |
| cf_list_ai_finetune_assets | Legacy branch is unreachable and references an undefined accountId helper; public assets API currently documents upload, not listing | Check provider support for listing; do not expose an upload operation as a read replacement |
| sentry_get_project_data_scrubbing | Returns the entire project using the same endpoint as sentry_get_project | Preserve as a documented compatibility alias after contract review |
| sentry_list_org_rules | Legacy endpoint and retention-rule comment do not establish a supported contract | Reconcile intended scope with current alert/workflow APIs before exposing or migrating |

Sources:
- https://supabase.com/docs/reference/api/v1-get-project-logs
- https://supabase.com/docs/reference/api/v1-get-a-function-body
- https://docs.slack.dev/reference/methods/admin.conversations.convertToPrivate/
- https://docs.slack.dev/reference/methods/apps.connections.open/
- https://developers.cloudflare.com/api/resources/ai/subresources/finetunes/subresources/assets/
- https://docs.sentry.io/api/projects/retrieve-a-project/

Do not add registry entries merely to make mismatch counts equal. Recovery must
include the real implementation, appropriate credentials, failure behavior and
regression tests. Unresolved branches remain unadvertised.
