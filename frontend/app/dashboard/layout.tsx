"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  GraduationCap,
  LayoutDashboard,
  BarChart3,
  Settings,
  MessageSquare,
  Menu,
  X,
} from "lucide-react";

const readRoleFromCookie = (): string | null => {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie.split("; ").map((item) => item.trim());
  const tokenCookie = cookies.find(
    (cookie) =>
      cookie.startsWith("access_token=") ||
      cookie.startsWith("token=") ||
      cookie.startsWith("jwt="),
  );
  const token = tokenCookie?.split("=")[1];
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(atob(parts[1]));
    const rawRole = payload?.role || payload?.user_role || payload?.type || null;
    return typeof rawRole === "string" ? rawRole.toUpperCase() : null;
  } catch {
    return null;
  }
};

const subscribeNoop = () => () => {};

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const role = useSyncExternalStore(
    subscribeNoop,
    readRoleFromCookie,
    () => null,
  );

  const closeSidebar = () => setSidebarOpen(false);
  const toggleSidebar = () => setSidebarOpen((open) => !open);

  const showAdmin = role === "ADMIN";
  const showLecturer = role === "LECTURER";
  const showStudent = role === "STUDENT";

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
      <div className="relative min-h-screen overflow-x-hidden">
        <header className="flex items-center justify-between border-b border-slate-800/80 bg-slate-950/80 px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-200">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Feedback System</p>
              <p className="text-xs text-slate-400">Dashboard</p>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleSidebar}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-800/80 text-slate-200 transition hover:border-indigo-400/60 hover:text-white"
            aria-label={sidebarOpen ? "Close menu" : "Open menu"}
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </header>

        <div
          className={`fixed inset-0 z-40 bg-slate-950/70 transition lg:hidden ${
            sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={closeSidebar}
          aria-hidden="true"
        />

        <aside
          className={`fixed inset-y-0 left-0 z-50 w-72 border-r border-slate-800/80 bg-slate-900 transition-transform lg:w-64 lg:translate-x-0 lg:overflow-y-auto ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-full flex-col px-5 py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-200">
                  <GraduationCap className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Feedback System</p>
                  <p className="text-xs text-slate-400">Dashboard</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeSidebar}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800/80 text-slate-200 transition hover:border-indigo-400/60 hover:text-white lg:hidden"
                aria-label="Close sidebar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav className="mt-8 flex flex-col gap-2 text-sm">
              {showAdmin && (
                <Link
                  href="/dashboard/admin"
                  onClick={closeSidebar}
                  className="flex items-center gap-3 rounded-xl px-3 py-2 text-slate-200 transition hover:bg-slate-800/60 hover:text-white"
                >
                  <LayoutDashboard className="h-4 w-4 text-indigo-300" />
                  Overview
                </Link>
              )}
              {(showLecturer || showAdmin) && (
                <Link
                  href="/dashboard/lecturer"
                  onClick={closeSidebar}
                  className="flex items-center gap-3 rounded-xl px-3 py-2 text-slate-200 transition hover:bg-slate-800/60 hover:text-white"
                >
                  <BarChart3 className="h-4 w-4 text-indigo-300" />
                  Reports
                </Link>
              )}
              {showStudent && (
                <Link
                  href="/dashboard/student"
                  onClick={closeSidebar}
                  className="flex items-center gap-3 rounded-xl px-3 py-2 text-slate-200 transition hover:bg-slate-800/60 hover:text-white"
                >
                  <MessageSquare className="h-4 w-4 text-indigo-300" />
                  Feedback
                </Link>
              )}
              {showAdmin && (
                <Link
                  href="/dashboard/settings"
                  onClick={closeSidebar}
                  className="flex items-center gap-3 rounded-xl px-3 py-2 text-slate-200 transition hover:bg-slate-800/60 hover:text-white"
                >
                  <Settings className="h-4 w-4 text-indigo-300" />
                  Settings
                </Link>
              )}
            </nav>

            <div className="mt-auto rounded-2xl border border-slate-800/70 bg-slate-950/60 p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                Signed In
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-200">
                Dashboard User
              </p>
              <Link
                href="/login"
                onClick={closeSidebar}
                className="mt-4 inline-flex w-full items-center justify-center rounded-xl border border-slate-700/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-300 transition hover:border-indigo-400/60 hover:text-white"
              >
                Logout
              </Link>
            </div>
          </div>
        </aside>

        <main className="bg-slate-950/70 lg:pl-64">
          <div className="min-h-screen">{children}</div>
        </main>
      </div>
    </div>
  );
}
