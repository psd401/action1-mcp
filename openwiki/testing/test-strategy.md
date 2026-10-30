---
type: Testing Guide
title: Test strategy, harnesses and behavior-to-test map
description: "How the Vitest suites are layered (unit, integration over the MCP SDK, security, performance, artifact e2e, live smoke), the shared harnesses and spec-backed fake API, which test locks which invariant, narrow validation commands, and the stateful behavior matrix for token cache, cursors, HTTP limits and polling."
tags: [testing, vitest, harness, coverage, security-tests]
openwiki:
  roles: [testing]
  change_kinds: [tests, validation]
  source_paths: [TESTING.md, vitest.config.ts, vitest.e2e.config.ts, tests/helpers/mcpHarness.ts, tests/helpers/specStub.ts, tests/helpers/specFixtures.ts, tests/helpers/toolArgs.ts, tests/fixtures/tools-list.baseline.json, scripts/tools-list-snapshot.mjs, scripts/inspector-smoke.sh, scripts/live-shape-check.mjs]
  symbols: [connectHarness, setSweepEnv, stubSpecApi, specExample, sweepToolArgs]
  test_paths: [tests/unit, tests/integration, tests/security, tests/performance, tests/e2e]
  invariants: ["Default bun run test excludes tests/e2e and never reaches a real Action1 tenant.", "Sweep tests derive arguments and responses from tools/list and the vendored spec, so new tools and spec operations are covered without fixtures."]
  validation_commands: ["bunx vitest run <file> --reporter=dot", "bun run test:unit", "bun run test:security"]
---

# Test strategy, harnesses and behavior-to-test map

`TESTING.md` is the authoritative human description (six layers, CI mapping, live shape check); this page is the navigation layer. Test runner: Vitest 5, `testTimeout` 30 s (many tests build the full server), Node environment. Commands: `bun run test` (unit + integration + security + performance), `test:unit|integration|security|performance`, `test:coverage` (v8, thresholds ratcheted in `vitest.config.ts`), `test:e2e` (separate config; needs registry access). For a single file use `bunx vitest run tests/unit/<file>.test.ts --reporter=dot` (quiet on success, full diagnostics on failure). Node-related checks and CI mapping are in [Build, release and CI](../delivery/build-release-and-ci.md).

## Layers and harnesses

| Layer | Drives | Key helpers |
|---|---|---|
| `tests/unit` | pure logic, client, config, codegen, payloads, docs consistency | stubbed `fetch`; `tests/helpers/specFixtures.ts` (`specExample` builds records from spec schemas) |
| `tests/integration` | real `buildServer()` through an in-memory MCP client/server pair, the stdio entry, and the real HTTP app on an ephemeral port | `connectHarness` + `setSweepEnv` (`tests/helpers/mcpHarness.ts`; test org constants `TEST_ORG`, `FOREIGN_ORG`), `stubSpecApi` (`specStub.ts`: fake Action1 answering every documented operation with a minimal 200 example, 404 + recorded `template: undefined` for undocumented paths), `sweepToolArgs` (`toolArgs.ts`: minimal valid arguments from the advertised input schema) |
| `tests/security` | guard truth table, org allowlist, redaction, PII, CSV injection, redirect refusal, mutation/raw-request sweeps | same harness; sweeps iterate over `tools/list` |
| `tests/performance` | work counted (serialised chars, cell reads), not wall-clock | `cap.test.ts`, `boundedState.test.ts` |
| `tests/e2e` | built `dist/` and the unpacked MCPB bundle | `vitest.e2e.config.ts`; conditional (packaging/entry-point changes) |
| Manual | `scripts/inspector-smoke.sh` (output-schema errors only appear at runtime; run before merging tool-schema changes), `scripts/live-shape-check.mjs` (GET-only, value-free report; owner only), live smoke via Keychain credentials | not in CI |

## Which test locks what

