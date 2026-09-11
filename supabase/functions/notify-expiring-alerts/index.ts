// Expiry alerts across four tables in one read: `expiring_items(30)` (R4a §5.6) returns building,
// tenant and contractor documents, asset warranties and asset service dates that expire within
// 30 days, expired rows included. The summary email lists everything in that window on every
// run: expired and expiring documents/warranties, overdue service dates and service dates due
// within 30 days. Inbox rows are narrower: `document_expiring` for the four document-shaped
// kinds (a warranty row carries entity_type `asset`), `asset_service_due` for OVERDUE service
// dates only (a due-soon service is email-only), and only on a milestone day —
// `isNotifyMilestone` in ../_shared/expiry.ts: 30 / 14 / 7 / 1 / 0 days left, then every
// seventh day after expiry — on top of the once-per-entity-per-SAST-day dedupe, so nobody gets
// the same row every morning for a month.
//
// DEPLOY PREREQUISITES — this function is not on production yet, and the cron
// path stays unauthorized until both of these are done:
//   1. supabase secrets set EXPIRING_ALERTS_SECRET=<random> --project-ref qdzgkttiosahdfqresvz
//   2. Register the pg_cron schedule that posts to this function with the same value in an
//      `x-alerts-secret` header — mirror sql/2026-06-14_03_signoff_cron.sql, which does
//      exactly this for `x-signoff-secret`.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { Branding, loadBranding, renderEmail } from "../_shared/email.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { adminAndManagerIds, createNotifications } from "../_shared/notify.ts";
import { KIND_LABELS, expiryPhrase, isNotifyMilestone, itemUrl, type ExpiringItem } from "../_shared/expiry.ts";

// Lazy: the Resend constructor throws without a key, which used to crash the whole function
// at module load on projects that have no RESEND_API_KEY (staging). Inbox rows never need it.
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const APP_URL = (Deno.env.get("APP_URL") ?? "https://buildingops.app").replace(/\/+$/, "");
const ALERTS_SECRET = Deno.env.get("EXPIRING_ALERTS_SECRET");

const EXTRA_ALLOW_HEADERS =
  "x-alerts-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version";

function cors(req: Request): Record<string, string> {
  const base = corsHeaders(req);
  return {
    ...base,
    "Access-Control-Allow-Headers": `${base["Access-Control-Allow-Headers"]}, ${EXTRA_ALLOW_HEADERS}`,
  };
}

/** Organization name is operator-supplied; keep it to characters that are safe
 *  in the display-name part of an email `From` header. */
function senderName(name: string): string {
  return name.replace(/[^A-Za-z0-9 &.-]/g, "").trim().slice(0, 64) || "Building Ops";
}

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
 * for the "already in the inbox today" check. South Africa has no daylight saving, so the
 * offset is a constant +02:00 rather than a timezone lookup. Same helper as daily-digest.
 */
function startOfDayJohannesburgIso(today: string): string {
  return new Date(`${today}T00:00:00+02:00`).toISOString();
}

/** Inbox title and body for any row: "<name> expires in 3 days", "<name> service overdue by 2 days". */
function itemTitle(item: ExpiringItem): string {
  return `${item.name} ${expiryPhrase(item)}`;
}
function itemBody(item: ExpiringItem): string {
  return `${KIND_LABELS[item.kind]}${item.detail ? ` · ${item.detail}` : ""}`;
}

/**
 * The email's "Where" column. A contractor document has no building (`building_id` and
 * `building_name` are null) — its `detail` carries the company name, so that is shown instead.
 */
function whereOf(item: ExpiringItem): string {
  if (item.building_name) return item.building_name;
  if (item.kind === "contractor_document") return item.detail ?? "Contractor";
  return "—";
}

/** The `expiring_items(30)` rows split the way the email and the inbox pass consume them. */
interface AlertSummary {
  /** Documents and warranties with 0..30 days left. */
  expiringDocuments: ExpiringItem[];
  /** Documents and warranties past their date. */
  expiredDocuments: ExpiringItem[];
  /** Service dates past due — inbox rows and the email. */
  overdueMaintenance: ExpiringItem[];
  /** Service dates due within 30 days (today included) — email only, never an inbox row. */
  dueSoonMaintenance: ExpiringItem[];
}

