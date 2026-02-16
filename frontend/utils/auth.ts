export const decodeBase64Url = (segment: string): string | null => {
    if (!segment) return null;
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    try {
        return atob(padded);
    } catch {
        return null;
    }
};

export const decodeTokenRole = (token: string): string | null => {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payloadRaw = decodeBase64Url(parts[1]);
    if (!payloadRaw) return null;
    try {
        const payload = JSON.parse(payloadRaw);
        const rawRole = payload?.role || payload?.user_role || payload?.type || null;
        return typeof rawRole === "string" ? rawRole.toUpperCase() : null;
    } catch {
        return null;
    }
};

export const resolveDashboardRoute = (role: string | null): string => {
    if (role === "ADMIN") return "/dashboard/admin";
    if (role === "LECTURER") return "/dashboard/lecturer";
    return "/dashboard/student";
};

export const getAuthToken = (): string => {
    if (typeof document === "undefined") return "";
    const cookies = document.cookie.split("; ").map((item) => item.trim());
    const tokenCookie = cookies.find(
        (cookie) =>
            cookie.startsWith("access_token=") ||
            cookie.startsWith("token=") ||
            cookie.startsWith("jwt=")
    );
    if (tokenCookie) {
        return tokenCookie.split("=")[1] || "";
    }
    if (typeof localStorage !== "undefined") {
        return (
            localStorage.getItem("access_token") ||
            localStorage.getItem("token") ||
            localStorage.getItem("jwt") ||
            ""
        );
    }
    return "";
};
