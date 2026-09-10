// ics-feed — token-scoped calendar subscription feed (spec §5.5 / §7, plan Task 3).
//
// `GET /ics-feed?t=<token>` renders the same event model the in-app calendar uses as an
// iCalendar document for Outlook, Google and Apple Calendar. There is no user JWT
// (`verify_jwt = false` in config.toml): the token IS the credential. It is resolved with the
// service role and the OWNER's access is then applied — a building token is served only when
// `user_can_access_building(owner, building)` holds; a user token covers the owner's
// buildings (all of them for admin/manager, otherwise `user_buildings`). Every failure that
// could reveal whether a token exists answers the same 404.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import {
  assetEvent,
  documentEvent,
  inRange,
  issueEvent,
  ppmEvents,
  renderIcs,
  reportEvent,
  signoffEvent,
  taskEvent,
  todayInOperatingTz,
  type AssetRow,
  type CalendarEvent,
  type DocumentRow,
  type IssueRow,
  type PpmRow,
  type ReportRow,
  type SignoffRequestRow,
  type SignoffSubmissionRow,
  type TaskRow,
} from "../_shared/calendar.ts";

// Origin only, no trailing slash: the ICS `URL` property is `appUrl + href`.
const APP_URL = (Deno.env.get("APP_URL") ?? "https://buildingops.app").replace(/\/+$/, "");

/** 32 random bytes as base64url (minted client-side by `mintToken()`); nothing else is looked up. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const DAYS_BACK = 90;
const DAYS_FORWARD = 180;
// Tasks are the high-volume source (buildings × items × horizon), so they get a narrower window
// and only the rows that are still work: completed history is never a calendar item.
const TASK_DAYS_BACK = 14;
const TASK_DAYS_FORWARD = 60;
const TASK_STATUSES = ["pending", "overdue"];

/** Every source query is capped so a runaway table cannot turn one feed fetch into a full scan. */
const ROW_CAP = 2000;
const TASK_ROW_CAP = 5000;

const ADMIN_ROLES = new Set(["admin", "manager"]);

