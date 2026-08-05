// Shared CORS policy for the edge functions. The allowlist is the canonical
// apex (APP_URL, which is not set in every environment — hence the default),
// its www. form, the local dev servers, and Vercel preview deployments. The
// caller's Origin is echoed back only on a match; `*` is never emitted.

const APP_URL = (Deno.env.get("APP_URL") ?? "https://buildingops.app").replace(/\/+$/, "");

const FALLBACK_ORIGIN = "https://buildingops.app";

const LOCAL_ORIGINS = ["http://localhost:5173", "http://localhost:3000"];

const ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";

function canonicalOrigin(): string {
  try {
    const url = new URL(APP_URL);
    // The apex is canonical whichever form APP_URL was written in.
    url.hostname = url.hostname.replace(/^www\./, "");
    return url.origin;
  } catch {
    return FALLBACK_ORIGIN;
  }
}

function wwwForm(origin: string): string | null {
  try {
    const url = new URL(origin);
    url.hostname = `www.${url.hostname}`;
    return url.origin;
  } catch {
    return null;
  }
}

function isAllowed(origin: string): boolean {
  const apex = canonicalOrigin();
  if (origin === apex) return true;
  if (origin === wwwForm(apex)) return true;
  if (LOCAL_ORIGINS.includes(origin)) return true;
  try {
    const url = new URL(origin);
    // Vercel preview deployments only: exact origin, https, default port.
    return url.origin === origin &&
      url.protocol === "https:" &&
      url.port === "" &&
      url.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

export function allowedOrigin(req: Request): string {
  const origin = req.headers.get("Origin");
  return origin && isAllowed(origin) ? origin : canonicalOrigin();
}

export function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req),
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Vary": "Origin",
  };
}
