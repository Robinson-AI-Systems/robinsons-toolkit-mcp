# Workspace profiles and capability admission

`rt profile create development --json '{"workspace":"/absolute/project","allowedCapabilities":["local_read_file","local_list_directory"]}'`

`rt profile list --json` lists profiles. `rt profile use development` selects the
profile for subsequent CLI invocations and newly started MCP servers. A running
server keeps its current selection until restarted. Profile files contain a name,
workspace and optional allowedCapabilities/deniedCapabilities; secrets and unknown
fields are rejected. Patterns are exact names, prefix patterns such as local_*,
or *. Deny takes precedence. An empty allow list denies every capability.

Selection is atomically persisted in the Toolkit state directory. Files use
private permissions; file symlinks and traversal names are rejected. A missing or
invalid selected profile fails closed. No profile configured preserves existing
behavior. Programmatic Core callers can pass an explicit profile or profile:null.

Aliases are checked using their canonical name. Discovery and execution apply
profile policy; statically known workflow children are checked conservatively.
Workspace context is asynchronous-call-local, including local handler defaults,
compound defaults, ledger paths and default result-store partitions. Guarded local
writes in a profile cannot use global ALLOWED_WRITE_PATHS to cross the profile root.

This is capability admission and workspace selection, not an OS sandbox. Arbitrary
commands, unguarded compound file writes and dynamic workflow children still need
stronger isolation and enforcement. Provider account defaults, credential references
and keychain/secret-manager integration are not implemented in this profile format.
No credential selection is implied by switching profiles. Credentials still come
from the configured environment. Windows/macOS execution is not certified here.
