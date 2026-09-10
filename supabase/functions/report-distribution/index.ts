// report-distribution — reminders and send-day distribution of approved report PDFs (spec §5.7).
// Cron (x-distribution-secret, body {}) runs every active schedule for today's SAST date, once per
// day. An admin/manager JWT may run ONE schedule now ({scheduleId, dryRun, period?}); dry run
// returns what would happen and writes nothing. Reports are never generated here (spec §3): an
// approved report without an approved-status artifact is skipped and its author is asked to export.
// Logs carry counts only — never a token, an email address or a message body.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { loadBranding, renderEmail } from "../_shared/email.ts";
import { APP_URL, adminAndManagerIds, createNotifications, sendEmail, senderName } from "../_shared/notify.ts";
import { todayInOperatingTz } from "../_shared/calendar.ts";
import { callerId, isAdminOrManager, type Admin } from "../_shared/reportAccess.ts";
import {
  EXPIRY_DAYS_DEFAULT,
  REPORT_TYPE_LABELS,
  distributionCopy,
  mintShareToken,
  planFor,
  previousMonthStart,
  reminderCopy,
  sendDateFor,
  type PlanAction,
  type ReportType,
} from "../_shared/distribution.ts";

const SECRET = Deno.env.get("REPORT_DISTRIBUTION_SECRET");
const PERIOD_RE = /^\d{4}-\d{2}-01$/;
/** Every building read is capped so a runaway table cannot turn one run into a full scan. */
const BUILDING_CAP = 500;

type Recipient = { email?: string; name?: string; user_id?: string };
type Schedule = {
  id: string;
  report_type: ReportType;
  building_ids: string[] | null;
  recipients: Recipient[];
  send_day: number;
  remind_days_before: number;
  is_active: boolean;
  created_by: string | null;
  last_run_on: string | null;
};
type ReportRow = { id: string; building_id: string; title: string; status: string; author_id: string | null };
type BuildingResult = {
  buildingId: string;
  buildingName: string;
  reportId: string | null;
  status: string;
  recipients: number;
  shareId?: string;
  error?: string;
};
type Counts = { sent: number; skipped_no_artifact: number; skipped_not_approved: number; failed: number; reminded: number; already_sent: number };

/** Midnight at the start of a SAST day as an instant (no DST in ZA, so the offset is a constant). */
const startOfSastDay = (ymd: string) => new Date(`${ymd}T00:00:00+02:00`).toISOString();

/** Explicit `building_ids`, or every building whose `report_types` contains the schedule's type. */
async function targetBuildings(admin: Admin, s: Schedule): Promise<{ id: string; name: string }[]> {
  const base = admin.from("buildings").select("id, name");
  const filtered = s.building_ids ? base.in("id", s.building_ids) : base.contains("report_types", [s.report_type]);
  const { data, error } = await filtered.order("name").limit(BUILDING_CAP);
  if (error) throw error;
  return (data ?? []) as { id: string; name: string }[];
}

/** Latest snapshot row per building (R4a `building_metrics_daily`); null when there is none yet. */
async function latestCompliance(admin: Admin, buildingId: string): Promise<number | null> {
  const { data } = await admin
    .from("building_metrics_daily")
    .select("compliance_pct")
    .eq("building_id", buildingId)
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();
  return typeof data?.compliance_pct === "number" ? data.compliance_pct : null;
}

