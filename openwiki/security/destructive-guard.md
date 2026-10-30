---
type: Security Control
title: Destructive guard, account operations and organization scope
description: "How every state-changing call is gated: dry_run default, ACTION1_ALLOW_DESTRUCTIVE, account-operation opt-in, per-call confirm, org allowlist and enterprise-op rules, and the audit events each decision emits."
tags: [security, guard, destructive, org-scope, audit]
openwiki:
  roles: [architecture, domain]
  change_kinds: [security, lifecycle, public-api]
  source_paths: [src/tools/destructiveGuard.ts, src/tools/orgScope.ts, src/tools/raw.ts, src/utils/audit.ts, src/server.ts]
  symbols: [guardPolicy, decideDestructive, checkDestructiveGuard, runDestructive, destructiveGuardShape, isAccountOperation, guardInstructions, autoConfirmWarning, assertMutationOrgScope, assertPayloadOrgsAllowed, assertPathOrgAllowed, noteExecutionSent]
  test_paths: [tests/unit/destructiveGuard.test.ts, tests/security/destructiveGuard.matrix.test.ts, tests/security/mutationSweep.test.ts, tests/security/orgAllowlist.test.ts, tests/security/rawRequestSweep.test.ts, tests/security/dryRunRedaction.test.ts, tests/integration/auditTrail.test.ts, tests/integration/generatedTools.test.ts, tests/integration/rawRequest.test.ts]
  invariants: ["dry_run defaults to true in every mode; a preview never depends on server flags.", "Execution check order: master switch, account-ops switch, per-call confirm.", "An unloadable config refuses execution (fail closed) but previews remain available.", "destructive_executed is written by the client right before the request is sent, never by the guard alone."]
  validation_commands: ["bunx vitest run tests/unit/destructiveGuard.test.ts tests/security/destructiveGuard.matrix.test.ts tests/security/orgAllowlist.test.ts --reporter=dot"]
---

# Destructive guard, account operations and organization scope

Consult this page when adding or changing any tool that sends POST/PUT/PATCH/DELETE, touching env switches that gate execution, or changing org allowlist behaviour. Rationale is recorded in `docs/adr/0003-destructive-guard.md`; the operator-facing description is `docs/SECURITY.md`.

**Threat model in one line**: the model sets `confirm` and `dry_run` itself, so they only prevent accidents. What actually bounds blast radius is the env switches, `ACTION1_ALLOWED_ORG_IDS`, `ACTION1_TOOLSETS`, the Action1 API role and the host's tool-approval UI. Do not describe the arguments as an authorization boundary.

## Decision logic (`src/tools/destructiveGuard.ts`)

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
  S["tool handler with destructiveGuardShape"] --> P["path pre-checks: assertSafeApiPath, assertPayloadOrgsAllowed"]
  P --> O{"allowlist set and request not bound to an allowed org?"}
  O -- yes --> R1["refused: org_not_allowed"]
  O -- no --> D{"dry_run (default true)?"}
  D -- yes --> V["preview: dry_run, would_send (secret-masked), next_step"]
  D -- no --> C{"config loads?"}
  C -- no --> R2["refused: config_invalid"]
  C -- yes --> E{"ACTION1_ALLOW_DESTRUCTIVE?"}
  E -- no --> R3["refused: destructive_disabled"]
  E -- yes --> A{"account op and no ALLOW_ACCOUNT_OPS?"}
  A -- yes --> R4["refused: account_ops_disabled"]
  A -- no --> F{"confirm YES or auto-confirm?"}
  F -- no --> R5["refused: confirm_missing"]
  F -- yes --> OK["approvedExecution on request context -> perform()"]
