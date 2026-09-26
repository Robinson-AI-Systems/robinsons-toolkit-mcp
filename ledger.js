import { currentWorkspace } from './src/core/context.js';
/**
 * Observability Ledger — append-only transaction log
 *
 * Each state-mutating tool call (per inverses.js) appends a receipt to a
 * JSONL ledger at WORKSPACE_ROOT/.toolkit-ledger.jsonl. The
 * compound_rollback_transaction tool reads this ledger and replays the
 * inverse operations in reverse order to undo agent actions.
 *
 * Entries marked reversible:false (emails, SMS, etc.) are recorded for
 * audit but cannot be undone.
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const ledgerPath = () => join(currentWorkspace(), '.toolkit-ledger.jsonl');

export const LEDGER_FILE = ledgerPath();

export function appendReceipt({ tool_name, args, result, inverse, reversible = true, notes, transaction_id }) {
  const entry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    transaction_id,
    tool_name,
    args,
    result_summary: summarize(result),
    inverse,
    reversible,
    rolled_back: false,
    notes
  };
  try {
    appendFileSync(ledgerPath(), JSON.stringify(entry) + '\n', 'utf-8');
  } catch (e) {
    console.error(`Ledger append failed: ${e.message}`);
  }
  return entry;
}

export function readLedger({ limit, since, transaction_id, include_rolled_back = false } = {}) {
  if (!existsSync(ledgerPath())) return [];
  const lines = readFileSync(ledgerPath(), 'utf-8').split('\n').filter(Boolean);
  let entries = lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  if (!include_rolled_back) entries = entries.filter(e => !e.rolled_back);
  if (since) entries = entries.filter(e => e.timestamp >= since);
  if (transaction_id) entries = entries.filter(e => e.transaction_id === transaction_id || e.id === transaction_id);
  if (limit) entries = entries.slice(-limit);
  return entries;
}

export function markRolledBack(ids) {
  if (!existsSync(ledgerPath())) return 0;
  const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
  const lines = readFileSync(ledgerPath(), 'utf-8').split('\n').filter(Boolean);
  let count = 0;
  const updated = lines.map(line => {
    try {
      const entry = JSON.parse(line);
      if (idSet.has(entry.id) && !entry.rolled_back) {
        entry.rolled_back = true;
        entry.rolled_back_at = new Date().toISOString();
        count++;
      }
      return JSON.stringify(entry);
    } catch { return line; }
  });
  writeFileSync(ledgerPath(), updated.join('\n') + '\n', 'utf-8');
  return count;
}

function summarize(result) {
  if (result == null) return null;
  if (typeof result !== 'object') return result;
  const keys = ['id', 'name', 'sha', 'number', 'host', 'url'];
  const summary = {};
  for (const k of keys) if (result[k] !== undefined) summary[k] = result[k];
  if (result.branch?.id) summary.branch_id = result.branch.id;
  if (result.branch?.name) summary.branch_name = result.branch.name;
  if (result.project?.id) summary.project_id = result.project.id;
  if (result.object?.sha) summary.sha = result.object.sha;
  if (result.content?.sha) summary.file_sha = result.content.sha;
  return Object.keys(summary).length ? summary : null;
}

export default { appendReceipt, readLedger, markRolledBack, LEDGER_FILE };
