"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { ChevronDown, Download, MessageSquare } from "lucide-react";
import { fetchAdminLecturers, fetchLecturerDashboard } from "../lib/api";
import { decodeTokenRole } from "../../utils/auth";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
);

type SemesterOption = {
  value: string;
  label: string;
  range: string;
};

type LecturerMetrics = {
  viewed_lecturer_id: number;
  viewed_lecturer_email: string;
  total_feedbacks: number;
  avg_rating: number | null;
  cleaned_comments: string[];
  current_semester: string;
  current_semester_range: string;
  previous_semester: string;
  previous_semester_range: string;
  current_avg_rating: number | null;
  previous_avg_rating: number | null;
  current_feedbacks: number;
  previous_feedbacks: number;
  total_avg_rating: number | null;
  rating_distribution: number[];
  positive_pct: number;
  neutral_pct: number;
  negative_pct: number;
  insight_delta: number | null;
  course_breakdown: { course_code: string; avg_rating: number | null; count: number }[];
  available_courses: string[];
  available_semesters: SemesterOption[];
  selected_semester: string;
  selected_course: string | null;
  last_synced_at: string;
};

type LecturerOption = {
  id: number;
  email: string;
};

type DashboardFilterSnapshot = {
  lecturerValue?: string;
  semesterValue?: string;
  courseValue?: string;
};

const formatRating = (value: number | null) =>
  value === null || Number.isNaN(value) ? "-" : value.toFixed(2);

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
};

const getDisplayName = (email: string | null | undefined, fallback = "there") => {
  if (!email) return fallback;
  const localPart = email.split("@")[0] || "";
  const firstName = localPart.split(/[._-]/).find(Boolean);
  if (!firstName) return fallback;
  return firstName.charAt(0).toUpperCase() + firstName.slice(1);
};


const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") {
    return "Unable to load lecturer data.";
  }

  const maybeAny = error as {
    response?: { data?: { detail?: string; error?: string } };
    message?: string;
  };

  return (
    maybeAny.response?.data?.detail ||
    maybeAny.response?.data?.error ||
    maybeAny.message ||
    "Unable to load lecturer data."
  );
};