| Invariant (area) | Test |
|---|---|
| Public surface never loses a v0.5.0 tool/input/resource/prompt arg; no new required input; annotations and output schemas stay | `tests/integration/toolsListBaseline.test.ts` (fixture `tests/fixtures/tools-list.baseline.json`; types and enum values are NOT compared) |
| Every registered tool, resource and prompt, annotations, output-schema validity | `tests/integration/server.test.ts`, `toolsListSchemas.test.ts`, `toolSmoke.test.ts` |
| USAGE docs name every curated tool and parameter | `tests/integration/usageDocs.test.ts`, `tests/unit/docsConsistency.test.ts` |
| Guard decisions and texts per env combination | `tests/unit/destructiveGuard.test.ts`, `tests/security/destructiveGuard.matrix.test.ts` |
| Every mutating tool sends exactly once, even on 502 | `tests/security/mutationSweep.test.ts` |
| Raw request over every method/spec path; org paths | `tests/security/rawRequestSweep.test.ts`, `tests/integration/rawRequest.test.ts` |
| Org allowlist in bodies at any depth; fail closed enterprise | `tests/security/orgAllowlist.test.ts` |
| Log/error/success/dry-run redaction; PII keys derived from spec | `tests/security/redaction.test.ts`, `errorRedaction`, `successRedaction`, `dryRunRedaction`, `pii.test.ts`, `piiSweep.test.ts` |
| CSV formula injection | `tests/security/csvSanitize*.test.ts` |
| Audit events and HTTP rejection logging (token never logged) | `tests/integration/auditTrail.test.ts` |
| Cancellation reaches upstream calls | `tests/integration/cancellation.test.ts` |
| HTTP pipeline, startup refusal, readiness, modern protocol | `httpTransport`, `httpEntry`, `httpModernProtocol`, `readiness`, `protocolVersions`, `toolInputLimit` integration tests |
| Retry policy per method, timeouts, path safety, 401 single retry | `tests/unit/clientReliability.test.ts`, `retry.test.ts`, `action1Client*.test.ts` |
| Spec/generated consistency | [Codegen and spec](../workflows/codegen-and-spec.md) tests |
| Fork and release policy | `tests/unit/psdFork.test.ts`, `releaseChain.test.ts` |

## Stateful behavior matrix (where to look)

| Behavior | Existing test location |
|---|---|
| Token cache: reuse within lead window; refresh 5 min before expiry; concurrent callers share one request; `invalidate()` refetches; refresh-token path and client-credentials fallback; `expires_in` clamp (60 s..24 h); transient token failures retried, 400 not; hang bounded by `ACTION1_TOKEN_TIMEOUT_MS` | `tests/unit/auth.test.ts` (describe "TokenProvider", "TokenProvider wire format and failure paths"); 401 single re-issue: `action1Client401Retry.test.ts` |
| Readiness token state (`cached`/`failing`/`not_acquired`) | `tests/integration/readiness.test.ts` |
| Cursor walks: fingerprint mismatch rejected, never restarts at 0; filtered walks keep upstream position; `total` only on the final page; oversize placeholder; page cap | `tests/unit/cursor.test.ts`, `pagedListResult.test.ts`, `pagination.test.ts`, `tests/integration/listCorrectness.test.ts` |
| HTTP per-peer state bounded (rate-limit map, rejection-log throttle) and one OAuth token shared across requests | `tests/performance/boundedState.test.ts` |
| Logger throttle (sampling above 1000/min; audit never throttled) | `tests/unit/loggerThrottle.test.ts`, `logger.test.ts`, `loggerFatal.test.ts` |
| Polling: terminal statuses only, progress notifications, start errors | `tests/integration/workflows.test.ts`, `tests/unit/execution.test.ts` |
| Config reuse/reset between tests | `resetConfigCache()` / `setSweepEnv` - isolation between tests depends on calling them |

## Change guidance

- New tool: sweep tests pick it up automatically; add focused unit tests and update `docs/USAGE.md` ([Change recipes](../workflows/change-recipes.md)).
- Tests that need config must set env and call `resetConfigCache()`; tests must not rely on wall-clock time for size/scale properties (use counting like `tests/performance`).
- Do not reference review finding ids in tests or docs (`noReviewReferences.test.ts`).
- Expensive and conditional: `bun run test:coverage` (touching files with per-file floors), `bun run test:e2e` (packaging), `scripts/inspector-smoke.sh` and live checks (output schema or payload changes; need a tenant).
- Known test gap in the [Backlog](../quickstart.md#backlog): the baseline test ignores input types and enum values.
