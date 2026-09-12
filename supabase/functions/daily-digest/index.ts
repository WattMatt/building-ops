// Opt-in daily digest: one email per person who set `profiles.daily_digest`, summarising the
// tasks they owe (overdue + due today), the issues assigned to them, for admins and managers
// the portfolio's expiry counts (expiring_items(90), R4a §5.6) and the portfolio's coverage
// gaps (`portfolio_coverage()`, S1 §4.4), and how much is unread in their inbox.
// Cron-triggered (pg_cron -> pg_net), so it is guarded by a shared secret rather
// than a user JWT — the same shape as `signoff-reminders`.
//
// The same run also raises one `task_due_today` notification (inbox row + push, never an email
// by rule) per person who has a live push device and `task_reminders` on — this is the only
// place that kind is written. It runs before the email pass and is idempotent per day, so a
// re-run of the cron never pushes twice.
//
// All the shaping lives in `../_shared/digest.ts` so it can be unit-tested from vitest
// (src/lib/digest.test.ts); this file holds only the guard, the queries and the rendering.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { escapeText, loadBranding, renderEmail } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { APP_URL, createNotifications, senderName, sendEmail } from "../_shared/notify.ts";
import {
  composeDigest,
  coverageSummary,
  dueTodayPush,
  type CoverageRow,
  type CoverageSummary,
  type DigestIssue,
  type DigestSection,
  type DigestTask,
  type ExpiryBuckets,
} from "../_shared/digest.ts";
import { countBuckets } from "../_shared/expiry.ts";

const DIGEST_SECRET = Deno.env.get("DAILY_DIGEST_SECRET");

