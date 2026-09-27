# Security recovery: local execution increment

All subprocess calls in `handlers/local.js` now use the shared restricted-host
wrapper. It builds an explicit environment allowlist for PATH, Windows executable
resolution, locale, timezone and terminal settings. Provider credentials, HOME,
shell startup variables, loader injection variables and arbitrary custom variables
are not inherited. Explicit subprocess environment overrides are filtered too.
Commands depending on inherited application secrets must no longer rely on them.

Existing local filesystem write checks now resolve symlinks and existing parent
directories, including when the final target does not exist. Path containment uses
path components rather than string prefixes. Dangling symlinks fail closed.
Moving a file checks both source and destination because both are mutations.
Configured ALLOWED_WRITE_PATHS remains supported; empty entries grant no access.

Verification uses real subprocesses with test-only sentinel credentials, actual
local file operations, sibling/traversal attempts and symlink/dangling-symlink
attempts. No provider credentials or live provider API calls are used.

## Remaining security work — not a sandbox guarantee

The restricted-host wrapper is environment hygiene, not OS isolation. Host
commands retain the server user's permissions and can read files, access the
network, and write outside the filesystem helper boundaries. PATH executables
and shell behavior remain trusted. Removing HOME does not prevent programs from
finding the operating-system user's home directory or reading credential files.
File checks have a check/use race if another process can replace ancestors.

The fixes apply to existing guarded local filesystem operations. Archive tools,
shell-backed tools and compound workflow filesystem writes still need dedicated
containment. Shell interpolation of structured arguments remains to be removed.
PostgreSQL backup, compound Git and scaffold schema-push subprocesses now have
scoped execution paths described below. Trusted host executables and project code
still have host-user filesystem privileges.

Provider modules still read process.env. Handler credential isolation, safe
credential-bearing operations, stronger execution backends, policy enforcement,
generated-secret redaction and project profiles remain incomplete.

This increment does not complete Checkpoint 6 or certify production readiness.

## PostgreSQL backup recovery

The two pg_dump capabilities now use a native executable with an argument vector,
not a shell string. The child inherits only the environment allowlist plus a
private temporary PGPASSFILE path and a connection timeout. The database password
is removed from the URI passed in argv and held in a mode-0600 password file that
is removed afterward. Backup output is staged with mode 0600 under checked write
roots and replaces the requested file only after pg_dump succeeds. Errors preserve
existing output and redact password echoes; stderr warnings are returned explicitly.
The availability system reports a missing pg_dump binary without loading handlers.
These tools no longer incorrectly require the unrelated Node postgres package.

For this hardened path, supply a postgres/postgresql URI with explicit host and
user. Alternate service/passfile references and host/user/database overrides in
query parameters are rejected rather than allowing unrelated host credentials.
Plain and custom dumps are supported. SQL execution keeps its existing connection
handling. Native executable installation, database authorization and actual backup
restore verification remain the operator's responsibility. Tests use test-only
executables to verify process arguments, environment, file boundaries and failure
handling; no live database backup has been certified.

Sources checked: PostgreSQL pg_dump and libpq password-file documentation:
https://www.postgresql.org/docs/current/app-pgdump.html
https://www.postgresql.org/docs/current/libpq-pgpass.html

## Compound Git subprocess recovery

Compound Git staging, commit and push now use argument arrays and an explicit
filtered environment. Literal pathspec strings remain single arguments; multiple
pathspecs must be supplied as an array. Shell expansion is deliberately removed.
Preflight checks the working directory, Git metadata, common directory and worktree
against configured write roots. Traversal, symlink escapes and linked metadata
outside those roots are rejected. Missing Git is a formal configuration requirement
for compound_git_commit_push. Failures return explicit success:false; an empty
commit no longer produces a fabricated success response.

Core redaction also removes credentials embedded in remote URLs and bearer headers
that were not previously registered with its environment resolver. Repository Git
configuration and hooks still execute as trusted host-user code, and existing host
credential helpers/files remain accessible. This is command/environment hygiene,
not OS isolation. The scaffold schema-push path is covered by the subsequent increment below.

Sources checked on 2026-09-27:
https://git-scm.com/docs/git-add
https://git-scm.com/docs/git-commit
https://git-scm.com/docs/git-push

## Scaffold schema synchronization

Automatic scaffold schema push invokes the project's already installed Prisma CLI
with fixed `db push` arguments. It does not launch a shell, download packages, or
forward control-plane provider credentials. The only added credential is the
selected branch's DATABASE_URL. Project Prisma configuration must consume that
variable; project code is trusted host code, not sandboxed. No destructive override
flags are supplied. This synchronizes schema, not versioned migration history.
Unsupported custom commands and absent Prisma fail before provider mutations.
Environment files are checked against write roots and atomically replaced with
mode 0600. Empty/multiline values and external symlink targets are rejected.
Subprocess failures retain an explicit uncertain-outcome flag and redact credentials.
Missing provider connection strings cannot produce a successful scaffold result.

The historical migration_command property remains, restricted to the three
recognized spellings in its schema. Run custom migrations separately with
explicitly selected credentials; arbitrary commands no longer inherit Toolkit's
credential environment. Tests use test-only CLI fixtures, not a live database.
Source checked on 2026-09-27: https://www.prisma.io/docs/cli/db/push
