#!/bin/bash
#
# Inspector smoke-test for the curated and generated tool surface.
#
# Why this exists: TypeScript can't catch structured-content / outputSchema
# mismatches - both sides are `Record<string, unknown>`-compatible, so an
# output schema that rejects a real response (for example a counter
# response against a too-narrow object shape, or a required
# `has_more`/`next_cursor` on a non-cursor call) only fails at runtime.
# This script runs each read-only tool against a real Action1
# instance via `@modelcontextprotocol/inspector --cli` and flags any
# `Output validation error` / `Structured content does not match` /
# crash response. Run it locally before tagging a release; unit tests
# are not enough.
#
# Usage:
#   ./scripts/inspector-smoke.sh
#
# Requires:
#   - macOS, with ACTION1_BASE_URL / ACTION1_CLIENT_ID /
#     ACTION1_CLIENT_SECRET / ACTION1_ORG_ID in the login Keychain
#     (store them with scripts/keychain-store.sh)
#   - `dist/index.js` (run `bun run build` first)
#
# Exit codes:
#   0 - every tool either passed schema validation or returned a
#       non-schema error (permissions / args). Schema is healthy.
#   1 - one or more tools returned a schema-validation failure or
#       crashed during register/call. Investigate the offending tool.

set +e
cd "$(dirname "$0")/.."

if [ ! -f "dist/index.js" ]; then
  echo "dist/index.js missing. Run 'bun run build' first." >&2
  exit 2
fi
# Probe for the secret with find-generic-password without -w, so the value is never printed.
if ! /usr/bin/security find-generic-password -s ACTION1_CLIENT_SECRET -a "${USER:-$(id -un)}" >/dev/null 2>&1; then
  echo "ACTION1_CLIENT_SECRET missing from the Keychain. Run scripts/keychain-store.sh first." >&2
  exit 2
fi

# Read-only tools that work without endpoint-specific args, plus a
# few representative cursor-shape and single-object tools that have
# previously hit schema bugs.
declare -a TOOLS=(
  "action1_list_organizations"
  "action1_list_endpoints"
  "action1_endpoints_summary"
  "action1_search_endpoints query=foo"
  "action1_list_action_templates"
  "action1_list_recent_automations"
  "action1_automations_summary"
  "action1_recurring_schedules"
  "action1_get_me"
  "action1_list_reports"
  "action1_list_roles"
  "action1_list_endpoint_groups"
  "action1_list_endpoint_missing_updates endpoint_id=00000000-0000-0000-0000-000000000000"
  "action1_get_endpoint endpoint_id=00000000-0000-0000-0000-000000000000"
  "action1_get_action_template template_id=run_powershell"
  "action1_endpoint_groups_resolve query=foo"
  # Destructive tools: keep dry_run=true so even if the bogus UUID
  # accidentally matched a real endpoint we'd only get a preview.
  # confirm="YES" is still safe because dry_run wins in the guard.
  "action1_run_powershell endpoint_id=00000000-0000-0000-0000-000000000000 script_text=Get-Date dry_run=true confirm=YES"
  "action1_reboot_endpoint endpoint_id=00000000-0000-0000-0000-000000000000 dry_run=true confirm=YES"
)

PASS=0
SCHEMA_FAIL=0
CRASH=0
NON_SCHEMA=0
declare -a FAILED=()

for spec in "${TOOLS[@]}"; do
  read -ra parts <<<"$spec"
  name="${parts[0]}"
  args=()
  for p in "${parts[@]:1}"; do
    args+=("--tool-arg" "$p")
  done
  result=$(bunx @modelcontextprotocol/inspector@2.12.0 --cli -e ACTION1_KEYCHAIN=true node dist/index.js \
    --method tools/call --tool-name "$name" "${args[@]}" 2>&1)
  if echo "$result" | grep -qE 'Output validation error|Structured content does not match'; then
    echo "[SCHEMA-FAIL] $name"
    SCHEMA_FAIL=$((SCHEMA_FAIL+1))
    FAILED+=("$name (schema)")
  elif echo "$result" | grep -qE "Cannot read properties|TypeError"; then
    echo "[CRASH] $name"
    CRASH=$((CRASH+1))
    FAILED+=("$name (crash)")
  elif echo "$result" | grep -qE 'Tool .* not found'; then
    echo "[404] $name (typo in this script - fix the tool name)"
    FAILED+=("$name (404)")
  elif echo "$result" | grep -qE '"isError":\s*true'; then
    echo "[non-schema] $name (likely permissions / args - schema is healthy)"
    NON_SCHEMA=$((NON_SCHEMA+1))
  else
    echo "[OK] $name"
    PASS=$((PASS+1))
  fi
done

echo ""
echo "Summary: ok=$PASS  non-schema=$NON_SCHEMA  schema-fail=$SCHEMA_FAIL  crash=$CRASH"
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "Failed tools:"
  printf '  %s\n' "${FAILED[@]}"
  exit 1
fi
exit 0
