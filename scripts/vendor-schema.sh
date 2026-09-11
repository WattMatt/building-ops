#!/usr/bin/env bash
# Refresh the in-repo schema snapshot (supabase/schema/) from the canonical GMI
# SQL repo. The snapshot exists so the RLS policies, triggers and SECURITY
# DEFINER helpers that ARE the access boundary are readable and diffable in this
# repo's PRs — it is NOT applied by the Supabase CLI (that is supabase/migrations).
#
# Canonical source stays in the GMI repo. Edit policies there, apply them, then
# run this to update the mirror:  npm run schema:vendor
#
# Override the source location with GMI_SQL_DIR=/path/to/GMI/sql if the sibling
# default does not match your checkout.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${GMI_SQL_DIR:-$REPO_ROOT/../GMI/sql}"
DEST="$REPO_ROOT/supabase/schema"

if [ ! -d "$SRC" ]; then
  echo "error: GMI SQL source not found at '$SRC'." >&2
  echo "       Set GMI_SQL_DIR to the GMI repo's sql/ directory and re-run." >&2
  exit 1
fi

mkdir -p "$DEST"
# Remove stale .sql first so deletions in GMI propagate (keeps .source/README).
find "$DEST" -maxdepth 1 -name '*.sql' -delete
cp "$SRC"/*.sql "$DEST"/

GMI_SHA="$(git -C "$SRC/.." rev-parse HEAD 2>/dev/null || echo unknown)"
GMI_DATE="$(git -C "$SRC/.." show -s --format=%ci HEAD 2>/dev/null || echo unknown)"
COUNT="$(find "$DEST" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"

cat > "$DEST/.source" <<EOF
source_repo: GMI (../GMI/sql)
source_commit: $GMI_SHA
source_commit_date: $GMI_DATE
vendored_files: $COUNT
note: read-only mirror — edit policies in the GMI repo, then run \`npm run schema:vendor\`
EOF

echo "Vendored $COUNT SQL files from GMI@$GMI_SHA into supabase/schema/."
echo "Review the diff (git status) and commit it with the change that motivated it."
