---
type: Workflow
title: OpenAPI codegen and spec snapshot management
description: "How generated tools and spec-derived tables are produced from the vendored Action1 OpenAPI snapshot: generator inputs/outputs and abort conditions, naming, overrides, the spec contract, SHA pinning, drift detection and the refresh procedure."
tags: [codegen, openapi, spec, generated-tools, drift]
openwiki:
  roles: [workflow, architecture]
  change_kinds: [codegen, generated-artifacts, spec-refresh]
  source_paths: [src/codegen/generate.ts, src/codegen/naming.ts, src/codegen/curated-overrides.ts, src/codegen/zodEmit.ts, src/codegen/outputSchema.ts, src/codegen/specContract.ts, src/codegen/spec/openapi.json, src/codegen/spec/openapi.sha256, src/codegen/spec/SOURCE.md, src/codegen/spec/known-undocumented-endpoints.json, src/tools/generated/index.ts, src/spec/generated.ts, scripts/fetch-spec.mjs]
  symbols: [SKIP_OPERATION_IDS, READISH_OPERATION_IDS, NAME_OVERRIDES, OPERATION_DESCRIPTION_HINTS, deriveToolNames, extractCuratedToolNames, resolveContract, GENERATED_TOOL_MANIFEST, GENERATED_SKIPPED_OPERATIONS, SPEC_USAGE]
  test_paths: [tests/unit/specSha.test.ts, tests/unit/codegenGenerator.test.ts, tests/unit/naming.test.ts, tests/unit/curatedOverridesAssertion.test.ts, tests/unit/specContract.test.ts, tests/unit/curatedPaths.test.ts, tests/unit/fetchSpec.test.ts, tests/unit/outputSchemas.test.ts, tests/unit/paramZod.test.ts, tests/unit/generatedManifest.test.ts, tests/integration/generatedTools.test.ts, tests/unit/permissionsTable.test.ts, tests/unit/docsConsistency.test.ts]
  invariants: ["Never edit src/tools/generated/index.ts or src/spec/generated.ts by hand; regenerate with bun run codegen.", "Spec, openapi.sha256 and generated index.ts are committed together; CI regenerates and fails on any diff.", "Every POST/PUT/PATCH/DELETE operation becomes a destructive-guarded tool unless listed in READISH_OPERATION_IDS (empty).", "Operations the runtime cannot send correctly (non-JSON body, required headers) are emitted as tools that return an error."]
  validation_commands: ["bun run codegen && git diff --exit-code src/tools/generated src/spec/generated.ts", "bunx vitest run tests/unit/specSha.test.ts tests/integration/generatedTools.test.ts tests/unit/specContract.test.ts --reporter=dot"]
---

# OpenAPI codegen and spec snapshot management

ADR 0002 (`docs/adr/0002-hybrid-tools-from-vendored-spec.md`) explains why: the Action1 API has well over a hundred operations; plain CRUD is generated, quirky workflows are [curated](../domain/tool-surface.md). Action1 only ships its OpenAPI spec embedded in the Swagger UI bundle, so the project vendors a pinned snapshot and generates committed code from it, making spec updates reviewable diffs.

```mermaid
flowchart LR
  ui["Action1 Swagger UI bundle"] -->|"scripts/fetch-spec.mjs --fetch"| cand["openapi.candidate.json"]
  cand -->|"mv + shasum"| spec["src/codegen/spec/openapi.json + openapi.sha256"]
  spec --> gen["src/codegen/generate.ts"]
  ov["curated-overrides.ts skip, names, hints, readish"] --> gen
  cur["curated tool names scanned in src/tools (not generated/)"] --> gen
  con["specContract.ts field and enum paths"] --> gen
  gen --> idx["src/tools/generated/index.ts"]
  gen --> sg["src/spec/generated.ts"]
  spec --> docs["docs/permissions.md, docs/_coverage_table.md (scripts)"]
```

*Caption: generator inputs and committed outputs; `src/tools/generated/runtime.ts` is hand-written and untouched by codegen.*

## Generator contract (`src/codegen/generate.ts`)

