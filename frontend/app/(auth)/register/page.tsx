"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authService } from "../../../services/auth";
import { decodeTokenRole, resolveDashboardRoute } from "../../../utils/auth";

const formatDetail = (detail: unknown): string | null => {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          const maybeMsg = (item as { msg?: unknown }).msg;
          return typeof maybeMsg === "string" ? maybeMsg : null;
        }
        return null;
      })
      .filter((item): item is string => Boolean(item));
    return messages.length ? messages.join("; ") : null;
  }
  if (detail && typeof detail === "object") {
    if ("msg" in detail) {
      const maybeMsg = (detail as { msg?: unknown }).msg;
      if (typeof maybeMsg === "string") return maybeMsg;
    }
    return JSON.stringify(detail);
  }
  return null;
};

const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") {
    return "Unable to register.";
  }

  const maybeAny = error as {
    response?: { data?: { detail?: unknown; error?: unknown } };
    message?: string;
  };
  const detailMessage = formatDetail(maybeAny.response?.data?.detail);
  const errorMessage = formatDetail(maybeAny.response?.data?.error);

  return (
    detailMessage ||
    errorMessage ||
    maybeAny.message ||
    "Unable to register."
  );
};

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await authService.register({ email, password });
      const loginResponse = await authService.login({ email, password });
      const token = loginResponse.data?.access_token;
      if (!token) {
        setSuccess("Registered. Please log in.");
        return;
      }

      document.cookie = `access_token=${token}; path=/; max-age=86400; samesite=lax`;
      const role = decodeTokenRole(token);
      router.push(resolveDashboardRoute(role));
    } catch (errorResponse) {
      setError(getErrorMessage(errorResponse));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-16">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Create Account
          </p>
          <h1 className="text-3xl font-semibold text-white">
            Set up your access
          </h1>
          <p className="text-sm text-slate-400">
            Create your student account (email or matric number).
          </p>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {success}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="rounded-3xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-2xl shadow-slate-950/60"
        >
          <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            Email or Matric Number
          </label>
          <input
            className="mt-3 w-full rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30"
            type="text"
            placeholder="you@school.edu or U23CS1001"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label className="mt-6 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            Password
          </label>
          <input
            className="mt-3 w-full rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30"
            type="password"
            placeholder="Minimum 6 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Creating..." : "Create Account"}
          </button>
          <p className="mt-4 text-center text-xs text-slate-400">
            Already registered?{" "}
            <a href="/login" className="font-semibold text-indigo-300 hover:text-indigo-200">
              Login
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
