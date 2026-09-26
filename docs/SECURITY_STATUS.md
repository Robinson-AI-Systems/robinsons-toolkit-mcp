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
Compound and PostgreSQL subprocesses still need scoped credential/execution
design; compound migrations explicitly require a database credential, so simply
stripping that credential would break the operation. Those paths have not been
certified secure and must not be run with untrusted inputs.

Provider modules still read process.env. Handler credential isolation, safe
credential-bearing operations, stronger execution backends, policy enforcement,
generated-secret redaction and project profiles remain incomplete.

This increment does not complete Checkpoint 6 or certify production readiness.
