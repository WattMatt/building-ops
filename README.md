# Building Ops — web app

Property and facilities management for building managers, administrators, and on-site staff. Web companion to the GMI Operations iOS app — both share the **GMI-ops** Supabase backend as the single source of truth.

**Production:** https://buildingops.app (Vercel, auto-deploys on push to `main`)

## Stack

- Vite + React + TypeScript
- shadcn/ui + Tailwind CSS
- Supabase (PostgreSQL + Auth + Storage + Edge Functions), project `qdzgkttiosahdfqresvz`

## Local development

```sh
npm i
npm run dev
```

Connection is env-driven (`.env` / Vercel env): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.

## Backend rules (shared schema — read before touching data shapes)

- The schema is managed from the iOS repo via `GMI/sql/*.sql` migrations — **never** `supabase db push` from here.
- Data-shape and storage-path conventions are pinned in `GMI/specs/SCHEMA_CONTRACT.md`; changes to those need both teams' ack first.
- `src/integrations/supabase/types.ts` is regenerated with `supabase gen types typescript --project-id qdzgkttiosahdfqresvz`.
- The private `tenant-documents` bucket is read via signed URLs (`src/integrations/supabase/storage.ts`) — never `getPublicUrl`.

## Edge functions

Live in `supabase/functions/`; deploy per-function:

```sh
supabase functions deploy <name> --project-ref qdzgkttiosahdfqresvz
```

Email goes out via Resend from `notifications@buildingops.app` (`RESEND_API_KEY` is a Supabase secret).
