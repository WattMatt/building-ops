#!/usr/bin/env bash
#
# Repeatable schema-STRUCTURE parity check between the original and clone
# Supabase projects (tables, columns, constraints, indexes, RLS policies,
# functions, triggers — everything in a schema-only dump; NO data).
#
# One-time setup:
#   cp scripts/.schema-sync.env.example scripts/.schema-sync.env
#   # then paste the two "Session pooler" connection URIs (with passwords) in it
#   # (scripts/.schema-sync.env is gitignored — passwords never leave your machine)
#
# Run anytime:
#   bash scripts/schema-parity.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HERE/.schema-sync.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ Missing $ENV_FILE"
  echo "  Run: cp scripts/.schema-sync.env.example scripts/.schema-sync.env"
  echo "  then fill in ORIGINAL_DB_URL and CLONE_DB_URL."
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
: "${ORIGINAL_DB_URL:?Set ORIGINAL_DB_URL in scripts/.schema-sync.env}"
: "${CLONE_DB_URL:?Set CLONE_DB_URL in scripts/.schema-sync.env}"

OUT="${TMPDIR:-/tmp}"
ORIG="$OUT/original_schema.sql"
CLONE="$OUT/clone_schema.sql"
DIFF="$OUT/schema_diff.txt"

echo "→ Dumping ORIGINAL structure…"
supabase db dump --db-url "$ORIGINAL_DB_URL" -f "$ORIG"
echo "→ Dumping CLONE structure…"
supabase db dump --db-url "$CLONE_DB_URL" -f "$CLONE"

echo
echo "=== Structural parity: original vs clone ==="
if diff -u "$ORIG" "$CLONE" > "$DIFF"; then
  echo "✅ IN SYNC — the clone's structure is an exact match of the original."
  rm -f "$DIFF"
else
  ADDED=$(grep -cE '^\+' "$DIFF" || true)
  REMOVED=$(grep -cE '^-' "$DIFF" || true)
  echo "⚠️  Differences found (~$REMOVED only-in-original, ~$ADDED only-in-clone lines)."
  echo "   Full diff written to: $DIFF"
  echo
  echo "   Top-level objects that differ:"
  grep -E '^[-+](CREATE|ALTER|DROP|COMMENT|GRANT)' "$DIFF" | sed 's/^/     /' | head -80 || true
  echo
  echo "   Files kept for review:"
  echo "     $ORIG"
  echo "     $CLONE"
  echo "     $DIFF"
fi
