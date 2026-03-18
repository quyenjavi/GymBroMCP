import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

function getEnvAny(names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing env: ${names.join(" or ")}`);
}

export async function middleware(request: NextRequest) {
  const supabaseUrl = getEnvAny(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const supabaseAnonKey = getEnvAny(["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);

  let response = NextResponse.next({
    request: { headers: request.headers }
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const cookie of cookiesToSet) {
          response.cookies.set({ name: cookie.name, value: cookie.value, ...cookie.options });
        }
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (!user && pathname.startsWith("/chat")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/chat";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/chat/:path*", "/login"]
};
