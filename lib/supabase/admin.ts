import { createClient } from "@supabase/supabase-js";

function getEnvAny(names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing env: ${names.join(" or ")}`);
}

function getJwtRole(jwt: string) {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1];
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const json = Buffer.from(padded, "base64").toString("utf8");
  const obj = JSON.parse(json) as { role?: unknown };
  return typeof obj.role === "string" ? obj.role : null;
}

export function supabaseAdmin() {
  const url = getEnvAny(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");
  const role = getJwtRole(serviceRoleKey);
  if (role && role !== "service_role") {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY must be service_role key (got ${role})`);
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
