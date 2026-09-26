# Confirmed provider repairs

The Gemini module contained four malformed single-quoted newline literals.
These are now escaped correctly; all provider modules parse and import.
No Gemini endpoint, model selection, or request format changed.

`anthropic_message_with_tools` now makes one real Messages request and returns
pending tool calls, response content, usage, and a continuation messages array.
The calling agent executes client tools and supplies actual results through
`anthropic_message`. The historical `max_turns` parameter is retained but emits
a deprecation warning: automatic turns with fabricated results were invalid.
No autonomous agent loop was added.

Validation: module imports plus an intercepted HTTP contract test (test code
only) verifying exactly one request and no invented tool results. Live provider
tests were not run — credentials unavailable. Remaining orphan metadata and
shadowed dispatch branches still fail strict integrity checks.

Official contracts checked:
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
- https://ai.google.dev/api/generate-content
