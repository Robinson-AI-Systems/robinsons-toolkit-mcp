# Robinson's Toolkit

A shared developer-capability Core with CLI and MCP adapters. The coding agent
owns reasoning; Toolkit supplies deterministic operations, discovery, validation,
availability checks, bounded results and transaction receipts.

**Recovery is in progress on `v3/recovery-core`; this branch is not production
certified.** The strict integrity gate intentionally remains failing while
inherited unreachable implementations and orphan metadata are repaired.

Tool counts, aliases, namespaces, availability, risk and duplicate candidates
come from the [generated catalog](reports/catalog/README.md). The
[verification report](reports/verification/latest.json) records measured tests
and remaining integrity failures. See the [requirements review](docs/REQUIREMENTS_STATUS.md)
for the original request's implemented and unfinished parts. Historical v2
claims remain in Git history; registry counts alone do not prove correctness.

## Try the recovery branch

Use Node.js 22 or newer to satisfy the current adapter/dependency requirements. Core and
legacy MCP retain the package's Node.js 18 minimum; optional modern MCP requires
20+, and Neon SQL requires 19+ plus its optional driver.

```sh
git clone --branch v3/recovery-core https://github.com/Robinson-AI-Systems/robinsons-toolkit-mcp.git
cd robinsons-toolkit-mcp
npm ci --ignore-scripts
node bin/rt.js doctor --json
node bin/rt.js search "list directory" --json
node bin/rt.js exec local_list_directory --json '{}'
```

No optional provider credentials are needed to boot or use local/no-auth tools.
Configure only the integrations you need through environment variables or the
compatible `.env` loader. Do not commit secrets. `doctor` and `auth status` report
requirements without printing values; AVAILABLE means local prerequisites are
present, not that provider authorization has been verified.

Run `npm link` to install the local `rt` and `robinsons-toolkit` command aliases.
The CLI emits JSON and deterministic exit codes. See [CLI commands](docs/CLI.md),
[workspace profiles](docs/PROFILES.md), [results](docs/RESULTS.md), and
[transactions](docs/TRANSACTIONS.md).

## Lean MCP

```sh
node bin/rt.js mcp inspect --json
node bin/rt.js serve
# Optional modern SDK adapter:
node bin/rt.js serve --modern
```

Point a stdio MCP client at the absolute path to `bin/rt.js` with `serve` as its
argument. Keep the provider catalog behind search, schema and execution brokers;
provider schemas are not advertised directly. Schema lookup and discovery do not
import integration handlers. Execution imports the selected namespace lazily.
Large results become stored references with bounded read/search operations.

The optional HTTP adapter is an embedding API, not an automatically exposed
network service. Its host must supply authorization and transport security.
Protocol tests use real SDK clients; individual coding-agent applications and
deployed OAuth are not yet certified. See [MCP compatibility](docs/architecture/mcp-compatibility.md).

## Security and compatibility

Local process environments are filtered, selected native operations use argument
arrays, and guarded writes check workspace boundaries. These controls are **not
OS isolation**: trusted host programs, project code and Git hooks retain the
host user's filesystem privileges. Provider module credential scoping and stronger
sandbox backends remain unfinished. See [security status](docs/SECURITY_STATUS.md).

Scaffold schema synchronization uses the project's installed Prisma CLI with a
scoped DATABASE_URL; arbitrary migration shell commands are rejected. Neon SQL
uses its optional official driver. PostgreSQL backups require native `pg_dump`.
Missing optional dependencies disable affected capabilities without preventing
startup. [Migration records](docs/migrations/provider-changes.json) describe
upstream replacements, compatibility changes and test evidence.

## Verify changes

```sh
npm test
npm run audit:metadata
npm run catalog:check
npm run audit:integrity
npm run verify:recovery
```

The last two commands currently fail because of recorded inherited integrity
issues. Do not weaken their gates or replace live provider tests with simulated
success. Offline HTTP fixtures belong only in tests; live provider certification
requires authorized sandbox credentials. Keep generated reports fresh with
`node scripts/generate-capabilities.mjs` and `npm run catalog:generate` after
relevant changes. [Engineering rules](AGENTS.md) and the
[checkpoint history](docs/RECOVERY_STATUS.md) describe the incremental recovery.
