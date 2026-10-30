---
type: Architecture
title: Configuration and credentials
description: The single validated environment schema (EnvSchema/loadConfig), the ENV_VARS documentation table that drives --help and .env.example, org resolution, and the optional macOS Keychain credential source.
tags: [configuration, environment, keychain, zod]
openwiki:
  roles: [architecture, operations]
  change_kinds: [configuration, public-api]
  source_paths: [src/config.ts, src/keychain.ts, .env.example, scripts/keychain-store.sh, mcpb/manifest.json]
  symbols: [EnvSchema, ENV_VARS, loadConfig, resetConfigCache, resolveOrgId, assertOrgAllowed, ConfigError, parseTrustProxy, readKeychainItem, KEYCHAIN_KEYS]
  test_paths: [tests/unit/config.test.ts, tests/unit/configEnv.test.ts, tests/unit/keychain.test.ts, tests/unit/keychainStore.test.ts, tests/unit/mcpbManifest.test.ts]
  invariants: ["Every env key must be documented in ENV_VARS (compile-time) and in .env.example (unit test).", "Empty env values count as unset.", "Flag values must be true/1/yes or false/0/no; anything else aborts startup."]
  validation_commands: ["bunx vitest run tests/unit/config.test.ts tests/unit/configEnv.test.ts tests/unit/keychain.test.ts --reporter=dot"]
---

# Configuration and credentials

All runtime settings come from environment variables parsed **once** by `loadConfig()` in `src/config.ts` and cached; every reader (guard, org scope, PII masking, HTTP app, client) goes through it so they all see the same trimmed, case-folded values. Tests call `resetConfigCache()` after changing `process.env`.

## How the schema works

- `EnvSchema` (zod) validates each key; `readEnv` trims values and **drops empty strings** (a copied `.env.example` with blank keys means "use the default").
- Failures raise `ConfigError` with one issue line per problem, worded so the secret redactor leaves them alone. `src/index.ts` prints them and exits 1.
- `ENV_VARS: Record<EnvKey, {group, summary}>` is typed against the schema keys, so a new key without documentation does not compile. `--help` renders from it; a unit test holds `.env.example` and the README configuration table (via `tests/unit/mcpbManifest.test.ts`) to the same key set.
- Flags use `flagEnv`: `true/1/yes` or `false/0/no`, case-insensitive; a typo aborts startup rather than silently disabling a safety switch.

## Setting groups (see `ENV_VARS` for exact ranges/defaults)

| Group | Keys | Notes |
|---|---|---|
| Required | `ACTION1_BASE_URL`, `ACTION1_CLIENT_ID`, `ACTION1_CLIENT_SECRET` | Base URL must be `https://` and not a metadata host (169.254.169.254, metadata.google.internal); trailing slashes stripped. |
| Recommended | `ACTION1_ORG_ID`, `ACTION1_ALLOWED_ORG_IDS` | `ACTION1_ORG_ID` must itself be on the allowlist if one is set. |
| Safety switches | `ACTION1_ALLOW_DESTRUCTIVE`, `ACTION1_ALLOW_ACCOUNT_OPS`, `ACTION1_ALLOW_ENTERPRISE_OPS`, `ACTION1_DESTRUCTIVE_AUTO_CONFIRM`, `ACTION1_TOOLSETS`, `ACTION1_REDACT_PII` | Semantics in [Destructive guard](../security/destructive-guard.md) and [Redaction and audit](../security/redaction-and-audit.md). |
| Behaviour | `ACTION1_DEFAULT_TIMEOUT_MINUTES` (10), `ACTION1_DEFAULT_RETRY_MINUTES` (1440), `ACTION1_LAST_SEEN_STALE_MINUTES` (10), `ACTION1_REQUEST_TIMEOUT_MS` (60 000), `ACTION1_TOKEN_TIMEOUT_MS` (15 000), `ACTION1_LOG_LEVEL` | Minutes are kept as digit strings because payload builders pass them verbatim. |
| HTTP only | `PORT`, `HOST`, `MCP_HTTP_TOKEN` (>= 16 chars), `MCP_HTTP_ALLOW_NO_AUTH`, `MCP_HTTP_ALLOWED_HOSTS`, `MCP_HTTP_ALLOWED_ORIGINS`, `TRUST_PROXY` | Enforcement in [Runtime and transports](runtime-and-transports.md). |
| Credential source | `ACTION1_KEYCHAIN` | macOS only. |

`AppConfig` is the typed output. Note `ACTION1_LOG_LEVEL` is also read directly by `src/utils/logger.ts` at import time.

## Org resolution

`resolveOrgId(override, cfg)` returns the `org_id` argument or `ACTION1_ORG_ID`, throws when neither exists, calls `assertOrgAllowed` (allowlist, case-insensitive) and records the org on the current request context for audit lines. Tools must go through it rather than reading `defaultOrgId`. Org ids inside bodies and raw paths are checked separately by `src/tools/orgScope.ts` ([Destructive guard](../security/destructive-guard.md#organization-scope)).

## macOS Keychain source (`src/keychain.ts`)

With `ACTION1_KEYCHAIN=true`, `fillFromKeychain` copies any of `KEYCHAIN_KEYS` (`ACTION1_BASE_URL`, `ACTION1_ORG_ID`, `ACTION1_CLIENT_ID`, `ACTION1_CLIENT_SECRET`, `MCP_HTTP_TOKEN`) that the environment leaves unset from the login Keychain by shelling out to `/usr/bin/security find-generic-password` (service = env var name, account = login user, 10 s timeout). Properties to preserve:

- Environment wins over Keychain; the secret only travels through the child's stdout pipe, and `KeychainError` messages never include child output.
- Exit 44 means "not found" (skipped); other failures abort after one error (a locked Keychain fails every key the same way).
- On non-darwin the flag yields a config issue instead of silently falling back.
- `scripts/keychain-store.sh` stores items with `read -rs` so values never hit argv, files or history. Tests inject `KeychainOptions` (`file`, `securityPath`, `platform`).

This path exists because the PSD fork forbids plaintext `.env` credentials; `CLAUDE.md` and `docs/INSTALLATION.md` describe the user-facing flow, and the MCPB bundle instead stores credentials through Claude Desktop's own secure storage (`mcpb/manifest.json` `user_config`, see [Build, bundle and CI](../delivery/build-release-and-ci.md)).

## Change guidance

- **Add an env setting**: add to `EnvSchema`, `ENV_VARS`, `AppConfig` and the `loadConfig` mapping; add to `.env.example`; if it should be a wizard field add `user_config` + `mcp_config.env` in `mcpb/manifest.json` and README's table; test in `tests/unit/config.test.ts`/`configEnv.test.ts`.
- **Stale config pitfall**: a value read before `loadConfig()` (like the logger's level) will not follow later changes.
- Never log or echo `clientSecret`; error helpers rely on key-name and pattern redaction ([Redaction and audit](../security/redaction-and-audit.md)).
- Checks beyond the focused tests above are normally unnecessary; run `bun run check` only before a PR.