- Run: `bun run codegen` (`tsx src/codegen/generate.ts`). Writes `src/tools/generated/index.ts` (one `registerTool` per operation, plus `GENERATED_TOOL_MANIFEST` and `GENERATED_SKIPPED_OPERATIONS`, used by [toolsets](../domain/tool-surface.md#toolsets-and-annotations) and the raw tool's org-path check) and `src/spec/generated.ts` (field names and enum values curated readers use, from paths in `specContract.ts`).
- Aborts without writing when: spec SHA differs from `openapi.sha256`; a `NAME_OVERRIDES` / `OPERATION_DESCRIPTION_HINTS` key is not an operationId; a `READISH_OPERATION_IDS` key is not a POST; a name cannot be shortened to the 64-character MCP limit; two tools collide; a `specContract.ts` path no longer resolves.
- Naming (`naming.ts`): verb-first `action1_<verb>_<resource>` derived from method+path with a 3-pass conflict resolver; namespace segments (`all`, `managed`, `custom`) are transparent. Curated names are collected by scanning every `.ts` under `src/tools/` except `generated/` for literal `registerTool("action1_...")` names (`extractCuratedToolNames`); a generated tool with the same name is dropped. `tests/integration/generatedTools.test.ts` cross-checks the scan against what the real server registers, so non-literal registrations fail the test instead of crashing startup with a duplicate name.
- Safety invariants: all mutating operations get `confirm`/`dry_run`/`destructiveHint`; `READISH_OPERATION_IDS` is a reviewed allowlist (no title heuristics); `SKIP_OPERATION_IDS` holds `oauth2_token` (handled by `TokenProvider`) and `endpoints_groups_groupId_contents_post` (replaced by curated group tools). Output schemas come from the 200 response (`outputSchema.ts`: list / single / ok-status); request bodies and params become Zod source (`zodEmit.ts`).

## Spec contract and undocumented endpoints

- `src/spec/entities.ts` registers every spec field/enum it reads in `SPEC_USAGE`; `tests/unit/specContract.test.ts` verifies each against `components.schemas`, so drift fails CI instead of silently mis-reading records. Add a new field via `specContract.ts`, run codegen, then use it in a reader.
- Curated tools that call paths absent from the spec (`/policies/instances/{orgId}`, per-endpoint `.../vulnerabilities`) must be listed in `known-undocumented-endpoints.json`; `tests/unit/curatedPaths.test.ts` fails on unlisted undocumented paths and on listed paths that become documented or unused. Details: `docs/GOTCHAS.md`.

## Drift detection and refresh

- `bun run spec:check` (`scripts/fetch-spec.mjs --check`): exit 0 unchanged, 1 drift (with added/removed/changed summary), 2 fetch/parse failure. `.github/workflows/spec-drift.yml` runs it weekly; a red run means refresh.
- Refresh (full procedure in `src/codegen/spec/SOURCE.md`): `bun run spec:fetch` -> move candidate over `openapi.json` -> write new SHA to `openapi.sha256` (lowercase hex, no newline) -> `bun run codegen` -> fix stale overrides/collisions -> `bun run test` -> update SOURCE.md stats -> commit spec, SHA and generated files together. Never update the SHA without regenerating. Also regenerate derived docs: `node scripts/generate-permissions-table.mjs` and `node scripts/regenerate-coverage-table.mjs` (`--check` variants run inside `permissionsTable.test.ts` / `docsConsistency.test.ts`).
- The spec is Action1's work and is not under the project's MIT licence (`NOTICE`).
- Spec refreshes ripple outward: PII keys (`tests/security/pii.test.ts` derives them from the spec), the v0.5.0 baseline (additions pass, removals fail), `docs/api-coverage.md`.

## Change guidance

| Intent | Edit | Check |
|---|---|---|
| Rename/skip/override one generated tool | `src/codegen/curated-overrides.ts` (comment why) -> `bun run codegen` | `tests/unit/curatedOverridesAssertion.test.ts`, `generatedTools.test.ts`, baseline test (renames break consumers) |
| Change how every generated tool behaves | `src/tools/generated/runtime.ts` (hand-written) | `tests/unit/runtime.test.ts`, `tests/unit/generatedMutationRetry.test.ts`, `generatedTools.test.ts` |
| Change emitted code shape | `generate.ts` / `zodEmit.ts` / `outputSchema.ts` -> regenerate | `tests/unit/codegenGenerator.test.ts`, `paramZod.test.ts`, `outputSchemas.test.ts`, `specSha.test.ts` |
| Adopt a new spec | procedure above | the CI `codegen-roundtrip` job equivalent: `bun run codegen` then `git diff --exit-code` |

Escalate to the full `bun run test` only for spec refreshes or generator changes, because they change many tools at once. `bun run build:mcpb` is not needed: the codegen directory is excluded from the shipped package (`package.json` `files`).
