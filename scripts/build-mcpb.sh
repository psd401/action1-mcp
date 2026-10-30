#!/usr/bin/env bash
# ABOUTME: Builds a deployable, bit-for-bit reproducible .mcpb bundle for Claude Desktop
# ABOUTME: from a clean compile and the runtime dependencies pinned in bun.lock.
#
# Usage:  bun run build:mcpb
#
# Output: dist/action1-mcp-<version>.mcpb
#
# Every run is a clean build: dist/ and the staging directory are wiped,
# TypeScript is compiled from scratch, and the bundle's runtime
# dependencies are installed with
# `bun install --frozen-lockfile --production --ignore-scripts` from the
# committed bun.lock, so the bundle contains exactly the
# dependency versions CI tested. The bundle also carries LICENSE, NOTICE
# (when present) and THIRD_PARTY_NOTICES.md for every bundled package.
# The MCPB CLI is the pinned devDependency @anthropic-ai/mcpb (run
# `bun install --frozen-lockfile` first).
#
# Reproducible: the packed archive is rewritten by
# scripts/reproducible-zip.mjs (sorted entries, modes 0644/0755, one
# timestamp). The timestamp is SOURCE_DATE_EPOCH, by default the commit
# time of HEAD, so two builds of the same commit give the same SHA-256.
# The e2e suite checks this (tests/e2e/artifacts.test.ts).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
STAGE="build/mcpb"
OUT="dist/action1-mcp-${VERSION}.mcpb"
MCPB="node_modules/.bin/mcpb"

if [ -z "${SOURCE_DATE_EPOCH:-}" ]; then
  SOURCE_DATE_EPOCH="$(git log -1 --format=%ct 2>/dev/null || true)"
fi
if [ -z "$SOURCE_DATE_EPOCH" ]; then
  echo "error: not a git checkout; set SOURCE_DATE_EPOCH (unix seconds) for the bundle timestamps." >&2
  exit 1
fi
export SOURCE_DATE_EPOCH

if [ ! -x "$MCPB" ]; then
  echo "error: $MCPB not found. Run 'bun install --frozen-lockfile' first (the MCPB CLI is a pinned devDependency)." >&2
  exit 1
fi

# 1. Clean build: no leftovers from an earlier build or an earlier bundle.
node -e "for (const d of ['dist', 'build/mcpb']) require('fs').rmSync(d, { recursive: true, force: true })"
bun run build

# 2. Stage the bundle: manifest, docs, legal files, compiled server.
mkdir -p "$STAGE/server"
cp mcpb/manifest.json mcpb/README.md LICENSE "$STAGE/"
if [ -f NOTICE ]; then cp NOTICE "$STAGE/"; fi

# Compiled runtime only: no code generator (dev tooling), no type
# declarations, no source maps.
( cd dist && find . -type f -name '*.js' ! -path './codegen/*' -print ) | while read -r f; do
  mkdir -p "$STAGE/server/$(dirname "$f")"
  cp "dist/$f" "$STAGE/server/$f"
done

# package.json (version lookup at runtime, dependency spec) and the
# lockfile, so bun installs the tested tree. Lifecycle scripts are
# dropped; they are not needed inside the bundle.
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
delete pkg.scripts;
fs.writeFileSync('$STAGE/server/package.json', JSON.stringify(pkg, null, 2) + '\n');
"
cp bun.lock "$STAGE/server/bun.lock"

# 3. Runtime dependencies exactly as locked, without install scripts.
( cd "$STAGE/server" && bun install --frozen-lockfile --production --ignore-scripts --no-save --no-progress )
# The bundle has no dev dependencies, so its package.json lists none.
node -e "
const fs = require('fs');
const f = '$STAGE/server/package.json';
const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
delete pkg.devDependencies;
fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + '\\n');
"

rm -f "$STAGE/server/bun.lock"

# 4. Third-party license notices for every bundled package; fails on a
#    license outside the allowlist.
node scripts/third-party-notices.mjs "$STAGE/server" "$STAGE/THIRD_PARTY_NOTICES.md"

# 5. Validate and pack, then rewrite the archive reproducibly (mcpb pack
#    stamps the current time and keeps the file system order and modes).
"$MCPB" validate "$STAGE/manifest.json"
"$MCPB" pack "$STAGE" "$OUT"
node scripts/reproducible-zip.mjs "$OUT" "$STAGE"

echo
echo "Built $OUT (SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH)"
ls -lh "$OUT"
node -e "
const { createHash } = require('crypto');
const f = process.argv[1];
console.log('sha256 ' + createHash('sha256').update(require('fs').readFileSync(f)).digest('hex') + '  ' + f);
" "$OUT"
