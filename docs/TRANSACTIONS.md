# Transactions and compensation

`rt tx list --json` reads the selected workspace's receipt history.
`rt tx rollback <transaction-id> --dry-run --json` previews compensation.
`rt tx rollback <transaction-id> --json` executes the plan. The MCP
`toolkit_transaction` broker uses the same Core methods. Existing
`compound_rollback_transaction` calls remain supported.

Compound child operations share a transaction ID. Current receipt coverage is
limited to the legacy inverse map; operations without a map are not yet recorded.
List output is bounded by the result store, with a default of 100 latest receipts.
A transaction ID or individual historical receipt ID can select a rollback.

Compensations run in reverse receipt order. Closing an issue or deleting a newly
created resource is compensation, not erasure of every side effect; responses
report COMPENSATED and preserve `reversed` as a compatibility count. Email and
other irreversible operations remain in the report and make overall success false.
An empty selection is an error. A failure stops earlier dependent compensations.

Before each provider call, a durable attempt event is written. Uncertain outcomes
block replay and the rest of that selection until manual reconciliation. A process
crash leaves an exclusive rollback lease; inspect the provider and ledger before
removing an abandoned lease. There is deliberately no automatic lease expiry or
blind retry after an ambiguous remote mutation. Reconciliation automation is not
implemented. A failed completion write is reported as uncertain, not success.

Receipts use private files and append-only completion events. Symlinks, hard links,
corrupt or incomplete JSON, concurrent writers and files above 64 MiB fail closed.
Known secrets are redacted before receipts reach storage. Existing receipt-only
JSONL files remain readable. Workspace ancestors and the host filesystem remain
trusted; this is not protection from a malicious process with the same OS identity.

The inverse map still needs provider-by-provider review. In particular, file
updates have no verified before-image and therefore cannot be undone automatically.
No live provider rollback was performed during offline verification.
