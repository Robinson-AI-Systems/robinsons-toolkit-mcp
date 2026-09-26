/**
 * Tool Inverses — Observability Ledger reversal map
 *
 * For each state-mutating tool, defines how to undo it given the original
 * args and the tool's response. A returned tool:null indicates the action
 * is intentionally non-reversible (e.g. emails, SMS, payments).
 *
 * Signature: (args, result) => { tool, args, reversible, notes } | null
 */

export const inverses = {
  // ── GitHub ────────────────────────────────────────────────────────────
  github_create_branch: (args) => ({
    tool: 'github_delete_branch',
    args: { owner: args.owner, repo: args.repo, branch: args.branch },
    reversible: true
  }),
  github_create_pull_request: (args, result) => ({
    tool: 'github_close_pull_request',
    args: { owner: args.owner, repo: args.repo, pull_number: result?.number },
    reversible: !!result?.number,
    notes: 'Closes the PR; the head branch is not deleted'
  }),
  github_create_issue: (args, result) => ({
    tool: 'github_close_issue',
    args: { owner: args.owner, repo: args.repo, issue_number: result?.number },
    reversible: !!result?.number
  }),
  github_create_or_update_file: () => ({
    tool: null,
    reversible: false,
    notes: 'No verified before-image is recorded; deleting the file could destroy an existing version. Restore from Git history manually.'
  }),

  // ── Neon ──────────────────────────────────────────────────────────────
  neon_create_branch: (args, result) => ({
    tool: 'neon_delete_branch',
    args: { project_id: args.project_id, branch_id: result?.branch?.id },
    reversible: !!result?.branch?.id
  }),
  neon_create_database: (args) => ({
    tool: 'neon_delete_database',
    args: { project_id: args.project_id, branch_id: args.branch_id, database_name: args.database_name },
    reversible: !!args.database_name
  }),
  neon_create_project: (args, result) => ({
    tool: 'neon_delete_project',
    args: { project_id: result?.project?.id },
    reversible: !!result?.project?.id,
    notes: 'DESTRUCTIVE — deletes the entire project including all branches'
  }),

  // ── Vercel ────────────────────────────────────────────────────────────
  vercel_create_project: (args, result) => ({
    tool: 'vercel_delete_project',
    args: { projectId: result?.id || args.name },
    reversible: !!(result?.id || args.name)
  }),

  // ── Fly.io ────────────────────────────────────────────────────────────
  fly_create_app: (args) => ({
    tool: 'fly_delete_app',
    args: { app_name: args.app_name },
    reversible: !!args.app_name
  }),
  fly_create_machine: (args, result) => ({
    tool: 'fly_destroy_machine',
    args: { app_name: args.app_name, machine_id: result?.id },
    reversible: !!result?.id
  }),
  fly_create_volume: (args, result) => ({
    tool: 'fly_delete_volume',
    args: { app_name: args.app_name, volume_id: result?.id },
    reversible: !!result?.id
  }),

  // ── Explicitly non-reversible (recorded for audit only) ───────────────
  resend_send_email: () => ({ tool: null, reversible: false, notes: 'Email cannot be un-sent' }),
  twilio_send_sms: () => ({ tool: null, reversible: false, notes: 'SMS cannot be un-sent' }),
  twilio_make_call: () => ({ tool: null, reversible: false, notes: 'Voice call cannot be un-made' }),
  stripe_capture_payment_intent: () => ({ tool: null, reversible: false, notes: 'Capture is final — use stripe_create_refund manually' }),
  stripe_capture_charge: () => ({ tool: null, reversible: false, notes: 'Charge capture is final — use stripe_create_refund manually' })
};

export default inverses;