/** One reminder per (building, type, day): dedupe on the title, which carries both. */
async function alreadyReminded(admin: Admin, buildingId: string, title: string, today: string): Promise<boolean> {
  const { data } = await admin
    .from("notifications")
    .select("id")
    .eq("kind", "report_due_soon")
    .eq("building_id", buildingId)
    .eq("title", title)
    .gte("created_at", startOfSastDay(today))
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function runSchedule(admin: Admin, s: Schedule, plan: PlanAction, today: string, dryRun: boolean, counts: Counts): Promise<BuildingResult[]> {
  if (plan.action === "none") return [];
  const period = plan.period;
  const recipients: Recipient[] = Array.isArray(s.recipients) ? s.recipients : [];
  const buildings = await targetBuildings(admin, s);
  const results: BuildingResult[] = [];
  const adminIds = await adminAndManagerIds(admin);
  const branding = await loadBranding(admin);
  const { data: org } = await admin.from("organizations").select("settings").limit(1).maybeSingle();
  const fromName = senderName((org?.settings?.distribution_from as string | undefined) || branding.appName);
  const from = `${fromName} <notifications@buildingops.app>`;
  const label = REPORT_TYPE_LABELS[s.report_type];

  for (const b of buildings) {
    const { data: report } = await admin
      .from("reports")
      .select("id, building_id, title, status, author_id")
      .eq("building_id", b.id)
      .eq("report_type", s.report_type)
      .eq("report_period", period)
      .maybeSingle();
    const r = report as ReportRow | null;
    const base: BuildingResult = { buildingId: b.id, buildingName: b.name, reportId: r?.id ?? null, status: "", recipients: recipients.length };

    if (plan.action === "remind") {
      if (r?.status === "approved") {
        results.push({ ...base, status: "approved" });
        continue;
      }
      const copy = reminderCopy({
        buildingName: b.name, reportType: s.report_type, period, sendDate: sendDateFor(period, s), exists: !!r, status: r?.status ?? null,
      });
      if (await alreadyReminded(admin, b.id, copy.title, today)) {
        results.push({ ...base, status: "already_reminded" });
        continue;
      }
      if (!dryRun) {
        await createNotifications(admin, {
          recipients: [...(r?.author_id ? [r.author_id] : []), ...adminIds],
          actorId: null,
          actorName: "Report schedule",
          kind: "report_due_soon",
          entityType: "report",
          entityId: r?.id ?? null,
          buildingId: b.id,
          title: copy.title,
          body: copy.body,
          url: r ? `/reports/fortress/${r.id}` : `/buildings/${b.id}?tab=reports`,
        }, branding);
      }
      counts.reminded++;
      results.push({ ...base, status: "reminded" });
      continue;
    }

    // ── send ──
    if (!r || r.status !== "approved") {
      counts.skipped_not_approved++;
      if (!dryRun) {
        await admin.from("report_distributions").insert({
          schedule_id: s.id, report_id: r?.id ?? null, building_id: b.id, report_period: period, status: "skipped_not_approved", sent_to: [],
        });
      }
      results.push({ ...base, status: "skipped_not_approved" });
      continue;
    }
    // Idempotent per report across manual + cron runs: one "sent" distribution per schedule and report.
    const { data: prior } = await admin
      .from("report_distributions")
      .select("id")
      .eq("schedule_id", s.id)
      .eq("report_id", r.id)
      .eq("status", "sent")
      .limit(1);
    if ((prior?.length ?? 0) > 0) {
      counts.already_sent++;
      results.push({ ...base, status: "already_sent" });
      continue;
    }
    // Only an artifact issued while the report was approved is final (no DRAFT watermark).
    const { data: artifact } = await admin
      .from("report_artifacts")
      .select("id, file_name")
      .eq("source_id", r.id)
      .eq("status", "issued")
      .eq("report_status", "approved")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!artifact) {
      counts.skipped_no_artifact++;
      if (!dryRun) {
        await admin.from("report_distributions").insert({
          schedule_id: s.id, report_id: r.id, building_id: b.id, report_period: period, status: "skipped_no_artifact", sent_to: [],
        });
        await createNotifications(admin, {
          recipients: r.author_id ? [r.author_id] : adminIds,
          actorId: null,
          actorName: "Report schedule",
          kind: "report_export_needed",
          entityType: "report",
          entityId: r.id,
          buildingId: b.id,
          title: `Export needed: ${label} — ${b.name}`,
          body: "This report is approved but has no final PDF, so it could not be distributed. Open it and use Export PDF.",
          url: `/reports/fortress/${r.id}`,
        }, branding);
      }
      results.push({ ...base, status: "skipped_no_artifact" });
      continue;
    }
    if (dryRun) {
      results.push({ ...base, status: "would_send" });
      counts.sent++;
      continue;
    }

    const createdBy = s.created_by ?? adminIds[0] ?? null;
    if (!createdBy) {
      counts.failed++;
      results.push({ ...base, status: "failed", error: "no owner for the share" });
      continue;
    }
    const expiresAt = new Date(Date.now() + EXPIRY_DAYS_DEFAULT * 86_400_000).toISOString();
    const { data: share, error: shareErr } = await admin
      .from("report_shares")
      .insert({ report_id: r.id, artifact_id: artifact.id, token: mintShareToken(), created_by: createdBy, expires_at: expiresAt })
      .select("id, token")
      .single();
    if (shareErr || !share) {
      counts.failed++;
      await admin.from("report_distributions").insert({
        schedule_id: s.id, report_id: r.id, building_id: b.id, report_period: period, artifact_id: artifact.id,
        status: "failed", sent_to: [], error: `share: ${shareErr?.message ?? "no row"}`,
      });
      results.push({ ...base, status: "failed", error: "share" });
      continue;
    }
    const copy = distributionCopy({
      buildingName: b.name, reportType: s.report_type, period, title: r.title,
      compliancePct: await latestCompliance(admin, b.id), expiresAt, appName: branding.appName,
    });
    const shareUrl = `${APP_URL}/share/${share.token}`;
    const sentTo: Record<string, unknown>[] = [];
    let delivered = 0;
    for (const rcpt of recipients) {
      let email = rcpt.email ?? null;
      if (rcpt.user_id) {
        const { data: p } = await admin.from("profiles").select("email, deactivated").eq("id", rcpt.user_id).maybeSingle();
        if (!p || p.deactivated) {
          sentTo.push({ ...rcpt, ok: false, reason: "deactivated" });
          continue;
        }
        email = p.email ?? email;
      }
      if (!email) {
        sentTo.push({ ...rcpt, ok: false, reason: "no email" });
        continue;
      }
      // renderEmail escapes heading, greeting and preheader itself; bodyHtml was escaped by distributionCopy.
      const html = renderEmail({
        branding, preheader: copy.subject, heading: copy.heading,
        greeting: rcpt.name ? `Hi ${rcpt.name},` : undefined,
        bodyHtml: copy.bodyHtml, ctaText: copy.ctaText, ctaUrl: shareUrl,
      });
      try {
        const ok = await sendEmail(from, [email], copy.subject, html);
        if (ok) delivered++;
        sentTo.push({ ...rcpt, email, ok });
      } catch (e) {
        console.error("report-distribution: email failed", e instanceof Error ? e.message : e);
        sentTo.push({ ...rcpt, email, ok: false });
      }
    }
    // Without RESEND_API_KEY (staging) nothing can be delivered; the run still counts as sent so
    // the share row and the distribution record exist for the smoke test.
    const status = delivered > 0 || !Deno.env.get("RESEND_API_KEY") ? "sent" : "failed";
    if (status === "sent") counts.sent++;
    else counts.failed++;
    await admin.from("report_distributions").insert({
      schedule_id: s.id, report_id: r.id, building_id: b.id, report_period: period, artifact_id: artifact.id, share_id: share.id,
      status, sent_to: sentTo, error: status === "failed" ? "no recipient accepted" : null,
    });
    results.push({ ...base, status, shareId: share.id });
  }
  return results;
}