```

*Caption: `checkDestructiveGuard` returns a ready-made `CallToolResult` for previews and refusals, or `null` when the call may execute.*

- **Single source of truth**: `guardPolicy(flags)` feeds `decideDestructive`, `guardInstructions` (the "Destructive guard" section of the server instructions sent to the model in `serverInstructions`) and `autoConfirmWarning` (startup warning). A test checks instruction text against decisions for every env combination; if you change policy, change it in `guardPolicy` only.
- **Account operations** (`isAccountOperation`): any non-GET/HEAD call on `/users`, `/roles`, `/enterprise`, `/organizations`, `/subscription`, `/me`, and every non-GET `action1_raw_request`. They need `ACTION1_ALLOW_ACCOUNT_OPS` in addition to `ACTION1_ALLOW_DESTRUCTIVE`.
- **Audit events**: `destructive_dry_run` (info), `destructive_refused` and `destructive_executed` (via `log.audit`: always written, never throttled). The guard sets `rc.guard` so the final `tool_call` line reports `outcome` as `dry_run`/`refused`/`ok`.
- **Execution event ordering**: on approval the guard only stores `rc.approvedExecution`; `Action1Client.request` calls `noteExecutionSent` right before the first send of each non-safe request (method, query-stripped path, SHA-256 of the serialised body, caller). A call aborted by a later pre-flight check is therefore never logged as executed. Outside a request context (scripts/tests) the guard logs the event itself.
- **Preview hygiene**: previews pass the body through `redactPreview` so credential-shaped values inside e.g. `script_text` do not leak into the model context; all other values stay visible because the preview is what a person confirms. Query parameters are not shown (known gap, [Backlog](../quickstart.md#backlog)).
- Some previews need a read-only lookup (script tools GET the endpoint to detect the OS), so a preview is not always free of upstream calls ([Script execution](../workflows/script-execution.md)).

## Organization scope

`ACTION1_ALLOWED_ORG_IDS` (comma-separated UUIDs) is enforced at three points:

1. `resolveOrgId`/`assertOrgAllowed` in `src/config.ts` for the `org_id` argument ([Configuration](../architecture/configuration.md)).
2. `assertPayloadOrgsAllowed` (`src/tools/orgScope.ts`) for org ids in bodies and queries: keys matching `ORG_KEY` (`orgId`, `organization_ids`, `target_organization_id`, any separator style) are collected at any depth up to 64; deeper bodies are refused while the allowlist is set. Used by generated tools (`runGenerated`) and `action1_raw_request`.
3. `assertMutationOrgScope`, invoked inside `checkDestructiveGuard` *before* the dry-run branch so previews never show a request the server would refuse: every named org must be allowed, and unless `ACTION1_ALLOW_ENTERPRISE_OPS` is on the path must contain an allowed org id and scope entries (`include_scope`, `scoped_*`) must be bound to an organization. Enterprise-wide mutations (`/settings/all`, `/scripts/all`, `/roles`, `/enterprise`, Enterprise/Group scopes) fail closed.
4. `assertPathOrgAllowed` for `action1_raw_request`: while an allowlist is set a free-form path must match a documented template from `GENERATED_TOOL_MANIFEST`/`GENERATED_SKIPPED_OPERATIONS`, otherwise its org cannot be checked and it is refused.

All of these are no-ops while the allowlist is empty; `assertMutationOrgScope` additionally ignores GET/HEAD, whereas `assertPathOrgAllowed` also gates raw GET paths once an allowlist is set.

## Where the guard is applied

| Tool family | How |
|---|---|
| Curated execution tools | `startAction()` -> `runDestructive` ([Script execution](../workflows/script-execution.md)) |
| `action1_execute_and_wait` | calls `checkDestructiveGuard` directly, then its own POST |
| Group membership tools | `src/tools/groups.ts` |
| Generated POST/PUT/PATCH/DELETE tools | `runGenerated({ destructive })`; the generator emits `destructiveGuardShape` for every mutating operation unless listed in `READISH_OPERATION_IDS` (empty) ([Codegen and spec](../workflows/codegen-and-spec.md)) |
| `action1_raw_request` | GET/HEAD free; everything else through `runDestructive`, always an account operation |

## Change guidance

- **New mutating tool**: spread `...destructiveGuardShape` into the input, annotate `readOnlyHint:false, destructiveHint:true`, and send through `runDestructive`/`startAction` with a `preview` of exactly what will be sent. `tests/security/mutationSweep.test.ts` executes every state-changing tool of `tools/list` (curated and generated) against a spec-backed fake API and checks the write is sent exactly once, also when the upstream answers 502; `tests/integration/generatedTools.test.ts` asserts every generated mutating tool is guarded.
- **New account-level path family**: extend `ACCOUNT_PATH` and the matrix tests.
- **New flag**: add to `GuardFlags`/`guardPolicy`, `ENV_VARS` ([Configuration](../architecture/configuration.md)), the instruction text and `destructiveGuard.matrix.test.ts`; keep the check order (switch, account ops, confirm).
- Never read env vars directly in guard code; go through `loadConfig()`.
- Escalate to the broader `bun run test:security` when touching `orgScope.ts`, `redactPreview` or the audit path; the guard, org scope and raw tool have per-file coverage floors in `vitest.config.ts` (`bun run test:coverage` is conditional on changing them).
- Known open items (bracketed org keys, scope-key spellings) are listed in `BACKLOG.md` and in the quickstart [Backlog](../quickstart.md#backlog).
