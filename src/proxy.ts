import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Proxy (Next 16 rename of middleware): coarse page-level protection and
 * role routing. API handlers independently enforce auth + RBAC against the
 * database (defence in depth) — this layer only gates page navigation.
 */

const PUBLIC_PREFIXES = [
  "/login",
  "/reset-password",
  "/share/",
  "/api/auth/login",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/share/",
  "/api/health",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get("session")?.value;
  let role: string | null = null;
  if (token) {
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(process.env.AUTH_SECRET || ""),
      );
      role = (payload.role as string) ?? null;
    } catch {
      role = null;
    }
  }

  // APIs return 401 JSON rather than redirecting.
  if (pathname.startsWith("/api/")) {
    if (!role) {
      return NextResponse.json(
        { error: { message: "Authentication required", code: "UNAUTHENTICATED" } },
        { status: 401 },
      );
    }
    return NextResponse.next();
  }

  if (!role) {
    const login = new URL("/login", req.url);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // Role-based landing: drivers live under /driver, admins everywhere else.
  if (pathname.startsWith("/driver") && role !== "DRIVER" && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (!pathname.startsWith("/driver") && role === "DRIVER") {
    return NextResponse.redirect(new URL("/driver", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)).*)"],
};
