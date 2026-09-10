// Opt-in daily digest: one email per person who set `profiles.daily_digest`, summarising the
// tasks they owe (overdue + due today), the issues assigned to them, and how much is unread in
// their inbox. Cron-triggered (pg_cron -> pg_net), so it is guarded by a shared secret rather
// than a user JWT — the same shape as `signoff-reminders`.
//
// All the shaping lives in `../_shared/digest.ts` so it can be unit-tested from vitest
// (src/lib/digest.test.ts); this file holds only the guard, the queries and the rendering.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { escapeText, loadBranding, renderEmail } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { APP_URL, senderName, sendEmail } from "../_shared/notify.ts";
import { composeDigest, type DigestIssue, type DigestSection, type DigestTask } from "../_shared/digest.ts";

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

        const sections = composeDigest({ today, tasks, issues, unread: unreadCount ?? 0 });
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

    // Counts only — never the digest payload.
    return json({ considered, sent, skipped, failed });
  } catch (error) {
    console.error("daily-digest error:", error);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
