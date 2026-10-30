# Files

- [Destructive guard, account operations and organization scope](destructive-guard.md) - How every state-changing call is gated: dry_run default, ACTION1_ALLOW_DESTRUCTIVE, account-operation opt-in, per-call confirm, org allowlist and enterprise-op rules, and the audit events each decision emits.
- [Logging, redaction, PII masking and audit trail](redaction-and-audit.md) - How action1-mcp keeps secrets and personal data out of logs, errors, previews and tool results: JSON-line logger, credential redaction layers, ACTION1_REDACT_PII, CSV formula defence and the always-written audit events.
