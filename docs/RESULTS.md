# Bounded results

Core execution and both adapters return small results inline. Larger results
are stored as redacted JSON and represented by resultId, byteCount, recordCount,
operationFailed and retrieval instructions. Record counts measure top-level
arrays or the largest immediately nested array, not arbitrary nested records.

Defaults: 16 KiB inline, 100 records, 32 MiB maximum stored result, 128 MiB total
store quota, 24-hour TTL. Set RT_MAX_INLINE_BYTES and RT_MAX_INLINE_RECORDS to
adjust adapter limits; Core accepts resultOptions for all limits. Storage is
under TOOLKIT_STATE_DIR or ~/.local/state/robinsons-toolkit, partitioned by a
hash of the workspace path. Files use mode 0600; directories use 0700.

```
rt result read res_<uuid> --cursor 0 --limit 4096
rt result search res_<uuid> "literal query" --limit 10
```

Read cursors are UTF-8 byte positions; search cursors are UTF-16 character
positions. Follow each operation's nextCursor with the same operation. Search
is literal, case-sensitive, and returns bounded snippets. No regex execution.
MCP equivalents: toolkit_result_read and toolkit_result_search.

Traversal IDs and symlink result files are rejected. A filesystem write lock
serializes quota checks. A crashed writer may leave .write-lock; an operator
must verify no writer is active before removing that stale lock. TTL cleanup
occurs on writes; expired reads fail clearly. Search currently reads a bounded
stored file into memory, not a streaming index.

A storage failure after execution explicitly says the operation may already
have completed: do not automatically retry a mutation. Provider wrappers may
still truncate data internally; the broker cannot recover bytes discarded by
those historical wrappers. Configured-secret redaction is defense in depth,
not full secret-manager isolation or an OS sandbox.
