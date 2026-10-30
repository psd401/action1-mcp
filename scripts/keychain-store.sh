#!/usr/bin/env bash
# ABOUTME: Stores Action1 MCP credentials in the macOS login Keychain, one item per env var name.
# ABOUTME: Reads each value with read -rs from a terminal, so no value reaches argv, a file or history.
set -euo pipefail

ALLOWED=(ACTION1_BASE_URL ACTION1_ORG_ID ACTION1_CLIENT_ID ACTION1_CLIENT_SECRET MCP_HTTP_TOKEN)
DEFAULTS=(ACTION1_BASE_URL ACTION1_ORG_ID ACTION1_CLIENT_ID ACTION1_CLIENT_SECRET)

usage() {
  echo "Usage: scripts/keychain-store.sh [--keychain PATH] [NAME ...]" >&2
  echo "NAME is one of: ${ALLOWED[*]} (default: ${DEFAULTS[*]})" >&2
}

keychain=""
names=()
while [ $# -gt 0 ]; do
  case "$1" in
    --keychain)
      [ $# -ge 2 ] || { usage; exit 2; }
      keychain="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      if [[ " ${ALLOWED[*]} " != *" $1 "* ]]; then
        echo "Unknown name: $1" >&2
        usage
        exit 2
      fi
      names+=("$1")
      shift
      ;;
  esac
done
[ ${#names[@]} -gt 0 ] || names=("${DEFAULTS[@]}")

if [ "$(uname -s)" != "Darwin" ]; then
  echo "The macOS Keychain is only available on macOS. See docs/DEPLOYMENT.md for Linux." >&2
  exit 1
fi
if [ ! -t 0 ]; then
  echo "Run this script in a terminal: it reads each value with a hidden prompt." >&2
  exit 1
fi

account="${USER:-$(id -un)}"

# Quote a value for one `security -i` command line.
quote() {
  local v="${1//\\/\\\\}"
  printf '"%s"' "${v//\"/\\\"}"
}

# Read every value first, so an empty answer stores nothing.
values=()
for name in "${names[@]}"; do
  printf '%s: ' "$name" >&2
  if ! IFS= read -rs value; then
    printf '\n' >&2
    echo "No input for $name. Nothing was stored." >&2
    exit 1
  fi
  printf '\n' >&2
  if [ -z "${value//[[:space:]]/}" ]; then
    echo "Empty value for $name. Nothing was stored." >&2
    exit 1
  fi
  values+=("$value")
done

target=""
[ -z "$keychain" ] || target=" $(quote "$keychain")"

# printf is a shell builtin, so the values go to security over a pipe and never appear in argv.
for i in "${!names[@]}"; do
  printf 'add-generic-password -U -s %s -a %s -w %s%s\n' \
    "${names[$i]}" "$(quote "$account")" "$(quote "${values[$i]}")" "$target"
done | /usr/bin/security -i

# security -i does not report failed commands in its exit status, so check each item.
failed=0
for name in "${names[@]}"; do
  args=(find-generic-password -s "$name" -a "$account")
  [ -z "$keychain" ] || args+=("$keychain")
  if /usr/bin/security "${args[@]}" >/dev/null 2>&1; then
    echo "Stored $name for account $account." >&2
  else
    echo "Could not store $name." >&2
    failed=1
  fi
done
exit "$failed"
