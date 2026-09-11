# Database schema snapshot (read-only mirror)

This directory is a **reviewable snapshot** of the SQL that defines this app's
database — tables, and critically the **row-level-security policies, triggers,
and `SECURITY DEFINER` helpers (`is_admin()`, `is_admin_or_manager()`,
`can_access_building()`, …) that are the real access-control boundary**.

## Why it exists

The app's role checks in React are cosmetic; RLS is what actually enforces who
can read and write each row (see `CONFORMANCE.md`, A10). Those policies are
authored in the separate **GMI SQL repo** (`../GMI/sql`) and applied to Supabase
from there. That meant the enforcement boundary could not be read or diffed in
*this* repo — a reviewer had no way to check that a UI gate is backed by a
matching policy. This snapshot closes that gap: policy changes now show up in
this repo's pull-request diffs.

## What it is NOT

- **Not applied by the Supabase CLI.** Migrations that the CLI applies live in
  `supabase/migrations/`. This is `supabase/schema/` on purpose — `supabase db
  push` ignores it, so nothing here is re-applied or conflicts with the GMI
  apply workflow.
- **Not the source of truth.** Edit policies in the GMI repo, apply them, then
  refresh this mirror. Never hand-edit files here.

## Refreshing

```bash
npm run schema:vendor
```

Copies `../GMI/sql/*.sql` here and records the GMI source commit in `.source`.
Override the source path with `GMI_SQL_DIR=/path/to/GMI/sql` if your checkout
differs. Commit the refreshed snapshot alongside the change that motivated it.

`.source` records which GMI commit this snapshot was taken from, so drift
between the mirror and canonical is visible.

## Verifying enforcement, not just reading it

Reading a policy is not proof it is deployed. The `Backend smoke (RLS matrix)`
CI workflow runs `scripts/rls-smoke.mjs` against a live staging project to prove
the matrix actually holds, and `scripts/schema-parity-check.mjs` compares the
app's schema view against the live database.
