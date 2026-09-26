# Cloudflare zone-settings migration

The old bulk-read endpoint is deprecated. Both existing Toolkit names now use
GET /zones/{zone_id}/settings/{setting_id} for explicit selections.

Call cf_get_zone_settings with zone_id and setting_ids (1–50 strings), for example
setting_ids: ["ssl", "min_tls_version", "http2"]. Duplicate names are fetched once.
Requests run in batches of at most four. Any failed or malformed response fails
the tool call; it cannot report complete success after a failed setting read.
Results contain settings, requested, complete and scope. Complete means all
explicitly requested settings, never every possible setting.

cf_get_all_zone_settings remains executable with the same new input contract,
returns a deprecation warning, and is hidden from normal discovery. Calls omitting
setting_ids now fail with an input requirement instead of using the deprecated
endpoint or returning an incomplete fixed selection. No internal workflows called
these two names, as checked during migration.

The affected provider does not offer an equivalent documented enumeration through
the individual-setting endpoint. This is an intentional, documented input-contract
change, not transparent compatibility for old zone_id-only calls. Provider
permissions still apply. HTTP contract tests are mocked only in tests; live tests
were not run because credentials were unavailable.

Track this and related unfinished reviews in provider-changes.json.
