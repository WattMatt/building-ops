// Caller validation for functions that accept BOTH a cron secret and a user JWT (report-distribution)
// or a public token and a user JWT (report-share create). Mirrors set-user-status: the JWT is
// validated by asking Auth with an anon client carrying the caller's header; roles/access are then
// answered by the service role (user_roles is not readable across users under RLS).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/** The service-role client every function builds; untyped schema, so rows read as `any`. */
export type Admin = ReturnType<typeof createClient>;

/** The signed-in user behind `Authorization: Bearer <jwt>`, or null when there is no valid session. */
export async function callerId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  return error || !user ? null : user.id;
}

/** Active profile with at least one admin or manager role row (user_roles carries several rows per user). */
export async function isAdminOrManager(admin: Admin, userId: string): Promise<boolean> {
  const { data: profile } = await admin.from("profiles").select("deactivated").eq("id", userId).maybeSingle();
  if (!profile || profile.deactivated === true) return false;
  const { data } = await admin.from("user_roles").select("role").eq("user_id", userId).in("role", ["admin", "manager"]).limit(1);
  return (data?.length ?? 0) > 0;
}

/** `user_can_access_building` (service-role only) — the same rule `can_access_building` applies to a session. */
export async function canAccessBuilding(admin: Admin, userId: string, buildingId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("user_can_access_building", { p_user: userId, p_building: buildingId });
  return !error && data === true;
}
