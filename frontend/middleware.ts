import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ROLE_ADMIN = "ADMIN";
const ROLE_LECTURER = "LECTURER";
const ROLE_STUDENT = "STUDENT";

const getTokenFromRequest = (request: NextRequest) => {
  const cookieToken =
    request.cookies.get("access_token")?.value ||
    request.cookies.get("token")?.value ||
    request.cookies.get("jwt")?.value;
  if (cookieToken) return cookieToken;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.replace("Bearer ", "").trim();
  }

  return request.nextUrl.searchParams.get("token") || "";
};

const decodeRoleFromToken = (token: string) => {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  const payload = parts[1]
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");

  try {
    const data = JSON.parse(atob(payload));
    const role = data?.role || data?.user_role || data?.type || null;
    return typeof role === "string" ? role.toUpperCase() : null;
  } catch {
    return null;
  }
};

const isDashboardPath = (pathname: string) => pathname.startsWith("/dashboard");

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isDashboardPath(pathname)) {
    return NextResponse.next();
  }

  const token = getTokenFromRequest(request);
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const role = decodeRoleFromToken(token);
  if (!role) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/dashboard" || pathname === "/dashboard/") {
    const destination =
      role === ROLE_ADMIN
        ? "/dashboard/admin"
        : role === ROLE_LECTURER
          ? "/dashboard/lecturer"
          : "/dashboard/student";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  if (pathname.startsWith("/dashboard/admin") && role !== ROLE_ADMIN) {
    return NextResponse.redirect(new URL("/dashboard/student", request.url));
  }

  if (pathname.startsWith("/dashboard/lecturer") && role !== ROLE_LECTURER) {
    return NextResponse.redirect(new URL("/dashboard/student", request.url));
  }

  if (pathname.startsWith("/dashboard/settings") && role !== ROLE_ADMIN) {
    return NextResponse.redirect(new URL("/dashboard/student", request.url));
  }

  if (pathname.startsWith("/dashboard/student") && role !== ROLE_STUDENT) {
    const destination = role === ROLE_ADMIN ? "/dashboard/admin" : "/dashboard/lecturer";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
