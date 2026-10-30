# MCPB bundle

This directory packages `action1-mcp-server` as an
[MCP Bundle](https://github.com/anthropics/mcpb) for installation into
Claude Desktop. This is an unofficial project, not affiliated with or
endorsed by Action1. The directory holds the bundle manifest
(`manifest.json`) and this README; everything else is produced by the
build.

## Build

```bash
bun install --frozen-lockfile
bun run build:mcpb       # runs scripts/build-mcpb.sh; writes dist/action1-mcp-<version>.mcpb
```

On Windows, run these commands in Git Bash (part of Git for Windows):
the build script needs bash.

`scripts/build-mcpb.sh` is the only supported way to build the bundle. It

- wipes `dist/` and recompiles, so a bundle never contains code from an
  earlier build;
- stages the bundle under `build/mcpb/` (git-ignored): this manifest and
  README, `LICENSE`, `NOTICE`, and the compiled server without the code
  generator;
- installs the runtime dependencies with
  `bun install --frozen-lockfile --production --ignore-scripts` from the
  committed `bun.lock`, so the bundle carries exactly the tested versions;
- writes `THIRD_PARTY_NOTICES.md` with the license of every bundled
  package and fails if one is not on the allowlist in
  `scripts/third-party-notices.mjs`;
- validates the manifest and packs with the pinned `@anthropic-ai/mcpb`
  devDependency, then rewrites the archive reproducibly
  (`scripts/reproducible-zip.mjs`: sorted entries, modes 0644/0755, one
  timestamp from `SOURCE_DATE_EPOCH`, by default the commit time), so
  every build of a commit has the same SHA-256.

`bun run test:e2e` runs the build and checks the result (contents,
lockfile versions, stdio start of the bundled server, a
second build with the same checksums). Do not copy the
repository's `node_modules` into a bundle by hand: it contains the
development dependencies.

The bundle contains no Node.js runtime (Claude Desktop provides one) and
no credentials.

## Install

Double-click the `.mcpb` on macOS or Windows with Claude Desktop
installed. Claude Desktop asks for the `user_config` fields: Action1 base
URL, organization ID, client ID, client secret and the allow-destructive
checkbox. The client ID and secret are marked sensitive, and Claude Desktop
stores them in its secure storage (the macOS Keychain on a Mac).

## Distribute

This fork publishes no bundle: there is no GitHub release, no
`SHA256SUMS` file and no MCP Registry entry. Build the `.mcpb` from a
checkout of <https://github.com/psd401/action1-mcp>. For MCP hosts
other than Claude Desktop, build from source and run
`node /absolute/path/to/action1-mcp/dist/index.js` (see
`docs/INSTALLATION.md`, Option C).

To check that a bundle someone hands you matches a commit, check out
that commit and run
`bun install --frozen-lockfile && bun run build:mcpb` with Node.js 24.
Then compare the SHA-256 of `dist/action1-mcp-<version>.mcpb` with the
file you received. The CI job `mcpb-reproducible` holds the build to one
checksum per commit.

## Notes

- `mcp_config` uses `${user_config.*}` substitutions, so the values are
  passed as environment variables at start and never enter the bundle.
- `allow_destructive` is a checkbox (`boolean`), off by default. Claude
  Desktop passes it to the server as the string `"true"` or `"false"`; a
  value stored by an older bundle, where the field was a string, is read
  the same way. Even when on, every destructive call still needs
  `confirm: "YES"` and `dry_run: false`.
- Settings that the manifest does not expose keep their defaults in the
  bundle, so account operations are always refused:
  `ACTION1_ALLOW_ACCOUNT_OPS`, `ACTION1_ALLOW_ENTERPRISE_OPS`,
  `ACTION1_ALLOWED_ORG_IDS`, `ACTION1_TOOLSETS`, `ACTION1_REDACT_PII`,
  `ACTION1_DESTRUCTIVE_AUTO_CONFIRM`, `ACTION1_DEFAULT_TIMEOUT_MINUTES`,
  `ACTION1_DEFAULT_RETRY_MINUTES`, `ACTION1_LAST_SEEN_STALE_MINUTES`,
  `ACTION1_REQUEST_TIMEOUT_MS`, `ACTION1_TOKEN_TIMEOUT_MS`,
  `ACTION1_KEYCHAIN` and `ACTION1_LOG_LEVEL`. The bundle gets the
  credential from the wizard, so it leaves `ACTION1_KEYCHAIN` off. The HTTP settings do not apply, because the bundle
  runs over stdio. `tests/unit/mcpbManifest.test.ts` holds this list to
  `ENV_VARS` in `src/config.ts`, the source of `--help`.
- `manifest.json` `version` must equal `package.json` `version`;
  `tests/unit/serverContract.test.ts` checks it.
- The built `.mcpb` and the `build/` staging directory are not checked
  into git.
