/**
 * Organization-level settings (organizations.settings jsonb, R4a §5.2). One object, parsed with defaults so
 * a missing or malformed key never reaches a component: every consumer gets a complete OrgSettings.
 * The SLA defaults are the same numbers as public.org_sla_hours() in 2026-09-14_01 — change both together.
 */
import type { Json } from '@/integrations/supabase/types';

/** A jsonb object as PostgREST returns it: every value is itself JSON, so it can be written straight back. */
export type JsonObject = { [key: string]: Json | undefined };

export const FEATURE_NAMES = ['share_links', 'report_schedules', 'tenant_intake'] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

export const FEATURE_LABELS: Record<FeatureName, { label: string; description: string }> = {
  share_links: { label: 'Share links', description: 'Expiring links that let an external recipient open an issued report PDF.' },
  report_schedules: { label: 'Report schedules', description: 'Reminders before period close and emailed distribution of approved reports.' },
  tenant_intake: { label: 'Tenant intake', description: 'A per-building QR form tenants use to report a problem without a login.' },
};

export const SLA_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type SlaPriority = (typeof SLA_PRIORITIES)[number];
export type SlaHours = Record<SlaPriority, number>;

export interface OrgSettings {
  sla_hours: SlaHours;
  features: Record<FeatureName, boolean>;
  /** Day of the following month (1–28) by which a monthly report must be approved. */
  report_due_day: number;
  /** Display name for distribution emails (R4b); null = the organization name. */
  distribution_from: string | null;
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  sla_hours: { critical: 4, high: 24, medium: 72, low: 168 },
  features: { share_links: false, report_schedules: false, tenant_intake: false },
  report_due_day: 7,
  distribution_from: null,
};

/** Hours are whole numbers between 1 and one year; the SQL side accepts any positive numeric. */
export const SLA_HOURS_MIN = 1;
export const SLA_HOURS_MAX = 8760;

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** A plain object or `{}` — never an array, null or a scalar. Used by the save path to merge into the stored jsonb. */
export function obj(v: unknown): JsonObject {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};
}

/** Never throws: anything unreadable falls back to the default for that key. */
export function parseOrgSettings(raw: unknown): OrgSettings {
  const o = obj(raw);
  const sla = obj(o.sla_hours);
  const feats = obj(o.features);
  const d = DEFAULT_ORG_SETTINGS;
  return {
    sla_hours: {
      critical: num(sla.critical, d.sla_hours.critical, SLA_HOURS_MIN, SLA_HOURS_MAX),
      high: num(sla.high, d.sla_hours.high, SLA_HOURS_MIN, SLA_HOURS_MAX),
      medium: num(sla.medium, d.sla_hours.medium, SLA_HOURS_MIN, SLA_HOURS_MAX),
      low: num(sla.low, d.sla_hours.low, SLA_HOURS_MIN, SLA_HOURS_MAX),
    },
    features: {
      share_links: feats.share_links === true,
      report_schedules: feats.report_schedules === true,
      tenant_intake: feats.tenant_intake === true,
    },
    report_due_day: Math.round(num(o.report_due_day, d.report_due_day, 1, 28)),
    distribution_from:
      typeof o.distribution_from === 'string' && o.distribution_from.trim() ? o.distribution_from.trim().slice(0, 64) : null,
  };
}