/** `YYYY-MM-DD` ± n days, computed in UTC so the calendar date never shifts with the runtime's zone. */
function shiftDate(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function textResponse(status: number, body: string, headers: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

/** Unknown, malformed, revoked, and out-of-scope tokens all look identical from outside. */
const notFound = (cors: Record<string, string>) => textResponse(404, "Not found", cors);

// Rows this function reads that the shared mappers do not describe.
type TokenRow = { id: string; user_id: string; building_id: string | null; revoked_at: string | null };
type BuildingRow = { id: string; name: string };
/** `form_signoff_requests` joined by hand to `form_submissions` (below) for the mapper's two inputs. */
type SignoffRow = SignoffRequestRow & { assigned_to: string; active: boolean };
type SubmissionRow = SignoffSubmissionRow & { id: string };

serve(async (req: Request): Promise<Response> => {
  // Calendar clients fetch server-side, so CORS only matters for browser previews of the URL.
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") {
    return textResponse(405, "Method not allowed", { ...cors, Allow: "GET, OPTIONS" });
  }

  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!TOKEN_RE.test(token)) return notFound(cors);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Resolve the token with the service role (calendar_tokens is owner-only under RLS).
    const { data: tokenRow, error: tokenErr } = await supabase
      .from("calendar_tokens")
      .select("id, user_id, building_id, revoked_at")
      .eq("token", token)
      .maybeSingle();
    if (tokenErr) throw tokenErr;
    const scope = tokenRow as TokenRow | null;
    if (!scope || scope.revoked_at) return notFound(cors);

    // 2. Apply the owner's access, exactly as can_access_building would for a session.
    let buildingIds: string[];
    if (scope.building_id) {
      const { data: allowed, error: accessErr } = await supabase.rpc("user_can_access_building", {
        p_user: scope.user_id,
        p_building: scope.building_id,
      });
      if (accessErr) throw accessErr;
      if (allowed !== true) return notFound(cors);
      buildingIds = [scope.building_id];
    } else {
      // The RPC checks `deactivated` for building tokens; a user token has no building to
      // check against, so the same rule is applied here: a deactivated owner's feed is gone.
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("deactivated")
        .eq("id", scope.user_id)
        .maybeSingle();
      if (profileErr) throw profileErr;
      if (!profile || (profile as { deactivated: boolean | null }).deactivated === true) return notFound(cors);

      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", scope.user_id);
      if (rolesErr) throw rolesErr;
      const portfolioWide = ((roles ?? []) as { role: string }[]).some((r) => ADMIN_ROLES.has(r.role));

      if (portfolioWide) {
        const { data, error } = await supabase.from("buildings").select("id").limit(ROW_CAP);
        if (error) throw error;
        buildingIds = ((data ?? []) as { id: string }[]).map((b) => b.id);
      } else {
        const { data, error } = await supabase
          .from("user_buildings")
          .select("building_id")
          .eq("user_id", scope.user_id)
          .limit(ROW_CAP);
        if (error) throw error;
        buildingIds = ((data ?? []) as { building_id: string }[]).map((b) => b.building_id);
      }
    }

    // 3. One window for every source (90 days back, 180 forward, on the SAST date) except
    // tasks, which use the narrower TASK_* window.
    const today = todayInOperatingTz();
    const from = shiftDate(today, -DAYS_BACK);
    const to = shiftDate(today, DAYS_FORWARD);
    const taskFrom = shiftDate(today, -TASK_DAYS_BACK);
    const taskTo = shiftDate(today, TASK_DAYS_FORWARD);
    // Sign-off due dates are instants; the window edges are SAST midnight (no DST in ZA).
    const fromIso = new Date(`${from}T00:00:00+02:00`).toISOString();
    const toIso = new Date(`${to}T23:59:59.999+02:00`).toISOString();

    // 4. Building names from one read; an unknown id maps to null and the mappers cope.
    const names = new Map<string, string>();
    if (buildingIds.length > 0) {
      const { data, error } = await supabase
        .from("buildings")
        .select("id, name")
        .in("id", buildingIds)
        .limit(ROW_CAP);
      if (error) throw error;
      for (const b of (data ?? []) as BuildingRow[]) names.set(b.id, b.name);
    }
    const nameOf = (id: string | null) => (id ? names.get(id) ?? null : null);

    // 5. The seven sources. Building-scoped ones are skipped outright when the owner has no
    // buildings; sign-offs are personal and only ever appear on a USER token.
    const events: CalendarEvent[] = [];
    const counts = { tasks: 0, issues: 0, documents: 0, assets: 0, ppm: 0, signoffs: 0, reports: 0 };
    const push = (e: CalendarEvent | null, key: keyof typeof counts) => {
      if (!e) return;
      events.push(e);
      counts[key]++;
    };
    // A source that returned exactly its cap has (almost certainly) been cut short. Every dated
    // source is ordered by its date column, so what is dropped is the far end of the window —
    // and for tasks the user is told (see below) rather than silently short-changed.
    const truncated: Partial<Record<keyof typeof counts, true>> = {};
    const noteCap = (key: keyof typeof counts, rows: unknown[] | null, cap: number) => {
      if ((rows?.length ?? 0) >= cap) truncated[key] = true;
    };

    if (buildingIds.length > 0) {
      const [tasks, issues, documents, assets, ppm, reports] = await Promise.all([
        supabase
          .from("task_instances")
          .select("id, task_name, due_date, status, building_id")
          .in("building_id", buildingIds)
          .in("status", TASK_STATUSES)
          .gte("due_date", taskFrom)
          .lte("due_date", taskTo)
          .order("due_date")
          .limit(TASK_ROW_CAP),
        supabase
          .from("issues")
          .select("id, title, deadline, status, building_id")
          .in("building_id", buildingIds)
          .gte("deadline", from)
          .lte("deadline", to)
          .order("deadline")
          .limit(ROW_CAP),
        supabase
          .from("building_documents")
          .select("id, name, expiry_date, building_id")
          .in("building_id", buildingIds)
          .gte("expiry_date", from)
          .lte("expiry_date", to)
          .order("expiry_date")
          .limit(ROW_CAP),
        supabase
          .from("building_assets")
          .select("id, name, next_service_date, building_id")
          .in("building_id", buildingIds)
          .gte("next_service_date", from)
          .lte("next_service_date", to)
          .order("next_service_date")
          .limit(ROW_CAP),
        // PPM rows hold a jsonb of month cells; the mapper expands them and the window is
        // applied afterwards, so no date filter or date order is possible at the query.
        supabase
          .from("ppm_services")
          .select("id, building_id, service_name, months, report_id")
          .in("building_id", buildingIds)
          .limit(ROW_CAP),
        // Fortress reports live in the same database, so the same client reads them.
        supabase
          .from("reports")
          .select("id, building_id, report_period, status")
          .in("building_id", buildingIds)
          .gte("report_period", from)
          .lte("report_period", to)
          .order("report_period")
          .limit(ROW_CAP),
      ]);
      for (const r of [tasks, issues, documents, assets, ppm, reports]) {
        if (r.error) throw r.error;
      }
      noteCap("tasks", tasks.data, TASK_ROW_CAP);
      noteCap("issues", issues.data, ROW_CAP);
      noteCap("documents", documents.data, ROW_CAP);
      noteCap("assets", assets.data, ROW_CAP);
      noteCap("ppm", ppm.data, ROW_CAP);
      noteCap("reports", reports.data, ROW_CAP);

      for (const row of (tasks.data ?? []) as TaskRow[]) push(taskEvent(row, nameOf(row.building_id), today), "tasks");
      for (const row of (issues.data ?? []) as IssueRow[]) push(issueEvent(row, nameOf(row.building_id), today), "issues");
      for (const row of (documents.data ?? []) as DocumentRow[]) {
        push(documentEvent(row, nameOf(row.building_id), today), "documents");
      }
      for (const row of (assets.data ?? []) as AssetRow[]) push(assetEvent(row, nameOf(row.building_id), today), "assets");
      for (const row of (ppm.data ?? []) as PpmRow[]) {
        for (const e of inRange(ppmEvents(row, nameOf(row.building_id), today), from, to)) push(e, "ppm");
      }
      for (const row of (reports.data ?? []) as ReportRow[]) {
        push(reportEvent(row, nameOf(row.building_id), today), "reports");
      }

      // Tasks were cut at the cap: rows are date-ordered, so everything missing sits at the far
      // end of the task window. One all-day marker on that last day says so and links to the
      // in-app calendar, which has no such cap.
      if (truncated.tasks) {
        events.push({
          id: "task-truncated",
          kind: "task",
          title: "Calendar truncated — open Building Ops",
          date: taskTo,
          buildingId: null,
          buildingName: null,
          href: "/calendar",
          status: "open",
          entityId: "truncated",
        });
      }
    }

    if (!scope.building_id) {
      const { data: requests, error: reqErr } = await supabase
        .from("form_signoff_requests")
        .select("id, submission_id, assigned_to, due_at, status, active")
        .eq("assigned_to", scope.user_id)
        .eq("active", true)
        .gte("due_at", fromIso)
        .lte("due_at", toIso)
        .order("due_at")
        .limit(ROW_CAP);
      if (reqErr) throw reqErr;
      noteCap("signoffs", requests, ROW_CAP);
      const signoffs = (requests ?? []) as SignoffRow[];
      const submissions = new Map<string, SubmissionRow>();
      const submissionIds = [...new Set(signoffs.map((r) => r.submission_id))];
      if (submissionIds.length > 0) {
        const { data, error } = await supabase
          .from("form_submissions")
          .select("id, form_name, building_id")
          .in("id", submissionIds)
          .limit(ROW_CAP);
        if (error) throw error;
        for (const s of (data ?? []) as SubmissionRow[]) submissions.set(s.id, s);
        // Sign-offs are assigned to a person, not scoped by building, so a submission's building
        // may sit outside the names read in step 4. That name is deliberately NOT fetched: the
        // owner's in-app session could not see it either, and the mapper accepts a null name.
      }
      for (const r of signoffs) {
        const submission = submissions.get(r.submission_id);
        push(signoffEvent(r, submission, nameOf(submission?.building_id ?? null), today), "signoffs");
      }
    }

    // 6. Render (renderIcs sorts, so equal data is byte-identical between fetches bar DTSTAMP).
    const buildingName = scope.building_id ? nameOf(scope.building_id) : null;
    const name = scope.building_id ? `Building Ops · ${buildingName ?? "Building"}` : "Building Ops · My calendar";
    const body = renderIcs(events, { name, appUrl: APP_URL });

    // 7. Record the fetch without holding the response for it. Supabase's edge runtime keeps a
    // waitUntil promise alive after the response is sent; the `.then` alone starts the query.
    const touch = supabase
      .from("calendar_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", scope.id)
      .then(({ error }) => {
        if (error) console.warn("ics-feed: last_used_at update failed:", error.message ?? error);
      });
    const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    runtime?.waitUntil?.(touch);

    // Counts only — never the token, never the owner. `truncated` names each source that hit
    // its cap (absent when none did).
    console.log("ics-feed: served", {
      scope: scope.building_id ? "building" : "user",
      buildings: buildingIds.length,
      events: events.length,
      ...counts,
      ...(Object.keys(truncated).length > 0 ? { truncated } : {}),
    });

    return new Response(body, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="building-ops.ics"',
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    // The message may name a table or column, never the token (it is not interpolated anywhere).
    console.error("ics-feed error:", error instanceof Error ? error.message : error);
    return textResponse(500, "Calendar feed unavailable", cors);
  }
});