/** Today in the operating timezone as `YYYY-MM-DD` ('en-CA' formats exactly that way). */
function todayInJohannesburg(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Midnight at the start of `today` (a `YYYY-MM-DD` from todayInJohannesburg) as an ISO instant,
 * for the "already notified today" check. South Africa has no daylight saving, so the offset is
 * a constant +02:00 rather than a timezone lookup.
 */
function startOfDayJohannesburgIso(today: string): string {
  return new Date(`${today}T00:00:00+02:00`).toISOString();
}

/** A push subscription that has failed for this long is dead; the device would re-subscribe. */
const FAILED_SUBSCRIPTION_TTL_DAYS = 30;

/** Sections as `<h3>` + `<ul>` blocks. Every dynamic value goes through `escapeText`. */
function renderSections(sections: DigestSection[]): string {
  return sections
    .map((s) => {
      const heading = `<h3 style="margin:20px 0 8px;font-size:15px;font-weight:700;color:#111827;">${escapeText(s.heading)}</h3>`;
      if (!s.lines.length) return heading;
      const items = s.lines
        .map((l) => `<li style="margin:0 0 4px;">${escapeText(l)}</li>`)
        .join("");
      return `${heading}<ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6;color:#374151;">${items}</ul>`;
    })
    .join("");
}

serve(async (req: Request): Promise<Response> => {
  // The shared CORS policy (allow-listed origins, never `*`) plus the cron secret header.
  const cors = corsHeaders(req, ["x-digest-secret"]);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...cors },
    });

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // Shared-secret guard — this function is cron-triggered, not user-facing.
  if (!DIGEST_SECRET || req.headers.get("x-digest-secret") !== DIGEST_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const today = todayInJohannesburg();
    const branding = await loadBranding(supabase);
    const from = `${senderName(branding.appName)} <notifications@buildingops.app>`;

    const { data: recipients, error: profErr } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .eq("daily_digest", true)
      .not("deactivated", "is", true)
      .not("email", "is", null)
      // "Turn this off to stop every email; the inbox still updates." (My Profile →
      // Notifications) — the digest is an email, so the master switch has to silence it.
      // Null means opted in, matching shouldEmail in _shared/notifyRules.ts.
      .not("email_notifications", "is", false);
    if (profErr) throw new Error(`Could not read digest recipients: ${profErr.message}`);

    // Building names are hydrated from one read of the (small, org-wide) buildings table
    // rather than a join per user.
    const { data: buildings } = await supabase.from("buildings").select("id, name");
    const buildingName = new Map<string, string>(
      (buildings ?? []).map((b: { id: string; name: string | null }) => [b.id, b.name ?? ""]),
    );
    const nameFor = (id: string | null): string | null => (id ? buildingName.get(id) || null : null);

    // Portfolio expiry counts for admins and managers (site users see only their buildings, and the
    // per-person RLS view is not worth a query each; they get the widget in the app).
    const { data: adminRoleRows, error: adminRoleErr } = await supabase.from("user_roles").select("user_id").in("role", ["admin", "manager"]);
    // Not fatal: the digest still goes out, but nobody gets the expiry section this run — say so.
    if (adminRoleErr) console.error("daily-digest: user_roles read failed; no expiry section this run", adminRoleErr);
    const adminIds = new Set((adminRoleRows ?? []).map((r: { user_id: string }) => r.user_id));
    let expiring: ExpiryBuckets | null = null;
    try {
      const { data: expRows, error: expErr } = await supabase.rpc("expiring_items", { p_days: 90 });
      if (expErr) throw expErr;
      // Same bucketing as the app's widget (bucketOf in ../_shared/expiry.ts).
      expiring = countBuckets((expRows ?? []) as { days_left: number }[]);
    } catch (e) {
      // The digest still goes out without the expiry line; the widget and the alerts cron cover it.
      console.error("daily-digest: expiring_items failed", e);
    }

    // Coverage gaps for admins and managers, one service-role call per run (S1 §4.4). The service
    // role bypasses RLS, so this is the whole portfolio; site users never receive this section.
    let coverage: CoverageSummary | null = null;
    try {
      const { data: covRows, error: covErr } = await supabase.rpc("portfolio_coverage");
      if (covErr) throw covErr;
      coverage = coverageSummary((covRows ?? []) as CoverageRow[]);
    } catch (e) {
      // The digest still goes out without the coverage lines; the dashboard widget covers it.
      console.error("daily-digest: portfolio_coverage failed", e);
    }

    // ---- Push pass: one task_due_today per person with a live device --------------------
    // Runs first so a slow email pass cannot delay the morning push. Nothing here throws out
    // of the run: a push is a hint, the email is the record of the day.
    let pushConsidered = 0;
    let pushed = 0;
    let pushFailed = 0;
    try {
      // Prune subscriptions the push service rejected (404/410 stamped `failed_at`) that have
      // stayed dead for 30 days. Anything younger is left for the device to refresh.
      const cutoff = new Date(Date.now() - FAILED_SUBSCRIPTION_TTL_DAYS * 86_400_000).toISOString();
      const { error: pruneErr } = await supabase
        .from("push_subscriptions")
        .delete()
        .lt("failed_at", cutoff);
      if (pruneErr) console.error("daily-digest: push prune failed", pruneErr);

      // Who can actually receive a push: distinct owners of a subscription not marked failed.
      const { data: subRows, error: subErr } = await supabase
        .from("push_subscriptions")
        .select("user_id")
        .is("failed_at", null);
      if (subErr) throw new Error(`Could not read push subscriptions: ${subErr.message}`);
      const subscriberIds = Array.from(
        new Set((subRows ?? []).map((r: { user_id: string }) => r.user_id)),
      );

      // Then narrow to accounts that are active and have not turned task reminders off (null
      // means opted in, matching governingFlag/shouldPush in _shared/notifyRules.ts). The
      // email master switch is deliberately not consulted: it governs email only.
      const { data: pushProfiles, error: pushProfErr } = subscriberIds.length
        ? await supabase
          .from("profiles")
          .select("id")
          .in("id", subscriberIds)
          .not("deactivated", "is", true)
          .not("task_reminders", "is", false)
        : { data: [], error: null };
      if (pushProfErr) throw new Error(`Could not read push recipients: ${pushProfErr.message}`);

      const sinceMidnight = startOfDayJohannesburgIso(today);
      for (const p of (pushProfiles ?? []) as { id: string }[]) {
        pushConsidered++;
        // One person's push must never abort the run (or the email pass): log and move on.
        try {
          // The same "what do I owe today" query the email digest uses below.
          const { data: taskRows, error: taskErr } = await supabase
            .from("task_instances")
            .select("id, task_name, due_date, building_id")
            .eq("assigned_to", p.id)
            .in("status", ["pending", "overdue"])
            .not("due_date", "is", null)
            .lte("due_date", today)
            .order("due_date");
          if (taskErr) throw new Error(`Could not read due tasks: ${taskErr.message}`);

          const tasks: DigestTask[] = (taskRows ?? []).map(
            (t: { id: string; task_name: string | null; due_date: string; building_id: string | null }) => ({
              id: t.id,
              task_name: t.task_name ?? "Untitled task",
              due_date: t.due_date,
              building_name: nameFor(t.building_id),
            }),
          );
          const push = dueTodayPush(tasks, today);
          if (!push) continue;

          // Idempotent per day: a cron re-run (or a manual retry) must not push twice. The
          // inbox row is the ledger — if today's already exists, so did today's push.
          const { count: alreadyToday, error: dupErr } = await supabase
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("recipient_id", p.id)
            .eq("kind", "task_due_today")
            .gte("created_at", sinceMidnight);
          if (dupErr) throw new Error(`Could not check today's notifications: ${dupErr.message}`);
          if ((alreadyToday ?? 0) > 0) continue;

          const result = await createNotifications(supabase, {
            recipients: [p.id],
            actorId: null,
            actorName: null,
            kind: "task_due_today",
            entityType: "task",
            entityId: null,
            buildingId: null,
            title: push.title,
            body: push.body,
            url: "/my-day",
          }, branding);
          pushed += result.pushed;
        } catch (e) {
          console.error("daily-digest: push recipient failed", p.id, e);
          pushFailed++;
        }
      }
    } catch (e) {
      // A broken push pass is logged and counted; the email digest still goes out.
      console.error("daily-digest: push pass failed", e);
      pushFailed++;
    }

    // ---- Email pass -----------------------------------------------------------------------
    let considered = 0;
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const p of recipients ?? []) {
      considered++;
      // `.not("email", "is", null)` lets a whitespace-only address through; Resend would
      // reject it as a hard failure, so it is a skip, not a send.
      const address = (p.email as string | null)?.trim();
      if (!address) { skipped++; continue; }
      // One person's digest must never abort the run: log and move to the next.
      try {
        const [{ data: taskRows }, { data: issueRows }, { count: unreadCount }] = await Promise.all([
          supabase
            .from("task_instances")
            .select("id, task_name, due_date, building_id")
            .eq("assigned_to", p.id)
            .in("status", ["pending", "overdue"])
            .not("due_date", "is", null)
            .lte("due_date", today)
            .order("due_date"),
          supabase
            .from("issues")
            .select("id, title, priority, building_id")
            .eq("assigned_to", p.id)
            .neq("status", "resolved")
            .order("created_at"),
          supabase
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("recipient_id", p.id)
            .is("read_at", null),
        ]);

        const tasks: DigestTask[] = (taskRows ?? []).map(
          (t: { id: string; task_name: string | null; due_date: string; building_id: string | null }) => ({
            id: t.id,
            task_name: t.task_name ?? "Untitled task",
            due_date: t.due_date,
            building_name: nameFor(t.building_id),
          }),
        );
        const issues: DigestIssue[] = (issueRows ?? []).map(
          (i: { id: string; title: string | null; priority: string | null; building_id: string | null }) => ({
            id: i.id,
            title: i.title ?? "Untitled issue",
            priority: i.priority ?? "normal",
            building_name: nameFor(i.building_id),
          }),
        );

        const isManager = adminIds.has(p.id);
        const sections = composeDigest({
          today, tasks, issues,
          expiring: isManager ? expiring : null,
          coverage: isManager ? coverage : null,
          unread: unreadCount ?? 0,
        });
        if (!sections) { skipped++; continue; }

        const html = renderEmail({
          branding,
          preheader: sections[0].heading,
          heading: "Your day at a glance",
          // `greeting` is escaped by renderEmail; only `bodyHtml` is passed through raw,
          // which is why renderSections is the thing that has to call escapeText.
          greeting: p.full_name ? `Hi ${p.full_name},` : undefined,
          bodyHtml: renderSections(sections),
          ctaText: "Open My Day",
          ctaUrl: `${APP_URL}/my-day`,
          footnote: "You can turn this digest off under My Profile → Notifications.",
        });

        if (await sendEmail(from, [address], `Your ${branding.appName} digest`, html)) sent++;
        else skipped++;
      } catch (e) {
        console.error("daily-digest: recipient failed", p.id, e);
        failed++;
      }
    }

    // Counts only — never the digest payload. `pushed` is devices reached, not people:
    // createNotifications fans one inbox row out to every live subscription the person has.
    return json({ considered, sent, skipped, failed, pushConsidered, pushed, pushFailed });
  } catch (error) {
    console.error("daily-digest error:", error);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
