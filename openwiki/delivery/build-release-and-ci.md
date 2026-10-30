---
type: Delivery Guide
title: Build, MCPB bundle, CI and fork policy
description: "How action1-mcp is built and verified: tsc build, the reproducible MCPB bundle for Claude Desktop, the CI job matrix and what each job protects, PSD401 reusable workflows, spec-drift and OpenWiki workflows, and the PSD fork rules (bun, no publishing, pinned actions)."
tags: [ci, build, mcpb, bun, release, supply-chain]
openwiki:
  roles: [delivery, operations]
  change_kinds: [build, packaging, ci, supply-chain]
  source_paths: [package.json, scripts/build-mcpb.sh, scripts/reproducible-zip.mjs, scripts/third-party-notices.mjs, mcpb/manifest.json, .github/workflows/ci.yml, .github/workflows/psd-ci.yml, .github/workflows/spec-drift.yml, .github/workflows/openwiki-update.yml, server.json, docs/maintainers/repo-settings.md, vitest.config.ts, vitest.e2e.config.ts]
  test_paths: [tests/unit/releaseChain.test.ts, tests/unit/psdFork.test.ts, tests/unit/mcpbManifest.test.ts, tests/unit/reproducibleZip.test.ts, tests/unit/thirdPartyNotices.test.ts, tests/e2e/artifacts.test.ts, tests/integration/binSymlink.test.ts]
  invariants: ["bun is the package manager; no npm/npx in scripts or workflows and no package-lock.json.", "package.json is private and no workflow publishes a package, release or registry entry.", "Every workflow action is pinned to a full commit SHA and every job with steps has a timeout.", "Two MCPB builds of the same commit are byte-identical (SOURCE_DATE_EPOCH = HEAD commit time).", "Every ci.yml job is listed as a required check in docs/maintainers/repo-settings.md."]
  validation_commands: ["bunx vitest run tests/unit/releaseChain.test.ts tests/unit/psdFork.test.ts tests/unit/mcpbManifest.test.ts --reporter=dot"]
---

# Build, MCPB bundle, CI and fork policy

This repository is Peninsula School District's fork (`psd401/action1-mcp`) of `mguttmann/action1-mcp`. It builds with bun, runs on Node 22.12+, and **publishes nothing** (see "Unreleased (psd401 fork)" in `CHANGELOG.md`). Several upstream artifacts remain as inert metadata: `server.json` (identity only, no packages), `glama.json`, `mcpName` in `package.json`; `tests/unit/releaseChain.test.ts` pins that no workflow publishes and that `server.json` lists no installable package. Documentation tells people to build from a checkout, not to use the upstream npm package or releases (`CLAUDE.md`, `tests/unit/releaseChain.test.ts` "npm distribution in the docs").

## Build outputs

| Command | Produces | Notes |
|---|---|---|
| `bun run build` | `dist/` via `tsc` | `bin` is `dist/index.js`; `files` excludes `dist/codegen`, `.mcpb`, SBOMs. `bun run typecheck` / `typecheck:tests` are the no-emit checks |
| `bun run build:mcpb` | `dist/action1-mcp-<version>.mcpb` | `scripts/build-mcpb.sh`: wipe, clean compile, stage manifest + compiled JS (no codegen dir, no declarations, no source maps), install runtime deps with `bun install --frozen-lockfile --production --ignore-scripts`, add `THIRD_PARTY_NOTICES.md`, pack with the pinned `@anthropic-ai/mcpb`, then rewrite the zip deterministically via `scripts/reproducible-zip.mjs` |
| `bun run check` | lint + typecheck + test typecheck + format check + tests | pre-PR gate; ESLint needs Node 22.13+ |

