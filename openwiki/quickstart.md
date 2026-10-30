---
type: Quickstart
title: Action1 MCP server wiki quickstart
description: "Entry point to the OpenWiki knowledge base for the unofficial Action1 RMM MCP server (psd401 fork): what the repository is, how the wiki is organized, a task-routing table to source entry points and tests, and the backlog of undocumented areas."
tags: [quickstart, navigation, action1, mcp]
---

# Action1 MCP server: wiki quickstart

## What this repository is

An **unofficial Model Context Protocol (MCP) server for the Action1 RMM REST API** (psd401 fork of `mguttmann/action1-mcp`, not affiliated with Action1). It runs as a Node.js 22.12+ process over **stdio** (default) or **stateless Streamable HTTP** (`--http`), and exposes `action1_*` tools, `action1://` resources and slash prompts. Tools can run scripts on every managed endpoint, so a server-side **destructive guard** (dry-run by default, env switches, per-call confirmation, org allowlist) sits in front of every state-changing call. The fork builds with bun, ships the server as a reproducible **MCPB bundle** for Claude Desktop, and publishes nothing.

Start with [architecture/overview.md](architecture/overview.md) for the layer map and the lifecycle of one tool call.

## How the wiki is organized

| Section | Pages |
|---|---|
| Architecture | [overview](architecture/overview.md), [runtime and transports](architecture/runtime-and-transports.md), [configuration](architecture/configuration.md), [Action1 client](architecture/action1-client.md) |
| Domain | [tool surface](domain/tool-surface.md), [output shaping and pagination](domain/output-and-pagination.md) |
| Security | [destructive guard and org scope](security/destructive-guard.md), [redaction, logging and audit](security/redaction-and-audit.md) |
| Workflows | [script execution](workflows/script-execution.md), [codegen and spec](workflows/codegen-and-spec.md), [change recipes](workflows/change-recipes.md) |
| Delivery | [build, release and CI](delivery/build-release-and-ci.md) |
| Testing | [test strategy](testing/test-strategy.md) |

## Task routing

Run focused tests with `bunx vitest run <file> --reporter=dot` (quiet on success, full diagnostics on failure).

