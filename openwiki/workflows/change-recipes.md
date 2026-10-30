---
type: Playbook
title: Change recipes for recurring extension seams
description: "Evidence-backed recipes for adding or changing a curated tool, wrapper, resource, prompt, generated-tool override, environment variable, guard policy, payload builder or HTTP check, with the full change surface, focused tests and escalation conditions."
tags: [recipes, contributing, extension-points, checklist]
openwiki:
  roles: [workflow, testing]
  change_kinds: [public-api, registration, config, codegen]
  source_paths: [docs/CONTRIBUTING.md, src/server.ts, src/tools/registry.ts, src/config.ts, src/codegen/curated-overrides.ts, src/resources/index.ts, src/prompts/index.ts, src/tools/wrappers/index.ts]
  test_paths: [tests/integration/server.test.ts, tests/integration/toolsListBaseline.test.ts, tests/integration/generatedTools.test.ts, tests/integration/usageDocs.test.ts, tests/unit/naming.test.ts, tests/unit/curatedPaths.test.ts, tests/unit/configEnv.test.ts, tests/unit/mcpbManifest.test.ts, tests/unit/docsConsistency.test.ts]
  invariants: ["A new tool is complete only when it is registered in buildServer (or a register* aggregator), visible in tools/list through the MCP harness, documented in docs/USAGE.md and does not break the v0.5.0 baseline."]
  validation_commands: ["bunx vitest run tests/integration/server.test.ts tests/integration/toolsListBaseline.test.ts tests/integration/usageDocs.test.ts --reporter=dot"]
---

# Change recipes

Source of the human-facing version: `docs/CONTRIBUTING.md` ("Workflows"). This page adds the layers that tests actually enforce. This repo is a single published-nowhere package (`private: true`), so the "shipped surface" is what an MCP client sees over `tools/list`, `resources/list`, `prompts/list` and the built `dist/` / MCPB bundle, not an npm export map.

**Internal vs shipped correctness.** Passing a unit test of a new `register*` function is not enough. Verify (1) it is called from `buildServer`; (2) it appears through the in-memory client (`connectHarness` in `tests/helpers/mcpHarness.ts`, used by `server.test.ts`); (3) the documented surface (`docs/USAGE.md`) names it and each input (`usageDocs.test.ts`); (4) the compatibility baseline still passes. Only changes to build or packaging need `bun run build` / `bun run build:mcpb` ([Build, release and CI](../delivery/build-release-and-ci.md)).

## Add a curated tool

| Layer | Do |
|---|---|
| Implementation | Add `server.registerTool("action1_<verb>_<resource>", ...)` with a **literal** name in a `src/tools/*.ts` file; compose `orgIdShape`, `formatShape`, `cursorInputShape`, `destructiveGuardShape`, `targetTypeShape`; wrap handler in `runTool`; mutate only behind `runDestructive` / `checkDestructiveGuard` ([Destructive guard](../security/destructive-guard.md)); honest `annotations` (they drive `ACTION1_TOOLSETS=read`) |
| Registration | New file: add `registerXTools` and call it in `buildServer` (`src/server.ts`) after the policy hooks |
| Codegen collision | Run `bun run codegen`; a generated tool with the same name is dropped. If it was a generated operation you replace, add `SKIP_OPERATION_IDS` ([Codegen and spec](codegen-and-spec.md)) |
| Spec binding | Read fields via `src/spec/entities.ts`; undocumented paths go in `known-undocumented-endpoints.json` |
| Output | Return through `jsonResult` / `pagedListResult` ([Output and pagination](../domain/output-and-pagination.md)); set a permissive output schema |
| Docs | `docs/USAGE.md` (tool + every parameter); `docs/EXAMPLES.md` if useful; `docs/permissions.md` and `docs/_coverage_table.md` are generated |
| Tests | Unit under `tests/unit/` (happy path + each error branch); `tests/unit/naming.test.ts` for the name; sweep tests (`mutationSweep`, `toolSmoke`) cover every registered tool automatically |
| Minimal validation | `bunx vitest run tests/integration/server.test.ts tests/integration/generatedTools.test.ts tests/unit/naming.test.ts tests/integration/usageDocs.test.ts --reporter=dot` |