const handler = async (req: Request): Promise<Response> => {
  console.log("notify-expiring-alerts function called");

  const headers = cors(req);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Two accepted callers: the cron job (shared secret) or an admin triggering
    // it by hand from the app (verified JWT). Anything else is rejected.
    const secretHeader = req.headers.get("x-alerts-secret");
    const cronAuthorized = Boolean(ALERTS_SECRET) && secretHeader === ALERTS_SECRET;

    if (!cronAuthorized) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "unauthorized" }, 401);

      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user: caller }, error: callerErr } = await userClient.auth.getUser();
      if (callerErr || !caller) return json({ error: "unauthorized" }, 401);

      // Array form, not maybeSingle: user_roles carries building_id and can hold
      // several rows per user, which would make maybeSingle raise PGRST116 and
      // lock out a legitimate admin.
      const { data: callerRoles, error: roleErr } = await supabase
        .from("user_roles").select("role").eq("user_id", caller.id);
      if (roleErr || !callerRoles?.some((r: { role: string }) => r.role === "admin")) {
        return json({ error: "forbidden" }, 403);
      }
    }

    // Parse request body for options
    let notifyAdmins = true;
    let dryRun = false;
    
    try {
      const body = await req.json();
      notifyAdmins = body.notifyAdmins ?? true;
      dryRun = body.dryRun ?? false;
    } catch {
      // No body or invalid JSON, use defaults
    }

    console.log("Checking for expiring documents, warranties and overdue maintenance...");

    // One read for every expiry source (building/tenant/contractor documents, asset warranties, service
    // dates): expiring_items(30) is security invoker, and the service role sees every row. Asset service
    // dates split on days_left: negative is overdue (inbox rows + email), zero or positive is "due soon",
    // which the email lists (the same 30-day window the digest counts) but the inbox does not — the
    // inbox keeps its old meaning: overdue service.
    const { data: expiring, error: expErr } = await supabase.rpc("expiring_items", { p_days: 30 });
    if (expErr) {
      console.error("Error reading expiring items:", expErr);
      throw expErr;
    }
    const items = (expiring ?? []) as ExpiringItem[];
    console.log(`Found ${items.length} expiring items within 30 days (incl. expired)`);

    const expiringDocuments: ExpiringItem[] = [];
    const expiredDocuments: ExpiringItem[] = [];
    const overdueMaintenance: ExpiringItem[] = [];
    const dueSoonMaintenance: ExpiringItem[] = [];
    for (const it of items) {
      if (it.kind === "asset_service") (it.days_left < 0 ? overdueMaintenance : dueSoonMaintenance).push(it);
      else (it.days_left < 0 ? expiredDocuments : expiringDocuments).push(it);
    }

    const alertSummary: AlertSummary = {
      expiringDocuments,
      expiredDocuments,
      overdueMaintenance,
      dueSoonMaintenance,
    };

    const totalAlerts = expiringDocuments.length + expiredDocuments.length + overdueMaintenance.length + dueSoonMaintenance.length;
    console.log(`Total alerts: ${totalAlerts}`);

    // If no alerts, return early. The summary itself is never returned to any
    // caller — it is portfolio-wide confidential data.
    if (totalAlerts === 0) {
      console.log("No alerts to send");
      return json({
        success: true,
        dryRun,
        totalAlerts: 0,
        recipientCount: 0,
        inboxRows: 0,
        inboxAlreadyToday: 0,
        inboxOffMilestone: 0,
        inboxFailed: 0,
      });
    }

    // ---- Inbox pass ---------------------------------------------------------------------
    // One `document_expiring` / `asset_service_due` row per admin and manager per item per day,
    // so the same alerts the summary email lists are also in the in-app inbox (R3a Task 6).
    // `document_expiring` covers all four document-shaped kinds; the row's entity_type and url
    // follow the kind (a warranty is an `asset` row deep-linking to the assets tab, a contractor
    // document has no building and opens the contractor register).
    // Both kinds are DIGEST_ONLY in notifyRules.ts, so createNotifications writes the row and
    // sends no per-item email — the summary email below stays the only email this function
    // sends. `notifyAdmins` governs that email only; inbox rows are written regardless of it,
    // because the inbox is the ledger. Only `dryRun` skips this pass.
    // Cadence: an item only gets a row on a milestone day (isNotifyMilestone — 30/14/7/1/0 days
    // left, then every seventh day past expiry); the rest of the window it is email-only. That
    // is deterministic on days_left, so a missed cron day simply skips that milestone.
    // Idempotent per entity per day: a cron re-run (or a manual retry from the app) must not
    // duplicate rows, so an item is skipped when a row of that kind for that entity already
    // exists since midnight in Johannesburg. Per-item failures are logged and counted, never
    // thrown, so one bad row cannot cost anyone the summary email.
    let inboxRows = 0;
    let inboxAlreadyToday = 0;
    let inboxOffMilestone = 0;
    let inboxFailed = 0;

    if (!dryRun) {
      const inboxRecipients = await adminAndManagerIds(supabase);
      if (inboxRecipients.length === 0) {
        console.warn("No admin/manager recipients for inbox rows");
      } else {
        const sinceMidnight = startOfDayJohannesburgIso(todayInJohannesburg());
        // Branding is only used for the (never sent) email `from` line here, but loading it
        // once keeps createNotifications from re-reading it for every item.
        const inboxBranding = await loadBranding(supabase);

        type InboxItem = {
          kind: "document_expiring" | "asset_service_due";
          entityType: "document" | "asset";
          entityId: string;
          buildingId: string | null;
          title: string;
          body: string | null;
          url: string;
        };
        const toInbox = (it: ExpiringItem): InboxItem => ({
          kind: it.kind === "asset_service" ? "asset_service_due" : "document_expiring",
          entityType: it.entity_type,
          entityId: it.entity_id,
          buildingId: it.building_id,
          title: itemTitle(it),
          body: itemBody(it),
          url: itemUrl(it),
        });
        const inboxCandidates = [...expiredDocuments, ...expiringDocuments, ...overdueMaintenance];
        const inboxItems: InboxItem[] = [];
        for (const it of inboxCandidates) {
          if (isNotifyMilestone(it.days_left)) inboxItems.push(toInbox(it));
          else inboxOffMilestone++;
        }

        for (const item of inboxItems) {
          try {
            const { count: alreadyToday, error: dupErr } = await supabase
              .from("notifications")
              .select("id", { count: "exact", head: true })
              .eq("kind", item.kind)
              .eq("entity_id", item.entityId)
              .gte("created_at", sinceMidnight);
            if (dupErr) throw new Error(`Could not check today's notifications: ${dupErr.message}`);
            if ((alreadyToday ?? 0) > 0) { inboxAlreadyToday++; continue; }

            const result = await createNotifications(supabase, {
              recipients: inboxRecipients,
              actorId: null,
              actorName: null,
              kind: item.kind,
              entityType: item.entityType,
              entityId: item.entityId,
              buildingId: item.buildingId,
              title: item.title,
              body: item.body,
              url: item.url,
            }, inboxBranding);
            inboxRows += result.inserted;
          } catch (e) {
            console.error("notify-expiring-alerts: inbox row failed", item.kind, item.entityId, e);
            inboxFailed++;
          }
        }
      }
      console.log(`Inbox rows: ${inboxRows} written, ${inboxAlreadyToday} already today, ${inboxOffMilestone} off-milestone (email only), ${inboxFailed} failed`);
    }

    // ---- Email pass ---------------------------------------------------------------------
    // `recipientCount` is the number of people an email actually went out to (or would go
    // out to on a dry run). Without a Resend key nothing can be sent, so the whole block is
    // skipped and the count stays 0 — checking inside the recipient loop used to report N
    // recipients after zero sends.
    let recipientCount = 0;

    if (!notifyAdmins) {
      // Caller asked for inbox rows only.
    } else if (!resend) {
      console.warn("RESEND_API_KEY not set; alert email skipped");
    } else {
      const { data: roleRows, error: roleError } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "manager"]);

      if (roleError) {
        console.error("Error fetching admin roles:", roleError);
        throw roleError;
      }

      const adminIds: string[] = [
        ...new Set((roleRows || []).map((r: { user_id: string }) => r.user_id)),
      ];

      const recipients: { email: string; full_name: string | null }[] = [];

      if (adminIds.length > 0) {
        // Respect the per-user notification preferences (NULL means opted in).
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("email, full_name")
          .in("id", adminIds)
          .not("email_notifications", "is", false)
          .not("overdue_alerts", "is", false);

        if (profileError) {
          console.error("Error fetching admin profiles:", profileError);
          throw profileError;
        }

        for (const p of profiles || []) {
          if (p.email) recipients.push({ email: p.email, full_name: p.full_name ?? null });
        }
      }

      recipientCount = recipients.length;

      console.log(`Found ${recipientCount} opted-in admin/manager recipients`);

      if (!dryRun) {
        // Load org branding once for all recipients in this run.
        const branding = await loadBranding(supabase);

        for (const profile of recipients) {
          const recipientName = profile.full_name || "Admin";
          const recipientEmail = profile.email;

          const emailHtml = generateAlertEmailHtml(branding, recipientName, alertSummary);

          try {
            await resend.emails.send({
              from: `${senderName(branding.appName)} <alerts@buildingops.app>`,
              to: [recipientEmail],
              subject: `⚠️ ${totalAlerts} Building Alert${totalAlerts > 1 ? 's' : ''} Require Attention`,
              html: emailHtml,
            });
            console.log("Alert email sent");
          } catch (emailError) {
            console.error("Failed to send alert email:", emailError);
            // Continue sending to other recipients
          }
        }
      }
    }

    return json({
      success: true,
      dryRun,
      totalAlerts,
      recipientCount,
      inboxRows,
      inboxAlreadyToday,
      inboxOffMilestone,
      inboxFailed,
    });
  } catch (error) {
    console.error("Error in notify-expiring-alerts:", error);
    return json({ error: "An unexpected error occurred" }, 500);
  }
};

