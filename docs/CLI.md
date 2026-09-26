# CLI

After `npm ci`, run `node bin/rt.js --help`, or `npm link` to install the local
`rt` and `robinsons-toolkit` command aliases. The CLI and MCP share Core.

Commands currently implemented:

```
rt search "list directory" --json
rt search "stripe customers" --include-unavailable --json
rt schema stripe_list_customers --json
rt exec local_list_directory --json '{}'
rt namespaces --json
rt doctor --json
rt auth status --json
rt audit --json
rt audit duplicates --json
rt mcp inspect --json
rt serve
```

All non-server commands emit one JSON value to stdout. `--json` is accepted for
output commands; on `exec` it supplies the input arguments object. Execution
loads only the selected handler. Doctor/auth status show prerequisite presence,
not secret values or a claim of verified authorization.

Exit codes: 0 success; 2 invalid command/input/unknown tool; 3 unavailable
capability; 4 execution failure; 5 structural audit failure. Duplicate candidates
are review items, not proof of identity, and never trigger automatic deletion.

Profiles, transactions, and result commands are added only when implemented;
unsupported commands fail explicitly and are not advertised as functional.
`serve` currently provides stdio using the locked SDK. It opens no HTTP listener.

Stored result retrieval is now implemented: `rt result read <id>` and
`rt result search <id> <query>`, with --cursor and --limit. See RESULTS.md.

Workspace profile management is implemented: `rt profile create <name> --json
<profile-object>`, `rt profile list`, and `rt profile use <name>`. See PROFILES.md
for policy patterns, restart behavior and limitations. Transaction commands remain
pending until their execution and rollback semantics are safe.
