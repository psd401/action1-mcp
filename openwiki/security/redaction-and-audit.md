---
type: Security Control
title: Logging, redaction, PII masking and audit trail
description: "How action1-mcp keeps secrets and personal data out of logs, errors, previews and tool results: JSON-line logger, credential redaction layers, ACTION1_REDACT_PII, CSV formula defence and the always-written audit events."
tags: [security, logging, redaction, pii, audit]
openwiki:
  roles: [architecture, operations]
  change_kinds: [security, observability]
  source_paths: [src/utils/logger.ts, src/utils/pii.ts, src/utils/csv.ts, src/utils/audit.ts, src/utils/requestContext.ts, src/tools/helpers.ts, src/client/errors.ts]
  symbols: [log, redact, redactSecretKeys, redactPreview, redactString, logFatal, redactPii, isPiiKey, redactPiiInBody, redactPiiInCsv, piiRedactionEnabled, sanitizeCsvFormulas, bodyDigest, noteExecutionSent]
  test_paths: [tests/security/redaction.test.ts, tests/security/errorRedaction.test.ts, tests/security/successRedaction.test.ts, tests/security/dryRunRedaction.test.ts, tests/security/pii.test.ts, tests/security/piiSweep.test.ts, tests/security/csvSanitize.test.ts, tests/security/csvSanitizeAdversarial.test.ts, tests/integration/auditTrail.test.ts, tests/unit/logger.test.ts, tests/unit/loggerThrottle.test.ts, tests/unit/loggerFatal.test.ts]
  invariants: ["Audit events (log.audit) are level notice, written regardless of ACTION1_LOG_LEVEL and never throttled.", "Every tool result passes redactSecretKeys; with ACTION1_REDACT_PII it also passes redactPii on both text and structured channels.", "The PII key set is derived from the vendored spec and verified by tests/security/pii.test.ts."]
  validation_commands: ["bunx vitest run tests/security/redaction.test.ts tests/security/pii.test.ts tests/integration/auditTrail.test.ts --reporter=dot"]
---

# Logging, redaction, PII masking and audit trail

Stdout carries MCP only. Everything operational goes to **stderr as one JSON object per line** (`src/utils/logger.ts`). There is deliberately no MCP `logging` capability (`logging/setLevel` is deprecated as of 2026-07-28; see the comment in `buildServer`). Operator-facing description: `docs/SECURITY.md` (sections "Logging and audit events", "Redaction", "Data sent to the LLM provider").

## Layers of protection

| Surface | Mechanism | Where |
|---|---|---|
| Log lines | `redact()`: credential-shaped keys -> `[REDACTED]`, free-text patterns (Bearer, `api-key-...`, `sk-...`, JWT, URL basic auth, `client_secret=`, cookies), depth cut at 6, binary and circular guards, meta size caps (8 KiB soft / 4 KiB hard) | `logger.ts` `REDACT_KEY_PATTERNS`, `REDACT_VALUE_PATTERNS` |
| Successful tool results and resource reads | `redactSecretKeys()` masks credential-shaped keys at any depth (to 256) without touching other values or strings | `jsonResult` in `src/tools/helpers.ts`, resources |
| Error text | Upstream bodies and paths go through `redactString`/`redactPath`; `upstreamBodyText` masks echoed bodies | `src/client/errors.ts`, `helpers.ts` |
| Dry-run previews | `redactPreview()`: no depth limit (deploy bodies nest deeply), masks credential keys and free-text secrets inside strings such as `script_text` | `destructiveGuard.ts` |
| Personal data (opt-in) | `ACTION1_REDACT_PII`: `redactPii()` replaces values of PII-named keys with `[REDACTED:pii]` in tool results (both channels), resource reads, error bodies and text/CSV bodies (`redactPiiInBody` -> `redactPiiInCsv` masks columns by header) | `src/utils/pii.ts`, applied in `jsonResult` and `Action1Client.request` |
| Spreadsheet export | `sanitizeCsvFormulas()` prefixes cells that start (after whitespace) with `= + - @ TAB CR` formula triggers; plain negative numbers and phone numbers pass | `src/utils/csv.ts`, used by `action1_report_export` |

PII key rules (`isPiiKey`): user/login/logged-on user, user names, e-mail, address and `*_ip`, IPv4/6, MAC, serial, phone, first/last/full name, plus case-sensitive `AD_*` fields; keys are normalised so report display names ("User Name", "IP Address") match. `tests/security/pii.test.ts` derives every personal-data property from the vendored OpenAPI spec and fails when one is not masked, so a spec refresh can surface new keys ([Codegen and spec](../workflows/codegen-and-spec.md)). Known gaps (columns like `Last User`, quoted CSV headers with commas, depth 32 vs 256) are in the quickstart [Backlog](../quickstart.md#backlog).

## Logger behaviour

- Levels follow syslog names; `warn`/`warning` share a rank. `ACTION1_LOG_LEVEL` is read once at import (see [Configuration](../architecture/configuration.md)).
- Throttle: debug/info beyond 1 000 entries/min are sampled to ~10 % with a `logger_throttled` summary; notice and above are never dropped.
- `logFatal(msg, err)` is used by the entry point so every death path writes a JSON line first.
- Each line carries the current `request_id` when inside a tool call (`RequestContext`, [Runtime and transports](../architecture/runtime-and-transports.md)).

## Audit events

| Event | Written by | Level / guarantees |
|---|---|---|
| `tool_call` | `timedCall` in `src/tools/registry.ts` | info (warn on error): tool, `duration_ms`, `outcome`, `upstream_status`, `attempts`, `org`, `caller` |
| `destructive_dry_run` | guard | info, routine |
| `destructive_refused` (`reason`: `destructive_disabled`, `account_ops_disabled`, `confirm_missing`, `config_invalid`, `org_not_allowed`) | guard | audit |
| `destructive_executed` | `noteExecutionSent` from `Action1Client` | audit; method, path without query, `body_sha256`, caller, `account_op`; one per request actually sent |
| `http_auth_failed`, `http_host_rejected`, `http_origin_rejected`, `http_rate_limited` | `src/http.ts` | audit, deduplicated per peer/reason per 60 s with `suppressed_since_last`; the token is never logged (only `tokenId` = 12-hex SHA-256 prefix on caller lines) |
| `guard_config`, `auto_confirm_enabled` | `buildServer` once per process | info / warn |

See [Destructive guard](destructive-guard.md) for when each guard event fires and [Action1 client](../architecture/action1-client.md) for the send-time hook.

## Change guidance

- **New secret-shaped key**: add to `REDACT_KEY_PATTERNS` (credential keys like `private_key`, `passphrase` are known to be missing), extend `tests/security/redaction.test.ts`.
- **New personal-data field**: extend `PII_KEY`/`AD_KEY` in `pii.ts`; `piiSweep.test.ts` and `pii.test.ts` cover tool results, resource reads and errors.
- **New output path that bypasses `jsonResult`** (raw text, CSV, errors): apply `redactSecretKeys`/`redactPii`/`redactPiiInBody` yourself; this is the most common way a leak is introduced.
- **New audit event**: use `log.audit`, include `caller` from the request context, test it in `tests/integration/auditTrail.test.ts`.
- Coverage floors exist for `src/utils/pii.ts`; run `bun run test:coverage` only if you changed it substantially. `bun run test:security` is the right escalation for any redaction change.