| Change area | Wiki page | Source entry points | Key symbols | Focused tests | Minimal validation |
|---|---|---|---|---|---|
| Add or change a curated tool | [change recipes](workflows/change-recipes.md), [tool surface](domain/tool-surface.md) | `src/tools/*.ts`, `src/server.ts` | `registerTool`, `runTool`, `orgIdShape`, `destructiveGuardShape` | `tests/unit/naming.test.ts`, `tests/integration/server.test.ts`, `tests/integration/usageDocs.test.ts` | `bunx vitest run tests/integration/server.test.ts --reporter=dot` |
| Generated tools, spec refresh, naming | [codegen and spec](workflows/codegen-and-spec.md) | `src/codegen/generate.ts`, `src/codegen/curated-overrides.ts`, `src/tools/generated/runtime.ts` | `SKIP_OPERATION_IDS`, `READISH_OPERATION_IDS`, `runGenerated` | `tests/integration/generatedTools.test.ts`, `tests/unit/specSha.test.ts`, `tests/unit/runtime.test.ts` | `bun run codegen && git diff --stat` |
| Destructive guard, account ops, org allowlist | [destructive guard](security/destructive-guard.md) | `src/tools/destructiveGuard.ts`, `src/tools/orgScope.ts`, `src/tools/raw.ts` | `decideDestructive`, `checkDestructiveGuard`, `assertMutationOrgScope` | `tests/security/destructiveGuard.matrix.test.ts`, `tests/security/orgAllowlist.test.ts`, `tests/security/mutationSweep.test.ts` | `bun run test:security` |
| Redaction, PII masking, logs, audit events | [redaction and audit](security/redaction-and-audit.md) | `src/utils/logger.ts`, `src/utils/pii.ts`, `src/utils/audit.ts` | `redactSecretKeys`, `redactPii`, `log.audit`, `noteExecutionSent` | `tests/security/pii.test.ts`, `tests/integration/auditTrail.test.ts` | `bun run test:security` |
| Environment variables and config validation | [configuration](architecture/configuration.md) | `src/config.ts`, `src/keychain.ts`, `.env.example` | `EnvSchema`, `ENV_VARS`, `loadConfig`, `resolveOrgId` | `tests/unit/config.test.ts`, `tests/unit/configEnv.test.ts`, `tests/unit/mcpbManifest.test.ts` | `bunx vitest run tests/unit/config.test.ts --reporter=dot` |
| HTTP transport, auth, rate limit, Host/Origin | [runtime and transports](architecture/runtime-and-transports.md) | `src/http.ts`, `src/index.ts`, `src/utils/bearerAuth.ts` | `createHttpApp`, `assertHttpStartupConfig` | `tests/integration/httpTransport.test.ts`, `tests/integration/httpEntry.test.ts` | `bunx vitest run tests/integration/httpTransport.test.ts --reporter=dot` |
| Upstream calls: tokens, retry, timeouts, errors | [Action1 client](architecture/action1-client.md) | `src/client/action1Client.ts`, `src/client/auth.ts`, `src/client/retry.ts` | `Action1Client.request`, `TokenProvider`, `assertSafeApiPath` | `tests/unit/clientReliability.test.ts`, `tests/unit/auth.test.ts`, `tests/security/redirect.test.ts` | `bunx vitest run tests/unit/clientReliability.test.ts --reporter=dot` |
| List output size, cursors, Markdown tables | [output and pagination](domain/output-and-pagination.md) | `src/tools/helpers.ts`, `src/utils/cursor.ts`, `src/utils/capOutput.ts` | `jsonResult`, `pagedListResult`, `pagedFetch`, `compactItem` | `tests/unit/cursor.test.ts`, `tests/integration/listCorrectness.test.ts`, `tests/performance/cap.test.ts` | `bun run test:performance` |
| Script, reboot, deploy and wait workflows | [script execution](workflows/script-execution.md) | `src/tools/startAction.ts`, `src/tools/execution.ts`, `src/tools/workflows.ts`, `src/payloads/*.ts` | `startAction`, `resolveScriptPlatform`, `waitForInstance` | `tests/unit/execution.test.ts`, `tests/integration/workflows.test.ts`, `tests/unit/macOsBash.payload.test.ts` | `bunx vitest run tests/integration/workflows.test.ts --reporter=dot` |
| Resources, prompts, toolsets, tools/list compatibility | [tool surface](domain/tool-surface.md) | `src/resources/index.ts`, `src/prompts/index.ts`, `src/tools/registry.ts` | `toolSelected`, `applyToolPolicy` | `tests/integration/toolsListBaseline.test.ts`, `tests/unit/prompts.test.ts` | `bunx vitest run tests/integration/toolsListBaseline.test.ts --reporter=dot` |
| MCPB bundle, CI, no-publish rules | [build, release and CI](delivery/build-release-and-ci.md) | `scripts/build-mcpb.sh`, `mcpb/manifest.json`, `.github/workflows/ci.yml` | `build:mcpb`, `check` | `tests/unit/releaseChain.test.ts`, `tests/unit/psdFork.test.ts` | `bunx vitest run tests/unit/releaseChain.test.ts --reporter=dot` |
| Any change, before a PR | [test strategy](testing/test-strategy.md) | `package.json` scripts | `check` | whole suite | `bun run check` |

## Backlog

Areas not yet given their own wiki page. Each is a deliberate gap, not an unknown.

- **Payload builders** (`src/payloads/*.ts`): only summarized in [script execution](workflows/script-execution.md); field-by-field macOS/Windows payload contracts stay in code comments and `tests/unit/*payload.test.ts`.
- **Spec entity readers** (`src/spec/entities.ts`, `src/spec/time.ts`): the spec-first, legacy-second reader contract is described in [tool surface](domain/tool-surface.md) but not per entity.
- **Evaluation suite** (`evals/action1-eval.xml`, `tests/integration/evals.test.ts`): not documented; see `evals/README.md`.
- **Known defects and hardening items**: tracked in the repository's own `BACKLOG.md`; this wiki links to it rather than copying it.
- **User-facing docs** (`docs/USAGE.md`, `docs/INSTALLATION.md`, `docs/DEPLOYMENT.md`, `docs/SECURITY.md`): authoritative for operators; the wiki summarizes behavior and points to them.
