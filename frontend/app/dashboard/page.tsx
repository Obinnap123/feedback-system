import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const decodeRoleFromToken = (token: string | undefined) => {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    );
    const rawRole = payload?.role || payload?.user_role || payload?.type || null;
    return typeof rawRole === "string" ? rawRole.toUpperCase() : null;
  } catch {
    return null;
  }
};

export default async function DashboardIndexPage() {
  const cookieStore = await cookies();
  const token =
    cookieStore.get("access_token")?.value ||
    cookieStore.get("token")?.value ||
    cookieStore.get("jwt")?.value;
  const role = decodeRoleFromToken(token);

  if (role === "ADMIN") {
    redirect("/dashboard/admin");
  }
  if (role === "LECTURER") {
    redirect("/dashboard/lecturer");
  }
  if (role === "STUDENT") {
    redirect("/dashboard/student");
  }
  redirect("/login");
}