function generateAlertEmailHtml(branding: Branding, recipientName: string, alerts: AlertSummary): string {
  const { expiringDocuments, expiredDocuments, overdueMaintenance, dueSoonMaintenance } = alerts;
  const nameCell = (it: ExpiringItem) =>
    `${escapeHtml(it.name)}<br><span style="font-size: 12px; color: #9ca3af;">${escapeHtml(itemBody(it))}</span>`;

  let html = `
              <p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">
                The following items require your attention:
              </p>`;

  // Expired Documents Section
  if (expiredDocuments.length > 0) {
    html += `
              <div style="margin-bottom: 24px;">
                <h2 style="margin: 0 0 16px; color: #dc2626; font-size: 16px; font-weight: 600; display: flex; align-items: center;">
                  🔴 Expired Documents (${expiredDocuments.length})
                </h2>
                <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #fecaca; border-radius: 8px; overflow: hidden;">
                  <tr style="background-color: #fef2f2;">
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b; font-weight: 600;">Document</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b; font-weight: 600;">Where</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b; font-weight: 600;">Expired</th>
                  </tr>`;
    
    for (const doc of expiredDocuments) {
      html += `
                  <tr style="border-top: 1px solid #fecaca;">
                    <td style="padding: 12px; font-size: 14px; color: #374151;">${nameCell(doc)}</td>
                    <td style="padding: 12px; font-size: 14px; color: #6b7280;">${escapeHtml(whereOf(doc))}</td>
                    <td style="padding: 12px; font-size: 14px; color: #dc2626; font-weight: 500;">${-doc.days_left} days ago</td>
                  </tr>`;
    }
    
    html += `
                </table>
              </div>`;
  }

  // Expiring Soon Documents Section
  if (expiringDocuments.length > 0) {
    html += `
              <div style="margin-bottom: 24px;">
                <h2 style="margin: 0 0 16px; color: #d97706; font-size: 16px; font-weight: 600;">
                  🟡 Expiring Soon (${expiringDocuments.length})
                </h2>
                <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #fde68a; border-radius: 8px; overflow: hidden;">
                  <tr style="background-color: #fffbeb;">
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e; font-weight: 600;">Document</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e; font-weight: 600;">Where</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e; font-weight: 600;">Expires In</th>
                  </tr>`;
    
    for (const doc of expiringDocuments) {
      html += `
                  <tr style="border-top: 1px solid #fde68a;">
                    <td style="padding: 12px; font-size: 14px; color: #374151;">${nameCell(doc)}</td>
                    <td style="padding: 12px; font-size: 14px; color: #6b7280;">${escapeHtml(whereOf(doc))}</td>
                    <td style="padding: 12px; font-size: 14px; color: #d97706; font-weight: 500;">${doc.days_left === 0 ? "today" : `${doc.days_left} days`}</td>
                  </tr>`;
    }
    
    html += `
                </table>
              </div>`;
  }

  // Overdue Maintenance Section
  if (overdueMaintenance.length > 0) {
    html += `
              <div style="margin-bottom: 24px;">
                <h2 style="margin: 0 0 16px; color: #7c3aed; font-size: 16px; font-weight: 600;">
                  🔧 Overdue Maintenance (${overdueMaintenance.length})
                </h2>
                <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #c4b5fd; border-radius: 8px; overflow: hidden;">
                  <tr style="background-color: #f5f3ff;">
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #5b21b6; font-weight: 600;">Asset</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #5b21b6; font-weight: 600;">Where</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #5b21b6; font-weight: 600;">Overdue</th>
                  </tr>`;
    
    for (const asset of overdueMaintenance) {
      html += `
                  <tr style="border-top: 1px solid #c4b5fd;">
                    <td style="padding: 12px; font-size: 14px; color: #374151;">${nameCell(asset)}</td>
                    <td style="padding: 12px; font-size: 14px; color: #6b7280;">${escapeHtml(whereOf(asset))}</td>
                    <td style="padding: 12px; font-size: 14px; color: #7c3aed; font-weight: 500;">${-asset.days_left} days</td>
                  </tr>`;
    }
    
    html += `
                </table>
              </div>`;
  }

  // Service Due Soon Section (email only — no inbox rows for these)
  if (dueSoonMaintenance.length > 0) {
    html += `
              <div style="margin-bottom: 24px;">
                <h2 style="margin: 0 0 16px; color: #2563eb; font-size: 16px; font-weight: 600;">
                  🗓️ Service Due Soon (${dueSoonMaintenance.length})
                </h2>
                <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #bfdbfe; border-radius: 8px; overflow: hidden;">
                  <tr style="background-color: #eff6ff;">
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #1e40af; font-weight: 600;">Asset</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #1e40af; font-weight: 600;">Where</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #1e40af; font-weight: 600;">Due In</th>
                  </tr>`;

    for (const asset of dueSoonMaintenance) {
      html += `
                  <tr style="border-top: 1px solid #bfdbfe;">
                    <td style="padding: 12px; font-size: 14px; color: #374151;">${nameCell(asset)}</td>
                    <td style="padding: 12px; font-size: 14px; color: #6b7280;">${escapeHtml(whereOf(asset))}</td>
                    <td style="padding: 12px; font-size: 14px; color: #2563eb; font-weight: 500;">${asset.days_left === 0 ? "today" : `${asset.days_left} days`}</td>
                  </tr>`;
    }

    html += `
                </table>
              </div>`;
  }

  return renderEmail({
    branding,
    heading: "⚠️ Building Alerts",
    greeting: `Hi ${recipientName},`,
    bodyHtml: html,
    ctaText: "View Dashboard",
    ctaUrl: `${APP_URL}/dashboard`,
  });
}

serve(handler);