`mcpb/manifest.json` is the Claude Desktop contract: `user_config` fields (base URL, org id, client id/secret as sensitive, destructive switch, ...) mapped to env vars in `mcp_config`; `tests/unit/mcpbManifest.test.ts` requires every mapped env var to be a known `ENV_VARS` key defined from a wizard field, switches to be booleans, and README/MCPB notes to follow [`ENV_VARS`](../architecture/configuration.md). Install flow for an agent doing setup is in `CLAUDE.md`.

## CI map (`.github/workflows/ci.yml`)

| Job | Protects | Run locally when |
|---|---|---|
| `test (22/24/26)` | lint, typecheck, tests, build on three Node lines | any source change (`bun run check`) |
| `node-floor` | build, tests and a server start on exactly Node 22.12 | using newer Node/stdlib APIs |
| `format` | Prettier on `src/**` and `tests/**` | `bun run format:check` |
| `coverage` | global and per-file floors in `vitest.config.ts` (guard, org scope, raw, http, pii, retry) | touching those files: `bun run test:coverage` |
| `audit` | `bun audit --audit-level=high` including dev deps | changing dependencies/overrides |
| `deploy-path` | docs/DEPLOYMENT.md production install: build, delete `node_modules`, production-only install, start | changing dependencies or runtime files |
| `mcpb-reproducible` | two bundle builds in separate checkouts compare SHA-256 | changing the build script or manifest |
| `codegen-roundtrip` | `bun run codegen` leaves no diff | any generator/spec change ([Codegen and spec](../workflows/codegen-and-spec.md)) |
| `e2e (22/24)` | `tests/e2e/artifacts.test.ts`: builds the bundle, checks contents against `bun.lock`, starts `dist/index.js` and the unpacked bundle over stdio with dummy credentials, runs a tool call against a local HTTPS stub, checks `--http` refuses without a token | packaging or entry-point changes: `bun run test:e2e` (needs registry access) |
| `cross-os` | bundle build and stdio start on Windows (Git Bash) and macOS | shell script changes (keep `*.sh` LF per `.gitattributes`) |
| `gitleaks` | history secret scan (`.gitleaks.toml`, includes a PSD401 student-account rule) | never in docs/tests: use placeholders |

PSD401 reusable workflows add `psd-ci`, `security-scan`, `claude-review`, `license-check`, all pinned to a SHA of `PSD401/.github`. Other workflows: `spec-drift.yml` (weekly `fetch-spec.mjs --check`), `openwiki-update.yml` (regenerates this wiki; ignores pushes touching only `openwiki/`). The `main` ruleset requires every CI job by name; adding a job to `ci.yml` without listing it in `docs/maintainers/repo-settings.md` fails `releaseChain.test.ts`.

## Supply-chain rules enforced by tests

`tests/unit/psdFork.test.ts` and `releaseChain.test.ts`: bun only, no npm/npx (not even in scripts or docs commands), actions pinned to full SHAs, job timeouts, OIDC only for PSD401 reusable workflows, MCP Inspector invocations pin a version (`inspector` script uses `@modelcontextprotocol/inspector@2.12.0` and `ACTION1_KEYCHAIN=true`). Dependency `overrides` (`tmp`, `node-forge`, `zod`) patch advisories in the MCPB CLI's tree.

## Change guidance

- Editing a workflow: keep actions SHA-pinned, add `timeout-minutes`, run the two policy tests above, and update `repo-settings.md` required checks for new `ci.yml` jobs.
- Editing `build-mcpb.sh`/`reproducible-zip.mjs`: `tests/unit/reproducibleZip.test.ts` is the cheap check; conditional expensive check is `bun run test:e2e` (builds twice, needs registry).
- Version bump: `package.json`, `mcpb/manifest.json` and `server.json` all carry the version; keep them in step (`tests/unit/releaseChain.test.ts` ties `server.json` to `package.json`; `src/version.ts` reads `package.json`).
- Runtime behaviour of the artifact (what `node dist/index.js` does) is documented in [Runtime and transports](../architecture/runtime-and-transports.md); live-tenant smoke checks are in [Test strategy](../testing/test-strategy.md).
