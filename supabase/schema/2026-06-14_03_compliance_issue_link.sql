-- H3 (battle-test 2026-06-14): link an OHS non-compliance response to the issue
-- logged from the OHS Compliance tab's "Log as issue" action. Enables resolution
-- tracking and prevents duplicate issues on reload (the UI now reads this back and
-- shows "Logged" instead of re-offering the button).
-- Additive + nullable + idempotent. Safe on prod (no data rewrite).
ALTER TABLE public.compliance_responses
  ADD COLUMN IF NOT EXISTS issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_compliance_responses_issue_id
  ON public.compliance_responses(issue_id);
