// Pure scheduling and copy rules for report distribution (spec §5.7). No I/O and NO imports
// (like _shared/calendar.ts): it is unit-tested from vitest (src/lib/distributionPlan.test.ts,
// pinned by docs/fixtures/distribution-plan.json) and re-exported to the web app by
// src/lib/reportSchedule.ts, and neither runtime resolves a `./x.ts` import the other way.

/** Same escaping as _shared/email.ts escapeText, inlined so this module stays import-free. */
export function escapeText(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type ReportType = "ops_monthly" | "cm_monthly" | "annual_inspection";
export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  ops_monthly: "Monthly OPS Report",
  cm_monthly: "Monthly CM Report",
  annual_inspection: "Annual Inspection Report",
};
export const EXPIRY_DAYS_DEFAULT = 30;
export const EXPIRY_DAYS_ALLOWED = [7, 30, 90] as const;
export const PASSCODE_MIN = 4;
export const PASSCODE_MAX = 64;
/** 32 random bytes as base64url without padding — the same shape as calendar_tokens. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface ScheduleTiming {
  send_day: number;
  remind_days_before: number;
}
export type PlanAction =
  | { action: "send"; period: string }
  | { action: "remind"; period: string }
  | { action: "none" };

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` ± n days, UTC arithmetic on a date-only value. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
/** First day of the month containing `ymd`. */
export function monthStart(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}
/** First day of the month before the one containing `ymd`. */
export function previousMonthStart(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`;
}
/** First day of the month after the one containing `ymd`. */
export function nextMonthStart(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
}
/** The date a report for `period` (YYYY-MM-01) is sent: send_day of the following month. send_day ≤ 28, so always valid. */
export function sendDateFor(period: string, timing: ScheduleTiming): string {
  return `${nextMonthStart(period).slice(0, 7)}-${pad(timing.send_day)}`;
}
export function reminderDateFor(period: string, timing: ScheduleTiming): string {
  return addDays(sendDateFor(period, timing), -timing.remind_days_before);
}
/**
 * What a schedule does on `today` (SAST date). Send wins over remind when they coincide
 * (remind_days_before = 0). The reminder for next month's send date can fall in this month
 * (send_day 2, remind 3 → the 29th/30th), so both this month's and next month's send dates are checked.
 */
export function planFor(today: string, timing: ScheduleTiming): PlanAction {
  const thisSend = `${today.slice(0, 7)}-${pad(timing.send_day)}`;
  if (today === thisSend) return { action: "send", period: previousMonthStart(today) };
  if (today === addDays(thisSend, -timing.remind_days_before)) {
    return { action: "remind", period: previousMonthStart(thisSend) };
  }
  const nextSend = `${nextMonthStart(today).slice(0, 7)}-${pad(timing.send_day)}`;
  if (today === addDays(nextSend, -timing.remind_days_before)) {
    return { action: "remind", period: previousMonthStart(nextSend) };
  }
  return { action: "none" };
}
/** Next send and reminder dates on or after `today`, for the Settings card. */
export function nextRunDates(today: string, timing: ScheduleTiming): { nextSend: string; nextReminder: string; period: string } {
  for (const base of [previousMonthStart(today), monthStart(today), nextMonthStart(today)]) {
    const send = sendDateFor(base, timing);
    const remind = reminderDateFor(base, timing);
    if (send >= today) return { nextSend: send, nextReminder: remind, period: base };
  }
  const base = nextMonthStart(nextMonthStart(today));
  return { nextSend: sendDateFor(base, timing), nextReminder: reminderDateFor(base, timing), period: base };
}
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface DistributionCopyInput {
  buildingName: string;
  reportType: ReportType;
  period: string;
  title: string;
  compliancePct: number | null;
  expiresAt: string;
  appName: string;
}
/**
 * Subject/heading are plain text (renderEmail escapes them); bodyHtml is markup, so every
 * dynamic value in it goes through escapeText.
 */
export function distributionCopy(i: DistributionCopyInput): { subject: string; heading: string; bodyHtml: string; ctaText: string } {
  const label = REPORT_TYPE_LABELS[i.reportType];
  const when = periodLabel(i.period);
  const compliance = i.compliancePct === null ? "" : ` Compliance at ${Math.round(i.compliancePct)}%.`;
  const expires = new Date(i.expiresAt).toLocaleDateString("en-ZA", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg",
  });
  return {
    subject: `${label} — ${i.buildingName} — ${when}`,
    heading: `${label}: ${i.buildingName}`,
    bodyHtml:
      `<p style="margin:0 0 12px;">The approved ${escapeText(label.toLowerCase())} for <strong>${escapeText(i.buildingName)}</strong> (${escapeText(when)}) is ready.${escapeText(compliance)}</p>` +
      `<p style="margin:0 0 12px;">The link opens the issued PDF and expires on ${escapeText(expires)}.</p>`,
    ctaText: "Open the report",
  };
}
export function reminderCopy(i: {
  buildingName: string;
  reportType: ReportType;
  period: string;
  sendDate: string;
  exists: boolean;
  status: string | null;
}): { title: string; body: string } {
  const label = REPORT_TYPE_LABELS[i.reportType];
  const due = new Date(`${i.sendDate}T00:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "long", timeZone: "UTC" });
  const state = !i.exists ? "has not been started" : `is ${i.status?.replace(/_/g, " ")}`;
  return {
    title: `Report due soon: ${label} — ${i.buildingName} ${periodLabel(i.period)}`,
    body: `This report ${state}. It is distributed on ${due}; approve it before then so the final PDF goes out.`,
  };
}
/** Deno + browsers: 32 random bytes as base64url without padding (43 chars). Same as src/lib/calendarTokens.mintToken. */
export function mintShareToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** hex sha256(passcode || token || salt) — the salt (SHARE_SALT) never leaves the function. */
export async function passcodeHash(passcode: string, token: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${passcode}${token}${salt}`));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