serve(async (req: Request): Promise<Response> => {
  // The shared CORS policy (allow-listed origins, never `*`) plus the cron secret header.
  const cors = corsHeaders(req, ["x-distribution-secret"]);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const raw = await req.json().catch(() => ({}));
  const body = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const today = todayInOperatingTz();
  const counts: Counts = { sent: 0, skipped_no_artifact: 0, skipped_not_approved: 0, failed: 0, reminded: 0, already_sent: 0 };

  try {
    const isCron = !!SECRET && req.headers.get("x-distribution-secret") === SECRET;
    let schedules: Schedule[];
    let dryRun = false;
    let forced: PlanAction | null = null;

    if (isCron) {
      const { data, error } = await admin.from("report_schedules").select("*").eq("is_active", true);
      if (error) throw error;
      schedules = (data ?? []) as Schedule[];
    } else {
      // Run-now: one schedule, forced to `send` for the requested period, reminders never run.
      const uid = await callerId(req);
      if (!uid) return json({ error: "unauthorized" }, 401);
      if (!(await isAdminOrManager(admin, uid))) return json({ error: "forbidden" }, 403);
      if (typeof body.scheduleId !== "string") return json({ error: "scheduleId required" }, 400);
      dryRun = body.dryRun !== false;
      const period = typeof body.period === "string" ? body.period : previousMonthStart(today);
      if (!PERIOD_RE.test(period)) return json({ error: "period must be YYYY-MM-01" }, 400);
      const { data, error } = await admin.from("report_schedules").select("*").eq("id", body.scheduleId).maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "unknown schedule" }, 404);
      schedules = [data as Schedule];
      forced = { action: "send", period };
    }

    const out: { scheduleId: string; action: string; period: string | null; buildings: BuildingResult[] }[] = [];
    for (const s of schedules) {
      if (isCron && s.last_run_on === today) {
        out.push({ scheduleId: s.id, action: "already_ran", period: null, buildings: [] });
        continue;
      }
      const plan = forced ?? planFor(today, s);
      const buildings = await runSchedule(admin, s, plan, today, dryRun, counts);
      out.push({ scheduleId: s.id, action: plan.action, period: plan.action === "none" ? null : plan.period, buildings });
      if (!dryRun && plan.action !== "none") {
        await admin
          .from("report_schedules")
          .update({ last_run_on: today, last_result: { ranAt: new Date().toISOString(), action: plan.action, period: plan.period, buildings } })
          .eq("id", s.id);
      }
    }
    console.log("report-distribution: run", { cron: isCron, dryRun, schedules: schedules.length, ...counts });
    return json({ ok: true, dryRun, today, schedules: out, counts });
  } catch (error) {
    console.error("report-distribution error:", error instanceof Error ? error.message : error);
    return json({ error: "run failed" }, 500);
  }
});