const getAuthToken = () => {
  if (typeof document === "undefined") return "";
  const cookies = document.cookie.split("; ").map((item) => item.trim());
  const tokenCookie = cookies.find(
    (cookie) =>
      cookie.startsWith("access_token=") ||
      cookie.startsWith("token=") ||
      cookie.startsWith("jwt="),
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

const getTimeAgo = (timestamp: Date | null, now: number) => {
  if (!timestamp) return "Last synced: -";
  const diffMs = Math.max(0, now - timestamp.getTime());
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 10) return "Last synced: just now";
  if (seconds < 60) return `Last synced: ${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Last synced: ${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0
      ? `Last synced: ${hours}h ${remainingMinutes}m ago`
      : `Last synced: ${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0
    ? `Last synced: ${days}d ${remainingHours}h ago`
    : `Last synced: ${days}d ago`;
};

type LecturerDashboardProps = {
  embedded?: boolean;
};

export default function LecturerDashboard({
  embedded = false,
}: LecturerDashboardProps) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<LecturerMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lecturers, setLecturers] = useState<LecturerOption[]>([]);
  const [selectedLecturerId, setSelectedLecturerId] = useState("");
  const [selectedSemester, setSelectedSemester] = useState("");
  const [selectedCourse, setSelectedCourse] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());
  const latestRequestRef = useRef(0);
  const dashboardCacheRef = useRef<Map<string, LecturerMetrics>>(new Map());
  const selectClassName =
    "h-11 w-full cursor-pointer appearance-none rounded-xl border border-slate-700/80 bg-slate-950/90 px-3 pr-10 text-sm text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition focus:border-indigo-400/70 focus:ring-2 focus:ring-indigo-500/30";
  const delta = metrics?.insight_delta ?? null;
  const deltaClass =
    delta === null
      ? "text-slate-300"
      : delta > 0
        ? "text-emerald-400"
        : delta < 0
          ? "text-rose-400"
          : "text-slate-300";

  const ratingDistribution = useMemo(() => {
    const data = metrics?.rating_distribution ?? [];
    if (data.length !== 5) {
      return [0, 0, 0, 0, 0];
    }
    return data;
  }, [metrics?.rating_distribution]);

  const chartData = useMemo(
    () => ({
      labels: ["1 Star", "2 Stars", "3 Stars", "4 Stars", "5 Stars"],
      datasets: [
        {
          label: "Rating Count",
          data: ratingDistribution,
          backgroundColor: [
            "rgba(245, 158, 11, 0.85)",
            "rgba(251, 191, 36, 0.85)",
            "rgba(99, 102, 241, 0.85)",
            "rgba(34, 197, 94, 0.85)",
            "rgba(22, 163, 74, 0.85)",
          ],
          borderColor: [
            "rgba(245, 158, 11, 1)",
            "rgba(251, 191, 36, 1)",
            "rgba(99, 102, 241, 1)",
            "rgba(34, 197, 94, 1)",
            "rgba(22, 163, 74, 1)",
          ],
          borderWidth: 1,
        },
      ],
    }),
    [ratingDistribution],
  );

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: "#cbd5f5" },
          grid: { color: "rgba(148, 163, 184, 0.15)" },
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#cbd5f5", stepSize: 1 },
          grid: { color: "rgba(148, 163, 184, 0.15)" },
        },
      },
      plugins: {
        legend: {
          labels: { color: "#e2e8f0" },
        },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.95)",
          borderColor: "rgba(99, 102, 241, 0.4)",
          borderWidth: 1,
          titleColor: "#e2e8f0",
          bodyColor: "#e2e8f0",
        },
      },
    }),
    [],
  );

  const getCacheKey = useCallback(
    ({ lecturerValue, semesterValue, courseValue }: DashboardFilterSnapshot) =>
      [
        role || "LECTURER",
        lecturerValue || "self",
        semesterValue || "current",
        courseValue || "all",
      ].join("::"),
    [role],
  );

  const applyDashboardData = useCallback((data: LecturerMetrics) => {
    setMetrics(data);
    if (data?.last_synced_at) {
      setLastUpdated(new Date(data.last_synced_at));
    } else {
      setLastUpdated(new Date());
    }
    if (data?.selected_semester) {
      setSelectedSemester(data.selected_semester);
    }
    if (typeof data?.selected_course === "string") {
      setSelectedCourse(data.selected_course);
    } else {
      setSelectedCourse("");
    }
    if (typeof data?.viewed_lecturer_id === "number") {
      setSelectedLecturerId(String(data.viewed_lecturer_id));
    }
  }, []);

  const loadDashboard = useCallback(async (
    activeToken: string,
    lecturerValue?: string,
    semesterValue?: string,
    courseValue?: string,
    options?: { preferCache?: boolean },
  ) => {
    if (!activeToken) return;
    const filters = { lecturerValue, semesterValue, courseValue };
    const cacheKey = getCacheKey(filters);
    const cached = dashboardCacheRef.current.get(cacheKey);
    if (options?.preferCache && cached) {
      applyDashboardData(cached);
      setLoading(false);
      return;
    }
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchLecturerDashboard(activeToken, {
        ...(lecturerValue ? { lecturer_id: Number(lecturerValue) } : {}),
        ...(semesterValue ? { semester: semesterValue } : {}),
        ...(courseValue ? { course_code: courseValue } : {}),
      });
      if (requestId !== latestRequestRef.current) {
        return;
      }
      dashboardCacheRef.current.set(cacheKey, response.data);
      applyDashboardData(response.data);
    } catch (errorResponse) {
      if (requestId !== latestRequestRef.current) {
        return;
      }
      const status = (errorResponse as { response?: { status?: number } })
        ?.response?.status;
      if (status === 401) {
        router.push("/login");
      } else if (status === 403) {
        setError("You do not have permission to view this lecturer dashboard.");
      } else {
        setError(getErrorMessage(errorResponse));
      }
    } finally {
      if (requestId === latestRequestRef.current) {
        setLoading(false);
      }
    }
  }, [applyDashboardData, getCacheKey, router]);

  useEffect(() => {
    const authToken = getAuthToken();
    if (!authToken) {
      setError("Please sign in to view your dashboard.");
      router.push("/login");
      return;
    }
    setToken(authToken);
    setRole(decodeTokenRole(authToken));
  }, [router]);

  useEffect(() => {
    if (!token) return;
    if (role === "ADMIN") {
      void fetchAdminLecturers(token)
        .then((response) => {
          const options = response.data || [];
          setLecturers(options);
          setSelectedLecturerId((current) => current || (options[0] ? String(options[0].id) : ""));
        })
        .catch((errorResponse) => {
          setLecturers([]);
          setError(getErrorMessage(errorResponse));
        });
      return;
    }
    setLecturers([]);
    setSelectedLecturerId("");
  }, [role, token]);

  useEffect(() => {
    if (!token || role === "ADMIN") return;
    const timer = window.setTimeout(() => {
      void loadDashboard(
        token,
        undefined,
        selectedSemester || undefined,
        selectedCourse || undefined,
        { preferCache: true },
      );
    }, 180);
    return () => window.clearTimeout(timer);
  }, [token, role, selectedSemester, selectedCourse, loadDashboard]);

  useEffect(() => {
    if (!token || role !== "ADMIN" || !selectedLecturerId) return;
    const timer = window.setTimeout(() => {
      void loadDashboard(
        token,
        selectedLecturerId,
        selectedSemester || undefined,
        selectedCourse || undefined,
        { preferCache: true },
      );
    }, 180);
    return () => window.clearTimeout(timer);
  }, [token, role, selectedLecturerId, selectedSemester, selectedCourse, loadDashboard]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const handleDownloadReport = () => {
    if (!metrics) return;
    const reportWindow = window.open("", "_blank", "width=900,height=700");
    if (!reportWindow) return;
    const comments = metrics.cleaned_comments.length
      ? metrics.cleaned_comments
      : ["No feedback received yet for this semester."];
    reportWindow.document.write(`
      <html>
        <head>
          <title>Lecturer Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 32px; color: #0f172a; }
            h1 { margin-bottom: 8px; }
            h2 { margin-top: 24px; }
            .meta { color: #475569; font-size: 14px; }
            ul { padding-left: 18px; }
          </style>
        </head>
        <body>
          <h1>Lecturer Feedback Report</h1>
          <div class="meta">Lecturer: ${metrics.viewed_lecturer_email}</div>
          <div class="meta">Semester: ${metrics.current_semester}</div>
          <div class="meta">Current Avg: ${formatRating(metrics.current_avg_rating)}</div>
          <div class="meta">Current Feedbacks: ${metrics.current_feedbacks}</div>
          <div class="meta">Previous Avg: ${formatRating(metrics.previous_avg_rating)}</div>
          <div class="meta">Previous Feedbacks: ${metrics.previous_feedbacks}</div>
          <div class="meta">Total Avg: ${formatRating(metrics.total_avg_rating)}</div>
          <div class="meta">Total Feedbacks: ${metrics.total_feedbacks}</div>
          <h2>Cleaned Comments</h2>
          <ul>
            ${comments.map((item) => `<li>${item}</li>`).join("")}
          </ul>
        </body>
      </html>
    `);
    reportWindow.document.close();
    reportWindow.focus();
    reportWindow.print();
  };

  return (
    <div
      className={
        embedded
          ? "text-slate-100"
          : "min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100"
      }
    >
      <div
        className={
          embedded
            ? "relative flex w-full flex-col gap-8 px-6 py-10"
            : "relative mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-8 sm:px-6 lg:px-8 lg:py-10"
        }
      >
        {loading && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[2rem] bg-slate-950/45 backdrop-blur-[2px]">
            <div className="flex min-w-40 flex-col items-center gap-3 rounded-2xl border border-slate-700/70 bg-slate-950/90 px-6 py-5 shadow-2xl shadow-slate-950/50">
              <div className="h-10 w-10 animate-spin rounded-full border-3 border-slate-700 border-t-indigo-400" />
              <div className="text-center">
                <p className="text-sm font-semibold text-white">Updating dashboard</p>
                <p className="text-xs text-slate-400">
                  Refreshing course and semester data...
                </p>
              </div>
            </div>
          </div>
        )}

        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              {role === "ADMIN" ? "Admin Lecturer View" : "Lecturer Dashboard"}
            </p>
            <h1 className="text-3xl font-semibold text-white sm:text-4xl">
              {getGreeting()}, {getDisplayName(metrics?.viewed_lecturer_email)}!
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              {role === "ADMIN" ? "Lecturer Teaching Snapshot" : "Your Teaching Snapshot"}
            </p>
            {metrics?.viewed_lecturer_email && role === "ADMIN" && (
              <p className="mt-2 text-sm text-slate-300">
                Viewing lecturer: {metrics.viewed_lecturer_email}
              </p>
            )}
            <p className="mt-2 text-sm text-slate-400">
              Dashboard &gt; {(metrics?.current_semester || "Harmattan")} Semester
              {" "}(
              Academic Period: {metrics?.current_semester_range || "-"}
              )
            </p>
          </div>
          <div className="w-full rounded-2xl border border-slate-800/70 bg-slate-900/70 p-4 xl:w-auto">
            <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${role === "ADMIN" ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]" : "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]"} xl:items-end`}>
              {role === "ADMIN" && (
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Lecturer
                  </label>
                  <div className="relative">
                    <select
                      className={selectClassName}
                      value={selectedLecturerId}
                      onChange={(event) => {
                        setSelectedLecturerId(event.target.value);
                        setSelectedCourse("");
                        setSelectedSemester("");
                      }}
                    >
                      {lecturers.length === 0 ? (
                        <option value="">No lecturers available</option>
                      ) : (
                        lecturers.map((lecturer) => (
                          <option key={lecturer.id} value={lecturer.id}>
                            {lecturer.email}
                          </option>
                        ))
                      )}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                Course
              </label>
              <div className="relative">
                <select
                  className={selectClassName}
                  value={selectedCourse}
                  onChange={(event) => setSelectedCourse(event.target.value)}
                >
                  <option value="">All Courses</option>
                  {(metrics?.available_courses || []).map((courseCode) => (
                    <option key={courseCode} value={courseCode}>
                      {courseCode}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                Semester
              </label>
              <div className="relative">
                <select
                  className={selectClassName}
                  value={selectedSemester}
                  onChange={(event) => setSelectedSemester(event.target.value)}
                >
                  {(metrics?.available_semesters || []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
              <span className="text-xs text-slate-500">
                {metrics?.current_semester_range || ""}
              </span>
              </div>
              <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                Status
              </span>
              <span className="text-xs text-slate-400">
                {getTimeAgo(lastUpdated, now)}
              </span>
              {lastUpdated && (
                <span className="text-[11px] text-slate-500">
                  {lastUpdated.toLocaleString()}
                </span>
              )}
              </div>
              <button
                type="button"
                onClick={handleDownloadReport}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:border-indigo-400/60 hover:text-white"
              >
                <Download className="h-4 w-4" />
                Download Report
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">Selected Semester Rating</p>
              <MessageSquare className="h-5 w-5 text-indigo-300" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-white">
              {metrics
                ? formatRating(metrics.current_avg_rating ?? metrics.avg_rating)
                : "-"}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {metrics ? metrics.current_feedbacks : "0"} feedbacks this semester
            </p>
            {metrics?.current_semester && (
              <p className="mt-2 text-xs text-slate-500">
                {metrics.current_semester}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">Previous Semester Rating</p>
              <MessageSquare className="h-5 w-5 text-indigo-300" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-white">
              {metrics ? formatRating(metrics.previous_avg_rating) : "-"}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {metrics ? metrics.previous_feedbacks : "0"} feedbacks last semester
            </p>
            {metrics?.previous_semester && (
              <p className="mt-2 text-xs text-slate-500">
                {metrics.previous_semester}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">Total Rating</p>
              <MessageSquare className="h-5 w-5 text-indigo-300" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-white">
              {metrics ? formatRating(metrics.total_avg_rating) : "-"}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {metrics ? metrics.total_feedbacks : "0"} total feedbacks
            </p>
            <p className="mt-2 text-xs text-slate-500">All time</p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/40">
          <p className="text-sm text-slate-300">
            Insight:{" "}
            {delta === null
              ? "Not enough previous-semester data for delta."
              : (
                <span className={`font-semibold ${deltaClass}`}>
                  {`${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`}
                </span>
              )}
            {delta !== null && " vs previous semester"}
          </p>
        </section>

        <section className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Course Breakdown</p>
              <h2 className="text-lg font-semibold text-white">
                Course-level averages for the selected semester
              </h2>
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-800/70 bg-slate-950/40">
            <div className="max-h-72 overflow-auto">
              <table className="w-full min-w-[460px] text-sm text-slate-200">
                <thead className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur">
                <tr className="text-left text-slate-400">
                  <th className="pb-2">Course</th>
                  <th className="pb-2">Avg Rating</th>
                  <th className="pb-2">Feedback Count</th>
                </tr>
                </thead>
                <tbody>
                {(metrics?.course_breakdown || []).map((row) => (
                  <tr key={row.course_code} className="border-t border-slate-800/70">
                    <td className="py-2">{row.course_code}</td>
                    <td className="py-2">{formatRating(row.avg_rating)}</td>
                    <td className="py-2">{row.count}</td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
            {!(metrics?.course_breakdown || []).length && (
              <p className="pt-3 text-sm text-slate-500">No course data yet.</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">
                Rating Distribution (Selected Semester)
              </p>
              <h2 className="text-lg font-semibold text-white">
                How students rated this semester
              </h2>
            </div>
            {loading && (
              <span className="text-xs text-slate-400">Loading...</span>
            )}
          </div>
          <div className="mt-4 h-48">
            {metrics?.rating_distribution?.length === 5 ? (
              <Bar data={chartData} options={chartOptions} />
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-700/70 text-sm text-slate-500">
                Not enough data yet.
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            1-2 stars = Warning | 4-5 stars = Success
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Positive: {(metrics?.positive_pct ?? 0).toFixed(1)}% | Neutral:{" "}
            {(metrics?.neutral_pct ?? 0).toFixed(1)}% | Negative:{" "}
            {(metrics?.negative_pct ?? 0).toFixed(1)}%
          </p>
        </section>

        <section className="rounded-2xl border border-slate-800/70 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Cleaned Feedbacks</p>
              <h2 className="text-lg font-semibold text-white">
                Recent Student Comments for the selected semester
              </h2>
            </div>
            <MessageSquare className="h-5 w-5 text-indigo-300" />
          </div>
          <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-2">
            {metrics?.cleaned_comments?.length ? (
              metrics.cleaned_comments.map((comment, index) => (
                <div
                  key={`${comment}-${index}`}
                  className="rounded-2xl border border-slate-800/70 bg-slate-950/60 px-4 py-3 text-sm text-slate-200"
                >
                  {comment}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-700/70 px-4 py-6 text-center text-sm text-slate-500">
                No feedback received yet for the selected semester.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
