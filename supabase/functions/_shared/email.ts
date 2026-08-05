// Shared, organization-branded transactional email template used by the auth
// emails (invite, password reset, fresh setup link). Imported by sibling
// functions via `../_shared/email.ts`. The leading-underscore dir is not
// deployed as its own function; it is bundled into each importer.

export interface Branding {
  appName: string;
  logoUrl: string | null;
  color: string; // hex, e.g. #006d8f
}

const DEFAULTS: Branding = { appName: "Building Ops", logoUrl: null, color: "#006d8f" };

/**
 * Pull branding from the single organizations row. Uses select('*') so a
 * missing column can never throw (we read fields defensively) — and always
 * falls back to sane defaults.
 */
export async function loadBranding(admin: {
  from: (t: string) => any;
}): Promise<Branding> {
  try {
    const { data } = await admin.from("organizations").select("*").limit(1).maybeSingle();
    const hex = typeof data?.primary_color === "string" && /^#?[0-9a-f]{6}$/i.test(data.primary_color)
      ? (data.primary_color.startsWith("#") ? data.primary_color : `#${data.primary_color}`)
      : DEFAULTS.color;
    return {
      appName: (data?.name && String(data.name)) || DEFAULTS.appName,
      logoUrl: (data?.logo_url && String(data.logo_url)) || null,
      color: hex,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function escapeAttr(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Escape a value for interpolation into the HTML *text* of an email body.
 * `renderEmail` does not escape `bodyHtml` (callers build markup there), so
 * every dynamic value spliced into a body block must go through this first.
 */
export function escapeText(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a polished, email-client-safe (table-based, inline styles) message.
 * `bodyHtml` is the pre-built paragraph block (caller controls copy).
 */
export function renderEmail(opts: {
  branding: Branding;
  preheader?: string;
  heading: string;
  greeting?: string;
  bodyHtml: string;
  ctaText: string;
  ctaUrl: string;
  footnote?: string;
}): string {
  const { branding, preheader, heading, greeting, bodyHtml, ctaText, ctaUrl, footnote } = opts;
  const name = escapeAttr(branding.appName);
  const color = branding.color;
  // Logo (any aspect ratio) sits on a white chip so it stays visible on the
  // branded header colour; height-constrained with natural width. Falls back to
  // the app name as a wordmark when no logo is set.
  const logo = branding.logoUrl
    ? `<span style="display:inline-block;background:#ffffff;border-radius:8px;padding:7px 11px;line-height:0;">
         <img src="${escapeAttr(branding.logoUrl)}" alt="${name}" style="height:30px;width:auto;max-width:190px;display:inline-block;vertical-align:middle;" />
       </span>`
    : `<span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.01em;">${name}</span>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeAttr(preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e8eb;box-shadow:0 1px 2px rgba(16,24,40,0.04);">
      <tr><td style="background:${color};padding:20px 32px;">${logo}</td></tr>
      <tr><td style="padding:32px 32px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
        <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:700;color:#111827;">${escapeAttr(heading)}</h1>
        ${greeting ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#374151;">${escapeAttr(greeting)}</p>` : ""}
        <div style="font-size:14px;line-height:1.6;color:#374151;">${bodyHtml}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;"><tr><td style="border-radius:10px;background:${color};">
          <a href="${escapeAttr(ctaUrl)}" style="display:inline-block;padding:13px 28px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeAttr(ctaText)}</a>
        </td></tr></table>
        ${footnote ? `<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">${footnote}</p>` : ""}
        <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#9ca3af;word-break:break-all;">If the button doesn't work, copy this link:<br><a href="${escapeAttr(ctaUrl)}" style="color:${color};">${escapeAttr(ctaUrl)}</a></p>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid #eef0f2;background:#fafbfc;">
        <p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#9ca3af;">Sent by ${name}. If you weren't expecting this email, you can safely ignore it.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