Escalate to `bun run test:security` if the tool mutates, accepts org ids, or returns user data; to `bun run check` before opening a PR.

## Add a high-level wrapper

Add a `registerX` function in `src/tools/wrappers/index.ts` and list it in `registerWrapperTools`; reads only; reuse `fingerprintQuery`/`pagedFetch` for paging; tests in `tests/unit/wrappers.test.ts` and `tests/integration/specShapes.test.ts` (records built from spec schemas via `specExample`). Known smell: `fuzzyFind` lives in the same file.

## Add a resource or prompt

- Resource: `server.registerResource` in `src/resources/index.ts` (`action1://<noun>` or `ResourceTemplate`), return JSON through `safeResourceRead` (maps 404 to resource-not-found; tests `tests/unit/safeResourceRead.test.ts`), document in the `docs/USAGE.md` resource table. Resource reads run under a request context but emit no `tool_call` line.
- Prompt: `server.registerPrompt` in `src/prompts/index.ts`, string args only, destructive steps default `dry_run: true`; tests `tests/unit/prompts.test.ts`; document under "Slash-prompts".
- Removing or renaming either breaks `toolsListBaseline.test.ts`.

## Override or skip a generated tool

`src/codegen/curated-overrides.ts`: `SKIP_OPERATION_IDS` (replace by curated), `NAME_OVERRIDES` (keys must be real operationIds), `OPERATION_DESCRIPTION_HINTS`, `READISH_OPERATION_IDS` (reviewed, empty today). Regenerate and commit `src/tools/generated/index.ts` in the same change. Renaming a shipped tool breaks consumers and the baseline test; add rather than rename.

## Add or change an environment variable

1. `EnvSchema` in `src/config.ts` plus `ENV_VARS` metadata (compile error if missing) and `AppConfig` / `loadConfig` mapping ([Configuration](../architecture/configuration.md)).
2. `.env.example` (key set held equal by a unit test), README configuration table and MCPB notes (`tests/unit/mcpbManifest.test.ts`), and if it is user-visible in Claude Desktop, `mcpb/manifest.json` `user_config` + `mcp_config` env mapping.
3. If it is a Keychain candidate, `KEYCHAIN_KEYS` in `src/keychain.ts`.
4. Tests: `tests/unit/config.test.ts`, `configEnv.test.ts`; `tests/unit/cli.test.ts` for `--help` output.
5. Reads must go through `loadConfig()` (never `process.env` in tools) so empty-string and flag semantics stay uniform.

## Change guard, org scope or HTTP checks

Policy comes from one function (`guardPolicy`) and renders to server instructions and start-up warnings; change the policy, then run `destructiveGuard.test.ts`, `tests/security/destructiveGuard.matrix.test.ts`, `orgAllowlist.test.ts`, `rawRequestSweep.test.ts`. HTTP pipeline order (rate limit -> Host/Origin -> bearer -> body) is part of the security contract: `tests/integration/httpTransport.test.ts`, `httpEntry.test.ts`, `httpModernProtocol.test.ts` ([Runtime and transports](../architecture/runtime-and-transports.md)). Escalate to `bun run test:coverage` if you touch files with per-file floors (`destructiveGuard.ts`, `orgScope.ts`, `raw.ts`, `http.ts`, `pii.ts`, `retry.ts`).

## Change a payload builder

See [Script execution](script-execution.md): update `src/payloads/*`, its `*.payload.test.ts`, and note that live behaviour can only be confirmed manually against a sacrificial endpoint.

## Scope boundaries

Do not hand-edit `src/tools/generated/index.ts`, `src/spec/generated.ts`, `docs/permissions.md`, `docs/_coverage_table.md`, `tests/fixtures/tools-list.baseline.json` (v0.5.0 snapshot; only regenerated deliberately with `scripts/tools-list-snapshot.mjs`), or `dist/`. Do not add `console.log` (stdout is MCP) - use `log`. Do not reference review finding ids in code or docs (`tests/unit/noReviewReferences.test.ts`).
