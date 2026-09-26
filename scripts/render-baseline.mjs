import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=join(dirname(dirname(fileURLToPath(import.meta.url))),'reports/recovery');
const r=JSON.parse(readFileSync(join(dir,'baseline.json')));
const duplicates=JSON.parse(readFileSync(join(dir,'duplicate-candidates.json')));
const manifest=JSON.parse(readFileSync(join(dir,'capability-manifest.json')));
const counts={};for(const e of manifest) counts[e.registryNamespace]=(counts[e.registryNamespace]||0)+1;
const high=duplicates.filter(x=>x.confidence==='high');
writeFileSync(join(dir,'BASELINE.md'),`# Recovery baseline (generated measurements)

Source: \`${r.sourceHead}\`. Branch: \`v3/recovery-core\`. Local baseline tag: \`v2-recovered\`.

This records inherited failures, not production readiness. Main and all existing provider code were left unchanged at Checkpoint 0.

| Measurement | Observed |
| --- | ---: |
| Registry entries | ${r.counts.registryEntries} |
| Unique registry names | ${r.counts.uniqueNames} |
| Handler dispatch occurrences | ${r.counts.handlerDispatchBranches} |
| Unique handler dispatch names | ${r.counts.uniqueHandlerNames} |
| Registry namespaces | ${r.counts.namespaces} |
| Exact duplicate registry names | ${r.counts.duplicateNames} |
| Registry names without matching handler branch text | ${r.mismatches.registryWithoutHandler.length} |
| Handler names missing registry metadata | ${r.mismatches.handlerWithoutRegistry.length} |
| Repeated dispatch names | ${r.repeatedDispatchNames.length} |
| MCP advertised tools | ${r.runtime.advertisedToolCount} |
| MCP serialized tools-array bytes (UTF-8) | ${r.runtime.advertisedSchemaBytes} |
| Direct capability schemas advertised (including local/compound) | ${r.runtime.providerSchemasAdvertised} |
| Differently named duplicate/overlap candidates | ${duplicates.length} |
| Identical-body candidates | ${high.length} |

Handler count is a static dispatch-name count, **not** a count of verified working capabilities. Gemini cannot parse; its dispatch names use an explicitly flagged textual fallback. Other handlers use an AST. The same dispatch name can occur in multiple shadowed branches.

## Runtime verification

- Zero-optional-secret stdio initialize: ${r.runtime.booted?'PASS':'FAIL'}, negotiated ${r.runtime.protocolVersion}.
- Local directory listing through MCP: ${r.runtime.localCallPassed?'PASS':'FAIL'}.
- Explicit Stripe request without key reports an error: ${r.runtime.missingStripeIsError?'PASS':'FAIL'}.
- Handler module imports: ${r.handlerImports.filter(x=>x.passed).length}/${r.handlerImports.length} passed; Gemini failed.
- Missing-key discovery isolation: FAIL. Search tools appear without credentials because registry namespace \`search\` has no matching gate. Compound workflows requiring providers also remain discoverable.
- Optional-package presence is not checked: Playwright and postgres imports are deferred inside handlers but these packages are not declared in package.json.
- Provider integration tests: **${r.runtime.providerLiveTests}**.
- Legacy audit reports mismatches but exits ${r.legacyAudit.exitCode}. New \`npm run audit:integrity\` correctly exits 1 for inherited violations.
- Three analyzer regression tests pass (aliases, fabricated results, primitive/workflow non-merging).

## Confirmed implementation failures

${r.findings.map(f=>`- ${f.file}:${f.line}: ${f.rule} — ${f.disposition}.`).join('\n')}

Anthropic supplies fabricated success-like tool-result content without executing requested tools. Browser route interception is legitimate functionality, not a placeholder. Gemini has multiple malformed multiline single-quoted strings; the report lists the first parse failure.

## Missing registry metadata

${r.mismatches.handlerWithoutRegistry.map(n=>`- \`${n}\``).join('\n')}

## Repeated handler dispatches

${r.repeatedDispatchNames.map(x=>`- \`${x.name}\`: ${x.locations.join(', ')}`).join('\n')}

Earlier commit e12a149 removed duplicate registry definitions, but left these repeated handler branches. Later branches may be unreachable. Do not choose an endpoint merely by which branch is newer; verify upstream documentation before repair.

## High-confidence duplicate candidates (not yet merged)

${high.map(x=>`- ${x.tools.join(' ↔ ')}: ${x.reasons.join('; ')}.`).join('\n')}

Identical code does not automatically prove intended semantic equivalence (for example Redis SAVE/BGSAVE). Shared-branch aliases can still have different schemas. Full candidate evidence is in duplicate-candidates.json. No names were removed. This initial analyzer covers AST fingerprints, ordered call expressions and lexical description similarity; embeddings, full data-flow equivalence, output contracts and superset classification remain future work.

## Namespace inventory

| Namespace | Entries |
| --- | ---: |
${Object.entries(counts).map(([n,c])=>`| ${n} | ${c} |`).join('\n')}

## Architecture recovered from source and history

Implemented: lean discovery broker with extra pinned schemas; lexical search; registry JSON; provider handlers; limited inverse-map ledger; synchronous local/cloud workflows. Partially implemented: availability (namespace inconsistencies, unconditional pinning, no execution gate); result minimization (per-handler truncation/buffers); rollback (only inverse-map operations, compound child calls bypass central receipts).

Planned but absent: true lazy handler loading, shared CLI/core boundary, local semantic index, sandbox backend, isolated credentials, result store, profiles, project packs, shared workflow transaction IDs.

Security blockers: local/compound shell calls inherit process.env; local write containment uses string-prefix checks and does not resolve symlinks; stack traces and ledger args are not centrally redacted; local environment/file tools can expose secrets; compound handlers call providers directly. Registry equality is not a security or correctness certification.

README and CLAUDE report 2,537; EXPANSION_INDEX reports 3,103. Executable inventory reports ${r.counts.registryEntries}. Historical verification documents describe previous environments; they do not prove current startup, auth, rollback or provider API correctness. README and CLAUDE also contain literal escaped newlines. The design documents' Fat Server, Lean Client and anti-agent-OS boundaries remain the target. Their code snippets are explicitly illustrative and were not copied as implementations.

## Reproduction and checkpoint status

Run \`npm ci --ignore-scripts\`, \`npm test\`, \`npm run audit:integrity\` and \`node scripts/baseline.mjs /tmp/rt-current-audit\`. The committed report is the immutable recovery snapshot; use a different output directory for later audits. Run \`node scripts/render-baseline.mjs\` to regenerate this Markdown from the snapshot.

Baseline measurement is complete; **inherited integrity fails** and must remain visible. Checkpoint 1 can extract core behind compatibility tests without pretending these provider defects passed. GitHub branch creation returned 403 Resource not accessible by integration. The repository was cloned successfully, and work can be committed locally pending organization installation/write access.
`);
