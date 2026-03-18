import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

function getEnvAny(names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing env: ${names.join(" or ")}`);
}

export async function supabaseServer() {
  const url = getEnvAny(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const key = getEnvAny(["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const cookie of cookiesToSet) {
          cookieStore.set({ name: cookie.name, value: cookie.value, ...cookie.options });
        }
      }
    }
  });
}
