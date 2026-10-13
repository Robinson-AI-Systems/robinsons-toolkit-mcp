# Canonical names and compatibility aliases

The shared catalog checks duplicate names, missing alias targets, cross-namespace
aliases and alias chains/cycles at construction. Normal search returns canonical
entries. Schema lookup accepts either name and reports aliasOf or aliases.
Execution validates the requested schema, resolves the canonical name, enforces
its availability and validates its schema before dispatch. Provider health and
ledger routing use the canonical name.

Deprecated aliases add a warning and canonicalName to object results. Array and
primitive results use a value field so their warning survives JSON serialization.
Large alias results still pass through the result broker.

Reviewed aliases: local_create_directory → local_make_directory;
local_search_files → local_find_files; local_set_env → local_update_env_var;
cf_get_all_zone_settings → cf_get_zone_settings. The local aliases share their
existing implementation branches and preserve alternate contains/env_file inputs.
Cloudflare's input-contract migration is documented separately.

Other duplicate candidates are not merged automatically. Similar descriptions
and matching endpoints alone do not prove identical behavior.

The current duplicate analyzer extracts explicit HTTP methods and normalized route
patterns, required parameters, canonical schema structure, schema property subsets,
return-expression fingerprints, tags, namespaces and implementation fingerprints.
Reports distinguish shared endpoints from partial endpoint overlap and explicit
workflow-to-primitive composition. Dynamic helper calls and SQL/GraphQL effects
remain unknown rather than guessed. All candidates retain autoMerge:false.
Description token overlap is lexical evidence; semanticSimilarity is null with an
explicit explanation until a real embedding model is configured. Exact source
similarity or endpoint overlap is insufficient to certify functional equivalence.
